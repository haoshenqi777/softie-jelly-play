import { cofactor, determinant, inverse } from './math.ts';
import { createVolumeKernel, type VolumeKernel } from './wasm.ts';

export type VolumeCage = {
  positions: ArrayLike<number>;
  tets: ArrayLike<number>;
  volumes?: ArrayLike<number>;
};
export type VolumeOptions = {
  gravity?: number;
  shear?: number;
  bulk?: number;
  damping?: number;
};

/** Original tetrahedral XPBD discretization of stable neo-Hookean energy:
 * E = V/2 [mu (||F||² - 3) + lambda (J - 1 - mu/lambda)²].
 * Solve the stretch and determinant constraints together as a 2x2 block.
 * Their forces cancel at F=I, including when mu varies over the crown.
 * Unlike independent distance springs, each constraint sees all 4 tet nodes.
 * Mass is lumped from geometric rest volume at unit density.
 */
export class VolumeSoftBody {
  readonly rest: Float64Array;
  readonly x: Float64Array;
  readonly velocity: Float64Array;
  readonly mass: Float64Array;
  readonly nodeCount: number;
  private readonly ids: Int32Array;
  private readonly inverseRest: Float64Array;
  private readonly volumes: Float64Array;
  private readonly invMass: Float64Array;
  private readonly mu: Float64Array;
  private readonly lambdas: Float64Array;
  private readonly previous: Float64Array;
  private readonly edges: Int32Array;
  private gravity: number;
  private floorHeight = 0;
  get floorLevel(): number {
    return this.floorHeight;
  }
  setFloorLevel(level: number): void {
    if (Number.isFinite(level))
      this.floorHeight = Math.max(-0.75, Math.min(0, level));
  }
  private crownSoftness = 0.55;
  private crownSpan = 0.35;
  private gripStrength = 70000;
  private restitution = 0;
  private friction = 10;
  private readonly crownFalloff: Float64Array;
  private readonly restHeight: Float64Array;
  private impactArmed = false;
  private pendingImpact = 0;
  private impactAge = 0;
  private readonly bulk: number;
  private damping: number;
  private shear: number;
  private readonly f = new Float64Array(9);
  private readonly cof = new Float64Array(9);
  private readonly gs = new Float64Array(12);
  private readonly gv = new Float64Array(12);
  private readonly transforms: Float64Array;
  private readonly nodeVolumes: Float64Array;
  private grabState: {
    ids: number[];
    weights: number[];
    offsets: number[];
    target: number[];
    goal: number[];
    lambda: Float64Array;
  } | null = null;
  private accumulator = 0;
  private steps = 0;
  private asleep = false;
  private quietTime = 0;
  private kernel: VolumeKernel | null = null;
  private minimumJacobian = 1;
  private maximumStretch = 3;
  private backtracked = false;
  private localRepairs = 0;

  setMaterial(
    shear: number,
    damping: number,
    crownSoftness = this.crownSoftness,
    crownSpan = this.crownSpan,
  ): void {
    if (![shear, damping, crownSoftness, crownSpan].every(Number.isFinite))
      return;
    shear = Math.max(40, Math.min(1200, shear));
    damping = Math.max(0, Math.min(80, damping));
    this.crownSoftness = Math.max(0, Math.min(0.9, crownSoftness));
    this.crownSpan = Math.max(0.15, Math.min(0.55, crownSpan));
    for (let i = 0; i < this.mu.length; i++) {
      const h = Math.max(
        0,
        Math.min(
          1,
          (this.restHeight[i] - (1 - this.crownSpan)) / this.crownSpan,
        ),
      );
      this.crownFalloff[i] = h * h * (3 - 2 * h);
      this.mu[i] = shear * (1 - this.crownSoftness * this.crownFalloff[i]);
    }
    this.shear = shear;
    this.damping = damping;
    this.kernel?.updateMaterial();
    this.wake();
  }

  setDynamics(values: {
    gravity?: number;
    gripStrength?: number;
    restitution?: number;
    friction?: number;
  }): void {
    const bounded = (
      value: number | undefined,
      current: number,
      low: number,
      high: number,
    ) =>
      typeof value === 'number' && Number.isFinite(value)
        ? Math.max(low, Math.min(high, value))
        : current;
    this.gravity = bounded(values.gravity, this.gravity, 0, 10);
    this.gripStrength = bounded(
      values.gripStrength,
      this.gripStrength,
      17500,
      280000,
    );
    this.restitution = bounded(values.restitution, this.restitution, 0, 0.8);
    this.friction = bounded(values.friction, this.friction, 0, 40);
    this.wake();
  }

  async accelerate(bytes: BufferSource): Promise<void> {
    this.kernel = await createVolumeKernel(bytes, {
      x: this.x,
      ids: this.ids,
      inverseRest: this.inverseRest,
      volumes: this.volumes,
      invMass: this.invMass,
      mu: this.mu,
    });
  }

  /** A sleeping body retains its physically settled pose and performs no solves. */
  get sleeping(): boolean {
    return this.asleep;
  }

  /** Wake before an external gesture adds physical forces to the velocity field. */
  wake(): void {
    this.asleep = false;
    this.quietTime = 0;
  }

  constructor(cage: VolumeCage, options: VolumeOptions = {}) {
    if (
      cage.positions.length % 3 ||
      cage.tets.length % 4 ||
      !cage.positions.length ||
      !cage.tets.length
    )
      throw new Error('Invalid tetrahedral cage');
    this.rest = Float64Array.from(cage.positions);
    this.x = this.rest.slice();
    this.velocity = new Float64Array(this.x.length);
    this.nodeCount = this.x.length / 3;
    this.ids = Int32Array.from(cage.tets);
    const count = this.ids.length / 4;
    this.inverseRest = new Float64Array(count * 9);
    this.volumes = new Float64Array(count);
    this.invMass = new Float64Array(this.nodeCount);
    this.mu = new Float64Array(count);
    this.crownFalloff = new Float64Array(count);
    this.restHeight = new Float64Array(count);
    this.lambdas = new Float64Array(count * 2);
    this.previous = this.x.slice();
    this.transforms = new Float64Array(this.nodeCount * 9);
    this.nodeVolumes = new Float64Array(this.nodeCount);
    this.gravity = options.gravity ?? 5;
    this.bulk = Math.max(1, options.bulk ?? 2200);
    this.damping = Math.max(0, options.damping ?? 12);
    const shear = Math.max(0.1, options.shear ?? 240),
      dm = new Float64Array(9),
      inv = new Float64Array(9),
      edgeSet = new Set<string>();
    this.shear = shear;
    let low = Infinity,
      high = -Infinity;
    for (let i = 0; i < this.nodeCount; i++) {
      low = Math.min(low, this.rest[i * 3 + 1]);
      high = Math.max(high, this.rest[i * 3 + 1]);
    }
    for (let t = 0; t < count; t++) {
      const a = this.ids[t * 4];
      let y = 0;
      for (let j = 0; j < 4; j++) {
        const id = this.ids[t * 4 + j];
        if (id < 0 || id >= this.nodeCount)
          throw new Error('Invalid tetrahedron index');
        y += this.rest[id * 3 + 1] / 4;
        for (let k = j + 1; k < 4; k++) {
          const b = this.ids[t * 4 + k];
          edgeSet.add(id < b ? `${id},${b}` : `${b},${id}`);
        }
      }
      for (let r = 0; r < 3; r++)
        for (let j = 0; j < 3; j++)
          dm[r * 3 + j] =
            this.rest[this.ids[t * 4 + j + 1] * 3 + r] - this.rest[a * 3 + r];
      this.volumes[t] = Math.abs(inverse(dm, inv)) / 6;
      this.inverseRest.set(inv, t * 9);
      this.restHeight[t] = (y - low) / Math.max(1e-12, high - low);
      const h = Math.max(
        0,
        Math.min(
          1,
          (this.restHeight[t] - (1 - this.crownSpan)) / this.crownSpan,
        ),
      );
      this.crownFalloff[t] = h * h * (3 - 2 * h);
      this.mu[t] = shear * (1 - this.crownSoftness * this.crownFalloff[t]);
      for (let j = 0; j < 4; j++) {
        this.invMass[this.ids[t * 4 + j]] += this.volumes[t] / 4;
        this.nodeVolumes[this.ids[t * 4 + j]] += this.volumes[t];
      }
    }
    this.mass = this.invMass.slice();
    for (let i = 0; i < this.nodeCount; i++)
      this.invMass[i] = this.invMass[i] > 0 ? 1 / this.invMass[i] : 0;
    this.edges = Int32Array.from(
      Array.from(edgeSet).flatMap((e) => e.split(',').map(Number)),
    );
  }

  private deformation(t: number): void {
    const a = this.ids[t * 4] * 3,
      d = this.inverseRest,
      o = t * 9;
    for (let r = 0; r < 3; r++) {
      const p = this.x[this.ids[t * 4 + 1] * 3 + r] - this.x[a + r],
        q = this.x[this.ids[t * 4 + 2] * 3 + r] - this.x[a + r],
        s = this.x[this.ids[t * 4 + 3] * 3 + r] - this.x[a + r];
      for (let k = 0; k < 3; k++)
        this.f[r * 3 + k] = p * d[o + k] + q * d[o + 3 + k] + s * d[o + 6 + k];
    }
  }

  private gradients(t: number, stretch: number): void {
    const d = this.inverseRest,
      o = t * 9;
    this.gs.fill(0);
    this.gv.fill(0);
    for (let j = 1; j < 4; j++)
      for (let r = 0; r < 3; r++) {
        let s = 0,
          v = 0;
        for (let k = 0; k < 3; k++) {
          s += (this.f[r * 3 + k] * d[o + (j - 1) * 3 + k]) / stretch;
          v += this.cof[r * 3 + k] * d[o + (j - 1) * 3 + k];
        }
        this.gs[j * 3 + r] = s;
        this.gv[j * 3 + r] = v;
        this.gs[r] -= s;
        this.gv[r] -= v;
      }
  }

  private projectTet(t: number, dt: number): void {
    this.deformation(t);
    cofactor(this.f, this.cof);
    const j = determinant(this.f);
    let norm = 0;
    for (let k = 0; k < 9; k++) norm += this.f[k] * this.f[k];
    const stretch = Math.sqrt(Math.max(1e-12, norm));
    this.gradients(t, stretch);
    const alphaS = 1 / (this.mu[t] * this.volumes[t] * dt * dt),
      alphaV = 1 / (this.bulk * this.volumes[t] * dt * dt);
    let ss = alphaS,
      vv = alphaV,
      sv = 0;
    for (let n = 0; n < 4; n++)
      for (let k = 0; k < 3; k++) {
        const w = this.invMass[this.ids[t * 4 + n]],
          s = this.gs[n * 3 + k],
          v = this.gv[n * 3 + k];
        ss += w * s * s;
        vv += w * v * v;
        sv += w * s * v;
      }
    const cs = stretch + alphaS * this.lambdas[t * 2],
      cv = j - 1 - this.mu[t] / this.bulk + alphaV * this.lambdas[t * 2 + 1];
    const denominator = ss * vv - sv * sv,
      ds = (-cs * vv + cv * sv) / denominator,
      dv = (-cv * ss + cs * sv) / denominator;
    this.lambdas[t * 2] += ds;
    this.lambdas[t * 2 + 1] += dv;
    for (let n = 0; n < 4; n++) {
      const id = this.ids[t * 4 + n],
        w = this.invMass[id];
      for (let k = 0; k < 3; k++)
        this.x[id * 3 + k] +=
          w * (ds * this.gs[n * 3 + k] + dv * this.gv[n * 3 + k]);
    }
  }

  private barrier(t: number): void {
    this.deformation(t);
    const j = determinant(this.f);
    if (j >= 0.22) return;
    cofactor(this.f, this.cof);
    this.gradients(t, 1);
    let denom = 0;
    for (let n = 0; n < 4; n++)
      for (let k = 0; k < 3; k++) {
        const id = this.ids[t * 4 + n];
        // A contact node cannot move down. Including that forbidden direction
        // in the effective mass makes floor projection undo volume recovery.
        if (
          k === 1 &&
          this.x[id * 3 + 1] <= this.floorHeight + 1e-8 &&
          this.gv[n * 3 + k] < 0
        )
          continue;
        denom += this.invMass[id] * this.gv[n * 3 + k] ** 2;
      }
    const dl = (0.22 - j) / Math.max(denom, 1e-12);
    for (let n = 0; n < 4; n++)
      for (let k = 0; k < 3; k++) {
        const id = this.ids[t * 4 + n];
        if (
          k === 1 &&
          this.x[id * 3 + 1] <= this.floorHeight + 1e-8 &&
          this.gv[n * 3 + k] < 0
        )
          continue;
        this.x[id * 3 + k] += dl * this.invMass[id] * this.gv[n * 3 + k];
      }
  }

  private floor(): void {
    for (let i = 1; i < this.x.length; i += 3)
      if (this.x[i] < this.floorHeight) this.x[i] = this.floorHeight;
  }

  private preserveOrientation(): void {
    this.backtracked = false;
    // Repair the compressed neighborhood before global backtracking. Otherwise
    // a single floor-adjacent sliver can veto gravity for the whole character.
    for (let attempt = 0; attempt < 16; attempt++) {
      this.measureDeformation();
      if (this.minimumJacobian >= 0.16) return;
      this.localRepairs++;
      for (let q = 0; q < this.volumes.length; q++)
        this.barrier(attempt % 2 ? this.volumes.length - 1 - q : q);
      this.floor();
    }
    // Retain a last-resort finite/orientation guard, but never treat a rejected
    // step as physical rest when evaluating sleep.
    for (let attempt = 0; attempt < 12; attempt++) {
      this.measureDeformation();
      if (this.minimumJacobian >= 0.12) return;
      this.backtracked = true;
      for (let i = 0; i < this.x.length; i++)
        this.x[i] = (this.x[i] + this.previous[i]) * 0.5;
    }
    this.x.set(this.previous);
    this.measureDeformation();
  }

  private measureDeformation(): void {
    this.minimumJacobian = Infinity;
    this.maximumStretch = 0;
    for (let t = 0; t < this.volumes.length; t++) {
      this.deformation(t);
      const j = determinant(this.f);
      this.minimumJacobian = Math.min(
        this.minimumJacobian,
        Number.isFinite(j) ? j : -Infinity,
      );
      let stretch = 0;
      for (let k = 0; k < 9; k++) stretch += this.f[k] * this.f[k];
      this.maximumStretch = Math.max(this.maximumStretch, stretch);
    }
  }

  private meanVerticalVelocity(): number {
    let momentum = 0,
      mass = 0;
    for (let i = 0; i < this.nodeCount; i++)
      if (this.invMass[i] > 0) {
        const m = 1 / this.invMass[i];
        momentum += m * this.velocity[i * 3 + 1];
        mass += m;
      }
    return momentum / Math.max(mass, 1e-12);
  }

  step(
    dt: number,
    projectContacts?: (dt: number, iteration: number) => void,
  ): void {
    if (this.asleep || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 1 / 120);
    this.previous.set(this.x);
    this.lambdas.fill(0);
    this.kernel?.reset();
    const grab = this.grabState;
    if (grab) {
      grab.lambda.fill(0);
      const distance = Math.hypot(
        ...grab.goal.map((v, k) => v - grab.target[k]),
      );
      const blend = Math.min(1, (12 * dt) / Math.max(1e-12, distance));
      for (let k = 0; k < 3; k++)
        grab.target[k] += (grab.goal[k] - grab.target[k]) * blend;
    }
    let minimumHeight = Infinity;
    for (let i = 0; i < this.nodeCount; i++) {
      minimumHeight = Math.min(
        minimumHeight,
        this.x[i * 3 + 1] - this.floorHeight,
      );
      this.velocity[i * 3 + 1] -= this.gravity * dt;
      for (let k = 0; k < 3; k++)
        this.x[i * 3 + k] += this.velocity[i * 3 + k] * dt;
    }
    if (grab || this.restitution === 0) {
      this.impactArmed = false;
      this.pendingImpact = 0;
    } else if (minimumHeight > 0.025) this.impactArmed = true;
    const incomingSpeed = this.impactArmed
      ? Math.max(0, -this.meanVerticalVelocity())
      : 0;
    for (let iteration = 0; iteration < 4; iteration++) {
      if (grab)
        for (let n = 0; n < grab.ids.length; n++) {
          const id = grab.ids[n],
            w = this.invMass[id],
            alpha = w / (this.gripStrength * grab.weights[n] * dt * dt);
          for (let k = 0; k < 3; k++) {
            const p = n * 3 + k,
              dl =
                -(
                  this.x[id * 3 + k] -
                  grab.target[k] -
                  grab.offsets[p] +
                  alpha * grab.lambda[p]
                ) /
                (w + alpha);
            this.x[id * 3 + k] += w * dl;
            grab.lambda[p] += dl;
          }
        }
      projectContacts?.(dt, iteration);
      // Alternate traversal to avoid an artificial preferred propagation direction.
      const count = this.volumes.length;
      if (this.kernel)
        this.kernel.project(
          dt,
          iteration % 2 === 1,
          this.bulk,
          this.floorHeight,
        );
      else {
        for (let q = 0; q < count; q++)
          this.projectTet(iteration % 2 ? count - 1 - q : q, dt);
        this.floor();
        for (let q = 0; q < count; q++)
          this.barrier(iteration % 2 ? count - 1 - q : q);
      }
    }
    this.floor();
    this.preserveOrientation();
    const air = Math.exp(-0.35 * dt);
    for (let i = 0; i < this.x.length; i++)
      this.velocity[i] = ((this.x[i] - this.previous[i]) / dt) * air;
    // Axial pair damping dissipates strain velocity and preserves pair momentum.
    // It leaves rigid translation and rotation unchanged.
    const rate = 1 - Math.exp((-this.damping * dt) / 6);
    for (let e = 0; e < this.edges.length; e += 2) {
      const a = this.edges[e],
        b = this.edges[e + 1],
        wa = this.invMass[a],
        wb = this.invMass[b];
      const dx = this.x[b * 3] - this.x[a * 3],
        dy = this.x[b * 3 + 1] - this.x[a * 3 + 1],
        dz = this.x[b * 3 + 2] - this.x[a * 3 + 2];
      const l2 = dx * dx + dy * dy + dz * dz;
      if (l2 < 1e-14) continue;
      const dot =
        ((this.velocity[b * 3] - this.velocity[a * 3]) * dx +
          (this.velocity[b * 3 + 1] - this.velocity[a * 3 + 1]) * dy +
          (this.velocity[b * 3 + 2] - this.velocity[a * 3 + 2]) * dz) /
        l2;
      const impulse = (rate * dot) / (wa + wb);
      this.velocity[a * 3] += wa * impulse * dx;
      this.velocity[a * 3 + 1] += wa * impulse * dy;
      this.velocity[a * 3 + 2] += wa * impulse * dz;
      this.velocity[b * 3] -= wb * impulse * dx;
      this.velocity[b * 3 + 1] -= wb * impulse * dy;
      this.velocity[b * 3 + 2] -= wb * impulse * dz;
    }
    let grounded = false,
      maxSpeedSquared = 0;
    for (let i = 0; i < this.nodeCount; i++) {
      if (this.x[i * 3 + 1] < this.floorHeight + 1e-8) {
        grounded = true;
        this.velocity[i * 3 + 1] = Math.max(0, this.velocity[i * 3 + 1]);
        this.velocity[i * 3] *= Math.exp(-this.friction * dt);
        this.velocity[i * 3 + 2] *= Math.exp(-this.friction * dt);
      }
      const vx = this.velocity[i * 3],
        vy = this.velocity[i * 3 + 1],
        vz = this.velocity[i * 3 + 2];
      maxSpeedSquared = Math.max(maxSpeedSquared, vx * vx + vy * vy + vz * vz);
    }
    if (grounded && this.impactArmed) {
      this.impactArmed = false;
      this.pendingImpact = incomingSpeed > 0.5 ? incomingSpeed : 0;
      this.impactAge = 0;
    }
    if (this.pendingImpact > 0) {
      this.impactAge += dt;
      const outgoing = this.meanVerticalVelocity();
      // Let the elastic body squash first. At its compression turnaround,
      // enforce a bounded whole-body restitution floor (not a per-node kick
      // immediately damped away as internal strain). Apply only once per fall.
      if (outgoing >= 0) {
        const boost = Math.max(
          0,
          this.restitution * this.pendingImpact - outgoing,
        );
        for (let i = 1; i < this.velocity.length; i += 3)
          this.velocity[i] += boost;
        maxSpeedSquared = Math.max(maxSpeedSquared, boost * boost);
        this.pendingImpact = 0;
      } else if (this.impactAge > 0.3) this.pendingImpact = 0;
    }
    // Check every node rather than aggregate energy: a quiet bulk must not hide
    // a moving crown. Require sustained floor contact, never sleep a held body.
    this.quietTime =
      grounded &&
      !grab &&
      !this.backtracked &&
      this.minimumJacobian > 0.55 &&
      this.maximumStretch < 4.5 &&
      maxSpeedSquared < 0.04 ** 2
        ? this.quietTime + dt
        : 0;
    if (this.quietTime >= 0.65) {
      this.asleep = true;
      this.velocity.fill(0);
    }
    this.steps++;
  }

  advance(
    elapsed: number,
    beforeStep?: (dt: number) => void,
    contact?: {
      beginStep(dt: number): void;
      project(dt: number, iteration: number): void;
      endStep(dt: number): void;
    },
  ): void {
    if (!Number.isFinite(elapsed) || elapsed <= 0) return;
    const fixed = 1 / 240;
    // At most one 30Hz frame of work; never amplify a stall into 24 substeps.
    // Preserve the stable integration step and discard old catch-up time.
    this.accumulator = Math.min(
      8 * fixed,
      this.accumulator + Math.min(0.1, elapsed),
    );
    while (this.accumulator + 1e-12 >= fixed) {
      beforeStep?.(fixed);
      contact?.beginStep(fixed);
      this.step(fixed, contact ? (dt, i) => contact.project(dt, i) : undefined);
      contact?.endStep(fixed);
      this.accumulator -= fixed;
    }
    this.accumulator = Math.max(0, this.accumulator);
  }
  reset(): void {
    this.wake();
    this.floorHeight = 0;
    this.x.set(this.rest);
    this.velocity.fill(0);
    this.lambdas.fill(0);
    this.grabState = null;
    this.impactArmed = false;
    this.pendingImpact = 0;
    this.impactAge = 0;
    this.accumulator = 0;
    this.steps = 0;
  }
  grab(index: number, target: ArrayLike<number>, radius = 0.52): void {
    if (index < 0 || index >= this.nodeCount || !Number.isInteger(index))
      return;
    this.wake();
    const ids: number[] = [],
      weights: number[] = [],
      offsets: number[] = [],
      anchor = Array.from(this.x.slice(index * 3, index * 3 + 3));
    for (let i = 0; i < this.nodeCount; i++) {
      const d = Math.hypot(
        this.rest[i * 3] - this.rest[index * 3],
        this.rest[i * 3 + 1] - this.rest[index * 3 + 1],
        this.rest[i * 3 + 2] - this.rest[index * 3 + 2],
      );
      if (d >= radius && i !== index) continue;
      const u = Math.max(0, 1 - d / Math.max(0.01, radius));
      ids.push(i);
      weights.push(Math.max(0.01, u * u * (3 - 2 * u)));
      for (let k = 0; k < 3; k++) offsets.push(this.x[i * 3 + k] - anchor[k]);
    }
    this.grabState = {
      ids,
      weights,
      offsets,
      target: anchor,
      goal: anchor.slice(),
      lambda: new Float64Array(ids.length * 3),
    };
    this.moveGrab(target);
  }
  moveGrab(target: ArrayLike<number>): void {
    if (
      !this.grabState ||
      ![target[0], target[1], target[2]].every(Number.isFinite)
    )
      return;
    for (let k = 0; k < 3; k++)
      this.grabState.goal[k] = k === 1 ? Math.max(0.04, target[k]) : target[k];
  }
  release(): void {
    this.wake();
    this.grabState = null;
  }
  kick(vx: number, vy: number, vz: number): void {
    if (![vx, vy, vz].every(Number.isFinite)) return;
    this.wake();
    for (let i = 0; i < this.nodeCount; i++) {
      this.velocity[i * 3] += vx;
      this.velocity[i * 3 + 1] += vy;
      this.velocity[i * 3 + 2] += vz;
    }
  }
  /** Internal muscular effort: acceleration about the mass center plus axial
   * compression. Zero net linear impulse; all resulting motion uses XPBD/contact. */
  actuate(
    angular: ArrayLike<number>,
    axis: ArrayLike<number>,
    compression: number,
    dt: number,
  ): void {
    if (
      ![
        angular[0],
        angular[1],
        angular[2],
        axis[0],
        axis[1],
        axis[2],
        compression,
        dt,
      ].every(Number.isFinite) ||
      dt <= 0
    )
      return;
    dt = Math.min(dt, 1 / 120);
    const scale = Math.min(
      1,
      18 / Math.max(1e-9, Math.hypot(angular[0], angular[1], angular[2])),
    );
    const ax = angular[0] * scale,
      ay = angular[1] * scale,
      az = angular[2] * scale;
    const length = Math.hypot(axis[0], axis[1], axis[2]);
    const nx = axis[0] / Math.max(1e-9, length),
      ny = axis[1] / Math.max(1e-9, length),
      nz = axis[2] / Math.max(1e-9, length);
    compression = Math.max(0, Math.min(18, compression));
    if (ax === 0 && ay === 0 && az === 0 && compression === 0) return;
    this.wake();
    let cx = 0,
      cy = 0,
      cz = 0,
      total = 0;
    for (let i = 0; i < this.nodeCount; i++) {
      const m = this.mass[i];
      total += m;
      cx += this.x[i * 3] * m;
      cy += this.x[i * 3 + 1] * m;
      cz += this.x[i * 3 + 2] * m;
    }
    cx /= total;
    cy /= total;
    cz /= total;
    for (let i = 0; i < this.nodeCount; i++) {
      const n = i * 3,
        rx = this.x[n] - cx,
        ry = this.x[n + 1] - cy,
        rz = this.x[n + 2] - cz;
      const squeeze = compression * (rx * nx + ry * ny + rz * nz);
      this.velocity[n] += (ay * rz - az * ry - squeeze * nx) * dt;
      this.velocity[n + 1] += (az * rx - ax * rz - squeeze * ny) * dt;
      this.velocity[n + 2] += (ax * ry - ay * rx - squeeze * nz) * dt;
    }
  }
  /** A user-triggered nudge is an angular impulse, never a pose teleport. */
  nudge(): void {
    this.wake();
    let cx = 0,
      cy = 0,
      total = 0;
    for (let i = 0; i < this.nodeCount; i++) {
      total += this.mass[i];
      cx += this.x[i * 3] * this.mass[i];
      cy += this.x[i * 3 + 1] * this.mass[i];
    }
    cx /= total;
    cy /= total;
    for (let i = 0; i < this.nodeCount; i++) {
      this.velocity[i * 3] -= 2.6 * (this.x[i * 3 + 1] - cy);
      this.velocity[i * 3 + 1] += 1.5 + 2.6 * (this.x[i * 3] - cx);
    }
  }
  stats(): {
    volumeRatio: number;
    minJacobian: number;
    kineticEnergy: number;
    steps: number;
  } {
    let volume = 0,
      restVolume = 0,
      minJacobian = Infinity,
      kineticEnergy = 0;
    for (let t = 0; t < this.volumes.length; t++) {
      this.deformation(t);
      const j = determinant(this.f);
      volume += j * this.volumes[t];
      restVolume += this.volumes[t];
      minJacobian = Math.min(minJacobian, j);
    }
    for (let i = 0; i < this.nodeCount; i++)
      if (this.invMass[i])
        for (let k = 0; k < 3; k++)
          kineticEnergy +=
            (0.5 * this.velocity[i * 3 + k] ** 2) / this.invMass[i];
    return {
      volumeRatio: volume / restVolume,
      minJacobian,
      kineticEnergy,
      steps: this.steps,
    };
  }
  /** Returned buffer is reused on subsequent calls. Row-major F maps rest tangents to current tangents. */
  nodalTransforms(): Float64Array {
    this.transforms.fill(0);
    for (let t = 0; t < this.volumes.length; t++) {
      this.deformation(t);
      for (let n = 0; n < 4; n++)
        for (let k = 0; k < 9; k++)
          this.transforms[this.ids[t * 4 + n] * 9 + k] +=
            this.f[k] * this.volumes[t];
    }
    for (let i = 0; i < this.nodeCount; i++)
      for (let k = 0; k < 9; k++)
        this.transforms[i * 9 + k] = this.nodeVolumes[i]
          ? this.transforms[i * 9 + k] / this.nodeVolumes[i]
          : k % 4 === 0
            ? 1
            : 0;
    return this.transforms;
  }
}
