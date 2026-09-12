import type { Cage } from './cage.ts';
import type { VolumeSoftBody } from './solver.ts';
import { ContactRim } from './contact-rim.ts';
import { inverseCandyCompression } from '../candy-deformation.ts';
import { ContactSkin } from './contact-skin.ts';

/** Fine normal degrees of freedom coupled to the coarse tetrahedral solid.
 * Contact is an inward unilateral constraint against an oriented rounded box.
 * The lab's hand constrains orientation, but translation has finite mass.
 * This is a supported-pose contact model, not a topology-changing fluid. */
export class ContactShell {
  /** Zero is ordinary solid contact; one allows the gel interface to reclose. */
  permeability = 0;
  readonly displacement: Float64Array;
  readonly velocity: Float64Array;
  readonly rim: ContactRim;
  readonly skin: ContactSkin;
  readonly candy = {
    position: new Float64Array(3),
    target: new Float64Array(3),
    velocity: new Float64Array(3),
    rotation: new Float64Array([0, 0, 0, 1]),
    half: 0.18,
    radius: 0.045,
    mass: 0.04,
    compression: 0,
    compressionAxis: new Float64Array([0, 1, 0]),
  };
  private rest: Float32Array;
  private normals: Float32Array;
  private supported: boolean;
  private reach: number;
  setFrameNormals(normals: ArrayLike<number>) {
    this.normals.set(normals);
  }
  private masses: Float64Array;
  private ids: Uint16Array;
  private weights: Float32Array;
  private edges: { a: number; b: number; k: number }[] = [];
  private candidates: number[] = [];
  private index: Uint32Array;
  private contactTriangles: number[] = [];
  private triangle = new Float64Array(9);
  private facePositions: Float64Array;
  private faceStamps: Uint32Array;
  private facePass = 0;
  private gradient = new Float64Array(3);
  private triangleSamples = [
    [1 / 3, 1 / 3, 1 / 3],
    [0.5, 0.5, 0],
    [0, 0.5, 0.5],
    [0.5, 0, 0.5],
  ];
  private active: number[] = [];
  private activeEdges: { a: number; b: number; k: number }[] = [];
  private region = new Float64Array(3);
  private regionAge = 0;
  private previous: Float64Array;
  private previousCandy = new Float64Array(3);
  private acceleration: Float64Array;
  private rotation = new Float64Array(9);
  private inverseTransform = new Float64Array(9);
  private embeddedCache: Float64Array;
  private embeddedStamps: Uint32Array;
  private embeddedPass = 0;
  private frozenBase = false;
  private contactCount = 0;
  private wetSectors = new Uint8Array(12);
  private reaction = 0;
  private p = new Float64Array(3);
  private local = new Float64Array(3);
  private localNormal = new Float64Array(3);
  private touched: Uint8Array;
  constructor(
    cage: Cage,
    positions: ArrayLike<number>,
    normals: ArrayLike<number>,
    index: ArrayLike<number>,
    options: { supported?: boolean; reach?: number } = {},
  ) {
    this.supported = options.supported ?? true;
    this.index = Uint32Array.from(index);
    this.reach = options.reach ?? 1.05;
    this.rest = Float32Array.from(positions);
    this.normals = Float32Array.from(normals);
    const count = positions.length / 3;
    this.embeddedCache = new Float64Array(positions.length);
    this.embeddedStamps = new Uint32Array(count);
    this.facePositions = new Float64Array(positions.length);
    this.faceStamps = new Uint32Array(count);
    this.rim = new ContactRim(count);
    this.skin = new ContactSkin(this.rest, index);
    this.displacement = new Float64Array(count);
    this.velocity = new Float64Array(count);
    this.previous = new Float64Array(count);
    this.acceleration = new Float64Array(count);
    this.masses = new Float64Array(count);
    this.ids = new Uint16Array(count * 4);
    this.weights = new Float32Array(count * 4);
    this.touched = new Uint8Array(count);
    const unique = new Map<string, { a: number; b: number; length: number }>(),
      degree = new Uint16Array(count);
    for (let i = 0; i < index.length; i += 3) {
      const a = index[i],
        b = index[i + 1],
        c = index[i + 2];
      const ux = positions[b * 3] - positions[a * 3],
        uy = positions[b * 3 + 1] - positions[a * 3 + 1],
        uz = positions[b * 3 + 2] - positions[a * 3 + 2];
      const vx = positions[c * 3] - positions[a * 3],
        vy = positions[c * 3 + 1] - positions[a * 3 + 1],
        vz = positions[c * 3 + 2] - positions[a * 3 + 2];
      const area =
        Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
      for (const id of [a, b, c]) this.masses[id] += (area * 0.08) / 3;
      for (const [u, v] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const lo = Math.min(u, v),
          hi = Math.max(u, v),
          key = lo + ':' + hi;
        if (unique.has(key)) continue;
        const length = Math.hypot(
          positions[lo * 3] - positions[hi * 3],
          positions[lo * 3 + 1] - positions[hi * 3 + 1],
          positions[lo * 3 + 2] - positions[hi * 3 + 2],
        );
        if (length < 1e-5) continue;
        unique.set(key, { a: lo, b: hi, length });
        degree[lo]++;
        degree[hi]++;
      }
    }
    for (let i = 0; i < count; i++) {
      this.masses[i] = Math.max(1e-7, this.masses[i]);
      const bind = cage.bind([
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      ]);
      this.ids.set(bind.ids, i * 4);
      this.weights.set(bind.weights, i * 4);
    }
    for (const e of unique.values()) {
      const mass = 2 / (1 / this.masses[e.a] + 1 / this.masses[e.b]);
      // Symmetric edge force; normal waves travel beyond the contact footprint.
      const k =
        (mass * 0.8 ** 2) /
        Math.max(0.015, e.length) ** 2 /
        Math.max(degree[e.a], degree[e.b]);
      this.edges.push({ a: e.a, b: e.b, k });
    }
    this.setRegion([0, 1, 1]);
  }
  setRegion(point: ArrayLike<number>, reach = this.reach) {
    this.reach = Math.max(0.2, Math.min(1.5, reach));
    this.region.set(point);
    this.candidates = [];
    for (let i = 0; i < this.displacement.length; i++)
      if (
        Math.hypot(
          this.rest[i * 3] - point[0],
          this.rest[i * 3 + 1] - point[1],
          this.rest[i * 3 + 2] - point[2],
        ) <
        this.reach * (0.86 / 1.05)
      )
        this.candidates.push(i);
    this.refreshActive();
  }
  private refreshActive() {
    // Keep the current pressure neighbourhood and every moving old contact.
    // Retargeting never resets a dent; quiet remote skin stays at rest cheaply.
    const active = new Uint8Array(this.displacement.length);
    for (let i = 0; i < active.length; i++)
      if (
        Math.hypot(
          this.rest[i * 3] - this.region[0],
          this.rest[i * 3 + 1] - this.region[1],
          this.rest[i * 3 + 2] - this.region[2],
        ) < this.reach ||
        this.displacement[i] !== 0 ||
        this.velocity[i] !== 0
      )
        active[i] = 1;
    // One extra ring transmits the decaying spring wave beyond the active set.
    const extended = active.slice();
    for (const { a, b } of this.edges)
      if (active[a] || active[b]) extended[a] = extended[b] = 1;
    this.active = [];
    for (let i = 0; i < extended.length; i++)
      if (extended[i]) this.active.push(i);
    this.activeEdges = this.edges.filter((e) => extended[e.a] && extended[e.b]);
    const candidates = new Set(this.candidates);
    this.contactTriangles = [];
    for (let i = 0; i < this.index.length; i += 3)
      if (
        candidates.has(this.index[i]) ||
        candidates.has(this.index[i + 1]) ||
        candidates.has(this.index[i + 2])
      )
        this.contactTriangles.push(i);
    this.regionAge = 0;
  }
  private base(i: number, solver: VolumeSoftBody) {
    const start = i * 3;
    if (this.frozenBase && this.embeddedStamps[i] === this.embeddedPass) {
      this.p[0] = this.embeddedCache[start];
      this.p[1] = this.embeddedCache[start + 1];
      this.p[2] = this.embeddedCache[start + 2];
      return;
    }
    let x = 0,
      y = 0,
      z = 0;
    for (let k = 0; k < 4; k++) {
      const j = this.ids[i * 4 + k] * 3,
        w = this.weights[i * 4 + k];
      x += solver.x[j] * w;
      y += solver.x[j + 1] * w;
      z += solver.x[j + 2] * w;
    }
    this.p[0] = x;
    this.p[1] = y;
    this.p[2] = z;
    if (this.frozenBase) {
      this.embeddedStamps[i] = this.embeddedPass;
      this.embeddedCache[start] = x;
      this.embeddedCache[start + 1] = y;
      this.embeddedCache[start + 2] = z;
    }
  }
  beginStep(dt: number, solver: VolumeSoftBody) {
    this.regionAge += dt;
    if (this.regionAge >= 0.25) this.refreshActive();
    this.previous.set(this.displacement);
    this.previousCandy.set(this.candy.position);
    this.contactCount = this.reaction = 0;
    this.touched.fill(0);
    const [x, y, z, w] = this.candy.rotation;
    this.rotation.set([
      1 - 2 * (y * y + z * z),
      2 * (x * y + z * w),
      2 * (x * z - y * w),
      2 * (x * y - z * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z + x * w),
      2 * (x * z + y * w),
      2 * (y * z - x * w),
      1 - 2 * (x * x + y * y),
    ]);
    // Rotation and gummy compression stay fixed during this physical step.
    // Cache R^-1 C^-1 once instead of rebuilding it for every surface query.
    for (let row = 0; row < 3; row++) {
      const j = row * 3;
      inverseCandyCompression(
        this.rotation[j],
        this.rotation[j + 1],
        this.rotation[j + 2],
        this.candy.compression,
        this.candy.compressionAxis,
        this.local,
      );
      this.inverseTransform[j] = this.local[0];
      this.inverseTransform[j + 1] = this.local[1];
      this.inverseTransform[j + 2] = this.local[2];
    }
    // A light supported-pose tether belongs to this closeup stand, not gameplay.
    solver.wake();
    if (this.supported)
      for (let i = 0; i < solver.x.length; i++)
        solver.velocity[i] +=
          ((solver.rest[i] - solver.x[i]) * 16 - solver.velocity[i] * 3) * dt;
    for (const i of this.active) {
      const force =
        (-144 * this.displacement[i] - 14 * this.velocity[i]) * this.masses[i];
      this.acceleration[i] = force / this.masses[i];
      if (Math.abs(force) < 1e-12) continue;
      for (let k = 0; k < 4; k++) {
        const id = this.ids[i * 4 + k],
          s = (-force * this.weights[i * 4 + k] * dt) / solver.mass[id];
        for (let a = 0; a < 3; a++)
          solver.velocity[id * 3 + a] += this.normals[i * 3 + a] * s;
      }
    }
    for (const { a, b, k } of this.activeEdges) {
      const force = (this.displacement[b] - this.displacement[a]) * k;
      this.acceleration[a] += force / this.masses[a];
      this.acceleration[b] -= force / this.masses[b];
    }
    for (const i of this.active) {
      this.velocity[i] += this.acceleration[i] * dt;
      this.displacement[i] += this.velocity[i] * dt;
    }
    for (let a = 0; a < 3; a++) {
      const acceleration =
        (this.candy.target[a] - this.candy.position[a]) * 650 -
        this.candy.velocity[a] * 35;
      this.candy.velocity[a] = Math.max(
        -2.5,
        Math.min(2.5, this.candy.velocity[a] + acceleration * dt),
      );
      this.candy.position[a] += this.candy.velocity[a] * dt;
    }
    this.rim.step(dt, this.candy, (i, out) => {
      this.base(i, solver);
      for (let a = 0; a < 3; a++)
        out[a] = this.p[a] + this.normals[i * 3 + a] * this.displacement[i];
    });
  }
  private transform(x: number, y: number, z: number, out: Float64Array) {
    const r = this.inverseTransform;
    out[0] = r[0] * x + r[1] * y + r[2] * z;
    out[1] = r[3] * x + r[4] * y + r[5] * z;
    out[2] = r[6] * x + r[7] * y + r[8] * z;
  }
  private sdf(x: number, y: number, z: number) {
    const h = this.candy.half - this.candy.radius;
    const a = Math.abs(x) - h,
      b = Math.abs(y) - h,
      c = Math.abs(z) - h;
    const u = Math.max(0, a),
      v = Math.max(0, b),
      w = Math.max(0, c);
    return (
      Math.sqrt(u * u + v * v + w * w) +
      Math.min(Math.max(a, b, c), 0) -
      this.candy.radius
    );
  }
  private outward(x: number, y: number, z: number) {
    const e = 0.0001,
      r = this.rotation,
      s = 1 - this.candy.compression;
    let gx = this.sdf(x + e, y, z) - this.sdf(x - e, y, z),
      gy = this.sdf(x, y + e, z) - this.sdf(x, y - e, z),
      gz = this.sdf(x, y, z + e) - this.sdf(x, y, z - e);
    const len = Math.hypot(gx, gy, gz) || 1;
    gx /= len;
    gy /= len;
    gz /= len;
    inverseCandyCompression(
      r[0] * gx + r[3] * gy + r[6] * gz,
      r[1] * gx + r[4] * gy + r[7] * gz,
      r[2] * gx + r[5] * gy + r[8] * gz,
      1 - s,
      this.candy.compressionAxis,
      this.gradient,
    );
    const scale = Math.hypot(...this.gradient) || 1;
    for (let a = 0; a < 3; a++) this.gradient[a] /= scale;
    return scale;
  }
  private projectFaces(solver: VolumeSoftBody, strength: number) {
    // Cache shared embedded vertices once per pass. A conservative world AABB
    // rejects remote triangles before the four exact rounded-box queries.
    const pass = ++this.facePass,
      bound =
        (this.candy.half * Math.sqrt(3)) /
          Math.sqrt(1 - Math.max(0, this.candy.compression)) +
        0.002;
    for (const ti of this.contactTriangles) {
      if (
        !this.rim.movable[this.index[ti]] &&
        !this.rim.movable[this.index[ti + 1]] &&
        !this.rim.movable[this.index[ti + 2]]
      )
        continue;
      for (let k = 0; k < 3; k++) {
        const i = this.index[ti + k];
        if (this.faceStamps[i] !== pass) {
          this.faceStamps[i] = pass;
          this.base(i, solver);
          for (let a = 0; a < 3; a++)
            this.facePositions[i * 3 + a] =
              this.p[a] +
              this.normals[i * 3 + a] * this.displacement[i] +
              this.rim.offset[i * 3 + a];
        }
        for (let a = 0; a < 3; a++)
          this.triangle[k * 3 + a] = this.facePositions[i * 3 + a];
      }
      const t = this.triangle,
        c = this.candy.position;
      if (
        Math.min(t[0], t[3], t[6]) > c[0] + bound ||
        Math.max(t[0], t[3], t[6]) < c[0] - bound ||
        Math.min(t[1], t[4], t[7]) > c[1] + bound ||
        Math.max(t[1], t[4], t[7]) < c[1] - bound ||
        Math.min(t[2], t[5], t[8]) > c[2] + bound ||
        Math.max(t[2], t[5], t[8]) < c[2] - bound
      )
        continue;
      for (const weights of this.triangleSamples) {
        const p = this.triangle;
        this.transform(
          p[0] * weights[0] +
            p[3] * weights[1] +
            p[6] * weights[2] -
            this.candy.position[0],
          p[1] * weights[0] +
            p[4] * weights[1] +
            p[7] * weights[2] -
            this.candy.position[1],
          p[2] * weights[0] +
            p[5] * weights[1] +
            p[8] * weights[2] -
            this.candy.position[2],
          this.local,
        );
        const [x, y, z] = this.local,
          penetration = this.sdf(x, y, z);
        if (penetration >= -0.0002) continue;
        const scale = this.outward(x, y, z);
        let inverseMass = 0;
        for (let k = 0; k < 3; k++)
          inverseMass += weights[k] ** 2 * this.rim.movable[this.index[ti + k]];
        if (inverseMass === 0) continue;
        const correction =
          ((-penetration + 0.0008) * strength) / scale / inverseMass;
        for (let k = 0; k < 3; k++)
          if (this.rim.movable[this.index[ti + k]])
            for (let a = 0; a < 3; a++) {
              const d = this.gradient[a] * correction * weights[k];
              this.rim.offset[this.index[ti + k] * 3 + a] += d;
              this.facePositions[this.index[ti + k] * 3 + a] += d;
              this.triangle[k * 3 + a] += d;
            }
      }
    }
  }
  private measureWetting(solver: VolumeSoftBody) {
    const bound =
      (this.candy.half * Math.sqrt(3)) /
        Math.sqrt(1 - Math.max(0, this.candy.compression)) +
      0.03;
    const coverage = this.skin.wetting(this.rim.normal, bound);
    if (coverage !== undefined) {
      this.rim.coverage = coverage * this.rim.amount;
      return;
    }
    this.wetSectors.fill(0);
    const n = this.rim.normal,
      center = this.candy.position,
      h = this.candy.half;
    const wetBound =
      (h * Math.sqrt(3)) / Math.sqrt(1 - Math.max(0, this.candy.compression)) +
      0.03;
    // A fixed tangent basis partitions the actual candy flank into sectors.
    let ux = Math.abs(n[1]) < 0.85 ? -n[2] : 0,
      uy = Math.abs(n[1]) < 0.85 ? 0 : n[2],
      uz = Math.abs(n[1]) < 0.85 ? n[0] : -n[1];
    const len = Math.hypot(ux, uy, uz) || 1;
    ux /= len;
    uy /= len;
    uz /= len;
    const vx = n[1] * uz - n[2] * uy,
      vy = n[2] * ux - n[0] * uz,
      vz = n[0] * uy - n[1] * ux;
    const sample = (x: number, y: number, z: number) => {
      x -= center[0];
      y -= center[1];
      z -= center[2];
      // Conservative enclosing sphere: no possible wet sample lies outside it.
      if (x * x + y * y + z * z > wetBound * wetBound) return;
      const axial = x * n[0] + y * n[1] + z * n[2];
      // Wetting starts around the rear shoulder, before the gel can reach
      // the equator. Ignore the central pressed face; count only its perimeter
      // and lower flank, including the rounded back corners of oblique cubes.
      if (
        axial < -h * 1.1 ||
        axial > h * 0.6 ||
        x * x + y * y + z * z - axial * axial < (h * 0.75) ** 2
      )
        return;
      this.transform(x, y, z, this.local);
      const distance = this.sdf(this.local[0], this.local[1], this.local[2]);
      if (distance < -0.003 || distance > 0.018) return;
      const angle = Math.atan2(
        x * vx + y * vy + z * vz,
        x * ux + y * uy + z * uz,
      );
      this.wetSectors[
        Math.min(11, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 12))
      ] = 1;
    };
    const stamp = ++this.facePass;
    for (const t of this.contactTriangles) {
      if (
        !this.rim.movable[this.index[t]] &&
        !this.rim.movable[this.index[t + 1]] &&
        !this.rim.movable[this.index[t + 2]]
      )
        continue;
      for (let k = 0; k < 3; k++) {
        const i = this.index[t + k],
          j = i * 3;
        if (this.faceStamps[i] !== stamp) {
          this.base(i, solver);
          for (let a = 0; a < 3; a++)
            this.facePositions[j + a] =
              this.p[a] +
              this.normals[j + a] * this.displacement[i] +
              this.rim.offset[j + a];
          this.faceStamps[i] = stamp;
          sample(
            this.facePositions[j],
            this.facePositions[j + 1],
            this.facePositions[j + 2],
          );
        }
        for (let a = 0; a < 3; a++)
          this.triangle[k * 3 + a] = this.facePositions[j + a];
      }
      for (const w of this.triangleSamples) {
        sample(
          w[0] * this.triangle[0] +
            w[1] * this.triangle[3] +
            w[2] * this.triangle[6],
          w[0] * this.triangle[1] +
            w[1] * this.triangle[4] +
            w[2] * this.triangle[7],
          w[0] * this.triangle[2] +
            w[1] * this.triangle[5] +
            w[2] * this.triangle[8],
        );
      }
    }
    let count = 0;
    for (const v of this.wetSectors) count += v;
    this.rim.coverage = (count / 12) * this.rim.amount;
  }
  project(dt: number, solver: VolumeSoftBody, _iteration: number) {
    // Once wetting has opened the interface, this is an adhesive contact,
    // not a rigid excluded volume. Repeated fractional SDF projection still
    // behaves like a hard wall and flips its normal across the candy medial
    // axis, producing spikes. The existing skin displacement heals through
    // the same damped springs; no positions are reset at this transition.
    const strength = this.permeability > 0 ? 0 : 1;
    if (strength < 0.00001) return;
    for (const i of this.candidates) {
      if (this.rim.amount > 0.01 && !this.rim.movable[i]) continue;
      this.base(i, solver);
      const nx = this.normals[i * 3],
        ny = this.normals[i * 3 + 1],
        nz = this.normals[i * 3 + 2],
        d = this.displacement[i];
      this.transform(
        this.p[0] + nx * d + this.rim.offset[i * 3] - this.candy.position[0],
        this.p[1] +
          ny * d +
          this.rim.offset[i * 3 + 1] -
          this.candy.position[1],
        this.p[2] +
          nz * d +
          this.rim.offset[i * 3 + 2] -
          this.candy.position[2],
        this.local,
      );
      const [x, y, z] = this.local;
      if (this.sdf(x, y, z) >= -0.00005) continue;
      if (this.rim.amount > 0.01) {
        // A wet rim is free to slide around the flank. Project to the nearest
        // solid surface, rather than forcing these vertices through its back.
        const scale = this.outward(x, y, z),
          amount = ((-this.sdf(x, y, z) + 0.00015) * strength) / scale;
        for (let a = 0; a < 3; a++)
          this.rim.offset[i * 3 + a] += this.gradient[a] * amount;
        if (!this.touched[i]) {
          this.touched[i] = 1;
          this.contactCount++;
        }
        continue;
      }
      this.transform(nx, ny, nz, this.localNormal);
      const [u, v, w] = this.localNormal;
      // Select the inward exit, never the outside rim or a camera-space axis.
      let low = 0,
        high = 0.65;
      for (let j = 0; j < 12; j++) {
        const mid = (low + high) / 2;
        if (this.sdf(x - u * mid, y - v * mid, z - w * mid) < 0) low = mid;
        else high = mid;
      }
      const inverseFine = 1 / this.masses[i],
        inverseCandy = 1 / this.candy.mass;
      let inverseBody = 0;
      for (let k = 0; k < 4; k++)
        inverseBody +=
          this.weights[i * 4 + k] ** 2 / solver.mass[this.ids[i * 4 + k]];
      const impulse =
        ((high + 0.00015) * strength) /
        (inverseFine + inverseBody + inverseCandy);
      this.displacement[i] -= impulse * inverseFine;
      for (let k = 0; k < 4; k++) {
        const id = this.ids[i * 4 + k],
          s = (impulse * this.weights[i * 4 + k]) / solver.mass[id];
        solver.x[id * 3] -= nx * s;
        solver.x[id * 3 + 1] -= ny * s;
        solver.x[id * 3 + 2] -= nz * s;
      }
      this.candy.position[0] += nx * impulse * inverseCandy;
      this.candy.position[1] += ny * impulse * inverseCandy;
      this.candy.position[2] += nz * impulse * inverseCandy;
      this.reaction += impulse / (dt * dt);
      if (!this.touched[i]) {
        this.touched[i] = 1;
        this.contactCount++;
      }
    }
  }
  private regularize(dt: number, solver: VolumeSoftBody, strength: number) {
    this.embeddedPass++;
    this.frozenBase = true;
    this.skin.prepare((i, out) => {
      this.base(i, solver);
      for (let a = 0; a < 3; a++)
        out[a] = this.p[a] + this.normals[i * 3 + a] * this.displacement[i];
    });
    const passes = strength > 0 ? 6 : 2;
    const touched = this.skin.regularizeContact(
      this.rim.offset,
      this.candidates,
      this.contactTriangles,
      this.candy.position,
      this.inverseTransform,
      this.candy.half,
      this.candy.radius,
      passes,
      strength > 0.00001 && this.rim.amount > 0.01,
      (this.candy.half * Math.sqrt(3)) /
        Math.sqrt(1 - Math.max(0, this.candy.compression)) +
        0.002,
    );
    if (touched) {
      for (const i of this.candidates)
        if (touched[i] && !this.touched[i]) {
          this.touched[i] = 1;
          this.contactCount++;
        }
    } else {
      for (let pass = 0; pass < passes; pass++) {
        this.skin.solve(this.rim.offset);
        if (strength > 0.00001 && this.rim.amount > 0.01) {
          this.project(dt, solver, -1);
          this.projectFaces(solver, strength);
        }
      }
    }
    this.measureWetting(solver);
    this.frozenBase = false;
  }
  endStep(dt: number, solver?: VolumeSoftBody) {
    // The coarse step still projects volume/floor after its contact callback.
    // Finish the embedded skin against the actual final coarse positions.
    if (
      solver &&
      ((this.rim.amount > 0.01 && this.permeability === 0) ||
        this.rim.maxOffset > 1e-5)
    )
      this.regularize(dt, solver, this.permeability > 0 ? 0 : 1);
    this.rim.finishStep(dt);
    for (const i of this.active) {
      this.displacement[i] = Math.max(
        -0.38,
        Math.min(0.09, this.displacement[i]),
      );
      this.velocity[i] = (this.displacement[i] - this.previous[i]) / dt;
      if (
        Math.abs(this.displacement[i]) < 1e-8 &&
        Math.abs(this.velocity[i]) < 1e-7
      )
        this.displacement[i] = this.velocity[i] = 0;
    }
    for (let a = 0; a < 3; a++)
      this.candy.velocity[a] =
        (this.candy.position[a] - this.previousCandy[a]) / dt;
  }
  get contacting() {
    return this.contactCount > 0;
  }
  resetDeformation() {
    this.rim.reset();
    this.displacement.fill(0);
    this.velocity.fill(0);
    this.previous.fill(0);
    this.acceleration.fill(0);
    this.touched.fill(0);
    this.candy.velocity.fill(0);
    this.previousCandy.set(this.candy.position);
    this.contactCount = this.reaction = 0;
    this.refreshActive();
  }
  apply(positions: Float32Array) {
    for (const i of this.active)
      for (let a = 0; a < 3; a++)
        positions[i * 3 + a] += this.normals[i * 3 + a] * this.displacement[i];
    this.rim.apply(positions);
  }
  stats() {
    let maxIndent = 0,
      maxOutward = 0,
      localIndent = 0;
    const normalOffset = (i: number) =>
      this.displacement[i] +
      this.normals[i * 3] * this.rim.offset[i * 3] +
      this.normals[i * 3 + 1] * this.rim.offset[i * 3 + 1] +
      this.normals[i * 3 + 2] * this.rim.offset[i * 3 + 2];
    for (const i of this.candidates)
      localIndent = Math.max(localIndent, -normalOffset(i));
    let rimOffset = 0;
    for (const i of this.active) {
      const d = normalOffset(i);
      rimOffset = Math.max(
        rimOffset,
        Math.hypot(
          this.rim.offset[i * 3],
          this.rim.offset[i * 3 + 1],
          this.rim.offset[i * 3 + 2],
        ),
      );
      maxIndent = Math.max(maxIndent, -d);
      maxOutward = Math.max(maxOutward, d);
    }
    this.rim.maxOffset = rimOffset;
    return {
      contacts: this.contactCount,
      reaction: this.reaction,
      maxIndent,
      localIndent,
      maxOutward,
      fineNodes: this.displacement.length,
      activeNodes: this.active.length,
      candidates: this.candidates.length,
      coverage: this.rim.coverage,
      skinBackend: this.skin.backend,
      rimOffset: this.rim.maxOffset,
    };
  }
}
