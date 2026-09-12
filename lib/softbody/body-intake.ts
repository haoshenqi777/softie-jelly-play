import * as THREE from 'three/webgpu';
import type { Cage } from './cage.ts';
import type { VolumeSoftBody } from './solver.ts';
import type { CandyBody } from '../candy-physics.ts';
import { candyBevel, roundCandy } from '../candy-physics.ts';
import { ContactShell } from './contact-shell.ts';
import { ContactIntake } from '../contact-intake.ts';
import { MaterialAnchor } from './material-anchor.ts';
import { candyCompressionMatrix } from '../candy-deformation.ts';
import { allowsHandCandyPress } from './candy-press-region.ts';
import { updateDeformedSurface } from './deformed-surface.ts';

/** One penetrable contact carried in material coordinates, without a stand. */
export class BodyIntake {
  readonly shell: ContactShell;
  readonly flow = new ContactIntake({ cohesive: true });
  candy: CandyBody | null = null;
  anchor: MaterialAnchor | null = null;
  private rest: Float32Array;
  private restNormals: Float32Array;
  private frameNormals: Float32Array;
  private contactMemory = 0;
  private previous: ReturnType<MaterialAnchor['sample']> | null = null;
  private localRotation = new THREE.Quaternion();
  private floorTransform = new THREE.Matrix4();
  private floorRotation = new THREE.Matrix4();
  private floorQuaternion = new THREE.Quaternion();
  private scale = 1;
  private pending = false;
  private manual = false;
  private withdrawing = false;
  private pressure = 0;
  private contactClock = 0;
  private contactStep = 0;
  // Fine contact has its own clock; material transport still runs every step.
  private contactInterval = 1 / 120;
  get held() {
    return this.manual;
  }
  beginHeld(candy: CandyBody, point: THREE.Vector3, normal: THREE.Vector3) {
    if (this.active || candy.mode !== 'held') return false;
    candy.mode = 'free';
    if (!this.beginContact(candy, point, normal, true)) {
      candy.mode = 'held';
      return false;
    }
    this.manual = true;
    this.pressure = 0;
    candy.mode = 'held';
    candy.contactHeld = true;
    return true;
  }
  setPressure(depth: number) {
    if (this.manual && Number.isFinite(depth))
      this.pressure = Math.max(0, Math.min(100, depth));
  }
  releaseHeld(cancelled = false) {
    if (!this.manual || !this.candy) return false;
    const offset =
      new THREE.Vector3()
        .fromArray(this.shell.candy.position)
        .sub(this.previous!.point)
        .dot(this.previous!.normal) / this.scale;
    const accept =
      !cancelled &&
      this.pressure >= 55 &&
      offset < -0.063 &&
      this.shell.stats().localIndent > 0.012;
    this.manual = false;
    if (!accept) {
      this.withdrawing = true;
      this.candy.mode = 'free';
      return true;
    }
    this.candy.contactHeld = false;
    this.candy.mode = 'merging';
    this.flow.releaseContact(offset, this.shell.rim.amount);
    return true;
  }
  constructor(
    private cage: Cage,
    private solver: VolumeSoftBody,
    private body: THREE.Mesh,
  ) {
    this.rest = Float32Array.from(body.geometry.attributes.position.array);
    this.restNormals = Float32Array.from(body.geometry.attributes.normal.array);
    this.frameNormals = this.restNormals.slice();
    this.shell = new ContactShell(
      cage,
      this.rest,
      this.restNormals,
      body.geometry.index!.array,
      { supported: false, reach: 0.6 },
    );
    this.shell.permeability = 1;
  }
  get active() {
    return this.candy !== null && this.flow.frame().stage !== 'done';
  }
  begin(candy: CandyBody, point: THREE.Vector3, normal: THREE.Vector3) {
    return this.beginContact(candy, point, normal, false);
  }
  allowsHeldContact(hit: THREE.Intersection) {
    const rest = this.restContact(hit);
    return rest !== null && allowsHandCandyPress(rest.point);
  }
  private restContact(hit: THREE.Intersection) {
    if (hit.object !== this.body || !hit.face) return null;
    const ids = [hit.face.a, hit.face.b, hit.face.c],
      p = this.body.geometry.attributes.position;
    const triangle = new THREE.Triangle(
      ...(ids.map((id) => new THREE.Vector3().fromBufferAttribute(p, id)) as [
        THREE.Vector3,
        THREE.Vector3,
        THREE.Vector3,
      ]),
    );
    const weights = triangle.getBarycoord(
      this.body.worldToLocal(hit.point.clone()),
      new THREE.Vector3(),
    );
    if (!weights) return null;
    const rp = new THREE.Vector3(),
      rn = new THREE.Vector3();
    ids.forEach((id, k) => {
      rp.addScaledVector(
        new THREE.Vector3().fromArray(this.rest, id * 3),
        weights.getComponent(k),
      );
      rn.addScaledVector(
        new THREE.Vector3().fromArray(this.restNormals, id * 3),
        weights.getComponent(k),
      );
    });
    return { point: rp, normal: rn.normalize() };
  }
  private beginContact(
    candy: CandyBody,
    point: THREE.Vector3,
    normal: THREE.Vector3,
    held: boolean,
  ) {
    if (this.active || candy.mode !== 'free') return false;
    this.body.updateWorldMatrix(true, false);
    const ray = new THREE.Raycaster(
      point.clone().addScaledVector(normal, 0.4),
      normal.clone().negate(),
    );
    const hit = ray.intersectObject(this.body)[0];
    if (!hit?.face) return false;
    if (hit.point.distanceTo(point) > candy.radius * 2 + 0.06) return false;
    const rest = this.restContact(hit);
    if (!rest || (held && !allowsHandCandyPress(rest.point))) return false;
    const rp = rest.point,
      rn = rest.normal;
    this.anchor = new MaterialAnchor(this.cage, rp, rn.normalize());
    this.previous = this.anchor.sample(this.solver.x);
    this.candy = candy;
    this.scale = candy.radius / 0.18;
    this.shell.candy.half = candy.radius;
    this.shell.candy.radius = candyBevel(candy.kind, candy.radius);
    this.flow.setDigestionShape(
      roundCandy(candy.kind)
        ? 'round'
        : { bevel: this.shell.candy.radius / this.scale },
    );
    this.shell.candy.mass = 0.04 * this.scale ** 3;
    this.shell.setRegion(
      rp.toArray(),
      Math.max(0.6, candy.radius * (1.05 / 0.18)),
    );
    this.shell.rim.bind(this.rest, rp.toArray(), rn.toArray(), candy.radius);
    this.shell.skin.bind(this.shell.rim.movable);
    this.shell.permeability = 0;
    if (candy.kind === 'gummy' && candy.y < candy.radius + 0.03)
      candy.y = candy.radius * (1 - candy.compression);
    this.shell.candy.position.set([candy.x, candy.y, candy.z]);
    this.shell.candy.velocity.fill(0);
    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(candy.rx, candy.ry, candy.rz),
    );
    this.localRotation.copy(this.previous.rotation).invert().multiply(rotation);
    this.shell.candy.rotation.set(rotation.toArray());
    this.flow.start(
      new THREE.Vector3(candy.x, candy.y, candy.z)
        .sub(this.previous.point)
        .dot(this.previous.normal) / this.scale,
    );
    candy.mode = 'merging';
    candy.sleeping = false;
    candy.vx = candy.vy = candy.vz = 0;
    this.frameNormals.set(this.body.geometry.attributes.normal.array);
    this.contactMemory = 0;
    this.pending = true;
    this.solver.wake();
    return true;
  }
  prepare() {
    if (this.pending) this.shell.setFrameNormals(this.frameNormals);
  }
  beginStep(dt: number) {
    this.contactStep = 0;
    if (!this.pending) return;
    this.contactClock += dt;
    if (this.contactClock + 1e-12 >= this.contactInterval) {
      this.contactStep = Math.min(this.contactClock, this.contactInterval);
      this.contactClock = Math.max(0, this.contactClock - this.contactStep);
    }
    if (this.anchor && this.candy && this.previous) {
      const now = this.anchor.sample(this.solver.x),
        delta = now.rotation
          .clone()
          .multiply(this.previous.rotation.clone().invert());
      const position = new THREE.Vector3()
        .fromArray(this.shell.candy.position)
        .sub(this.previous.point)
        .applyQuaternion(delta)
        .add(now.point);
      this.shell.rim.transport(delta.toArray());
      this.shell.candy.compression =
        this.candy.kind === 'gummy' ? this.candy.compression : 0;
      const axis = new THREE.Vector3().fromArray(
        this.candy.compressionAxis ?? [0, 1, 0],
      );
      // A squash axis has no sign. Blend the equivalent nearby normal to avoid
      // a zero vector when the floor load hands off to the underside of the gel.
      const direction = now.normal.clone();
      if (axis.dot(direction) < 0) direction.negate();
      axis.lerp(direction, 1 - Math.exp(-dt * 12)).normalize();
      this.candy.compressionAxis = axis.toArray();
      this.shell.candy.compressionAxis.set(axis.toArray());
      position.y = Math.max(this.floorRadius(), position.y);
      this.shell.candy.position.set(position.toArray());
      this.shell.candy.velocity.set(
        new THREE.Vector3()
          .fromArray(this.shell.candy.velocity)
          .applyQuaternion(delta)
          .toArray(),
      );
      this.shell.candy.rotation.set(
        now.rotation.clone().multiply(this.localRotation).toArray(),
      );
      // Material transport follows every coarse step, even when the expensive
      // local deformation is not due. A turn must never leave candy behind.
      this.shell.rim.point.set(now.point.toArray());
      this.shell.rim.normal.set(now.normal.toArray());
      if (this.contactStep === 0) {
        this.previous = now;
        return;
      }
      dt = this.contactStep;
      const burial =
        (-position.sub(now.point).dot(now.normal) - this.candy.radius) /
        this.scale;
      this.contactMemory = this.shell.contacting
        ? 0.065
        : Math.max(0, this.contactMemory - dt);
      const f = this.withdrawing
        ? { offset: 0.32, permeability: 0 }
        : this.manual
          ? // Stop hand pressure at -0.12; deeper entry belongs to absorption.
            { offset: 0.23 - this.pressure * 0.0035, permeability: 0 }
          : this.flow.update(dt, {
              contact: this.contactMemory > 0,
              burial,
              indent: this.shell.stats().localIndent / this.scale,
              coverage: this.shell.rim.coverage,
              supported:
                this.shell.candy.position[1] <= this.floorRadius() + 0.04,
            });
      this.shell.rim.amount = this.withdrawing
        ? 0
        : this.manual
          ? // Match the collar to the reduced hand travel (0.53 -> 0.35).
            Math.min(1, this.pressure / 100) * (0.35 / 0.53)
          : this.flow.frame().wrap;
      this.shell.permeability = f.permeability;
      this.shell.rim.release = f.permeability;
      // Keep a gummy compressed while the interface is loaded, then let its
      // own spring recover as that contact releases. Hard candy stays rigid.
      const loaded =
        this.contactMemory > 0 || this.shell.stats().localIndent > 0.012;
      this.candy.contactCompression =
        this.candy.kind === 'gummy' && loaded && !this.withdrawing
          ? Math.min(0.2, this.manual ? this.pressure * 0.002 : 0.14) *
            (1 - f.permeability)
          : 0;
      this.shell.candy.target.set(
        now.point
          .clone()
          .addScaledVector(now.normal, f.offset * this.scale)
          .toArray(),
      );
      this.previous = now;
    }
    if (this.contactStep > 0)
      this.shell.beginStep(this.contactStep, this.solver);
  }
  project(_dt: number, iteration: number) {
    if (this.pending && this.contactStep > 0) {
      this.shell.project(this.contactStep, this.solver, iteration);
      this.shell.candy.position[1] = Math.max(
        this.floorRadius(),
        this.shell.candy.position[1],
      );
    }
  }
  private floorRadius() {
    if (!this.candy) return 0;
    let support = this.candy.radius;
    if (!roundCandy(this.candy.kind)) {
      candyCompressionMatrix(
        this.floorTransform,
        this.candy.kind === 'gummy' ? this.candy.compression : 0,
        this.candy.compressionAxis,
      );
      this.floorRotation.makeRotationFromQuaternion(
        this.floorQuaternion.fromArray(this.shell.candy.rotation),
      );
      const e = this.floorTransform.multiply(this.floorRotation).elements;
      const round = this.shell.candy.radius,
        h = this.candy.radius - round;
      support =
        h * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9])) +
        round * Math.hypot(e[1], e[5], e[9]);
    }
    return support * (1 - this.flow.frame().dissolve);
  }
  endStep(_dt: number) {
    if (!this.pending) return;
    if (this.contactStep > 0) this.shell.endStep(this.contactStep, this.solver);
    if (this.candy) {
      [this.candy.x, this.candy.y, this.candy.z] = this.shell.candy.position;
      const e = new THREE.Euler().setFromQuaternion(
        new THREE.Quaternion().fromArray(this.shell.candy.rotation),
      );
      this.candy.rx = e.x;
      this.candy.ry = e.y;
      this.candy.rz = e.z;
      this.candy.melt = this.flow.frame().dissolve;
      if (
        this.withdrawing &&
        this.previous &&
        this.shell.stats().maxIndent < 0.009 &&
        new THREE.Vector3(this.candy.x, this.candy.y, this.candy.z)
          .sub(this.previous.point)
          .dot(this.previous.normal) >
          this.candy.radius + 0.06
      ) {
        this.candy.contactHeld = false;
        this.candy.captureCooldown = 0.65;
        this.reset();
      }
    }
    if (!this.active && this.shell.stats().maxIndent < 0.000001)
      this.pending = false;
  }
  applySurface() {
    if (!this.pending) return;
    const p = this.body.geometry.attributes.position;
    // Capture the body's transported base normal before applying the fine dent.
    // Feeding its already dented normal back into the next solve twists the DOF.
    this.frameNormals.set(this.body.geometry.attributes.normal.array);
    this.shell.apply(p.array as Float32Array);
    if (
      this.shell.stats().maxIndent > 1e-6 ||
      this.shell.rim.maxOffset > 1e-6
    ) {
      p.needsUpdate = true;
      updateDeformedSurface(this.body.geometry);
    }
  }
  /** Cheap state for the fixed-step performance clock; no fine mesh scans. */
  reactionFrame() {
    return {
      ...this.flow.frame(),
      ...(this.manual
        ? {
            stage:
              this.pressure > 35
                ? ('entering' as const)
                : ('pressing' as const),
            dissolve: 0,
          }
        : {}),
      held: this.manual,
      withdrawing: this.withdrawing,
      pressure: this.pressure,
      id: this.candy?.id ?? null,
    };
  }
  frame() {
    return {
      ...this.reactionFrame(),
      indent: this.shell.stats().maxIndent,
      coverage: this.shell.rim.coverage,
    };
  }
  reset() {
    if (
      this.candy &&
      (this.candy.mode === 'merging' || this.candy.contactHeld)
    ) {
      if (this.previous) {
        const p = this.previous.point
          .clone()
          .addScaledVector(this.previous.normal, this.candy.radius + 0.04);
        this.candy.x = p.x;
        this.candy.y = Math.max(this.candy.radius, p.y);
        this.candy.z = p.z;
      }
      this.candy.mode = 'free';
      this.candy.melt = 0;
      this.candy.contactHeld = false;
    }
    this.candy = null;
    this.anchor = null;
    this.previous = null;
    this.flow.reset();
    this.shell.permeability = 1;
    this.shell.resetDeformation();
    this.pending = false;
    this.contactMemory = 0;
    this.manual = false;
    this.withdrawing = false;
    this.pressure = 0;
    this.contactClock = this.contactStep = 0;
    this.solver.wake();
  }
}
