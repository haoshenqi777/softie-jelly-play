import { SlimeTissue } from './slime-tissue.ts';
import { inflatePoint } from './slime-shape.ts';
type Point = { x: number; y: number; z: number };
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const zero = (): Point => ({ x: 0, y: 0, z: 0 });

// A small elastic continuum: volume-preserving body modes plus a spring-driven
// local displacement field. All visible parts use the same material coordinates.
export class SlimeDynamics {
  wrap = {
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
    amount: 0,
  };
  readonly tissue = new SlimeTissue();
  private tissuePoint = { radial: 0, axial: 0 };
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  squash = 0;
  squashVelocity = 0;
  oval = 0;
  ovalVelocity = 0;
  shear = 0;
  shearVelocity = 0;
  shearZ = 0;
  shearZVelocity = 0;
  stiffness = 35;
  damping = 45;
  held = false;
  targetX = 0;
  targetY = 0;
  targetZ = 0;
  time = 0;
  excitement = 0;
  drive: number | null = null;
  driveZ: number | null = null;
  puff = 0;
  fullness = 0;
  sleep = 0;
  impactSerial = 0;
  lastImpact = 0;
  reachX = 0;
  reachY = 0;
  cheekL = 0;
  cheekR = 0;
  private reachVX = 0;
  private reachVY = 0;
  pose = {
    lean: 0,
    squash: 0,
    oval: 0,
    reachX: 0,
    reachY: 0,
    cheekL: 0,
    cheekR: 0,
    puff: 0,
    fullness: 0,
    sleep: 0,
    swallow: 0,
  };
  anchor: Point = { x: 0, y: 1.3, z: 1 };
  patch = zero();
  patchVelocity = zero();
  normal: Point = { x: 0, y: 0, z: 1 };
  private accumulator = 0;
  private secondAnchor: Point = { x: 1, y: 1.2, z: 0.6 };
  private secondNormal: Point = { x: 1, y: 0, z: 0 };
  private secondPatch = zero();
  private secondV = zero();
  private pinching = false;
  private pinchAmount = 0;
  private recoils: { anchor: Point; offset: Point; velocity: Point }[] = [];
  get press() {
    return -this.patch.z;
  }
  hopTo(x: number, height = 0.17, z = this.z) {
    if (this.held || this.y > 0.02) return;
    const vy = Math.sqrt(2 * 6.8 * clamp(height, 0.1, 0.45));
    this.vy = vy;
    const flight = (2 * vy) / 6.8;
    this.vx = clamp((clamp(x, -2.3, 2.3) - this.x) / flight, -1.55, 1.55);
    this.vz = clamp((clamp(z, -2.2, 1.9) - this.z) / flight, -1.55, 1.55);
    this.squashVelocity += 1.0;
  }
  poke() {
    this.tissue.impulse(1.1, 0.8);
    this.squashVelocity -= 3.3;
    this.vy = Math.min(this.vy + 1.05, 3);
    this.ovalVelocity += 0.65;
    this.shearVelocity += 0.42;
    this.excitement = 1;
  }
  grab(x: number, y: number, point: Point, normal?: Point) {
    if (
      Math.hypot(
        this.patch.x,
        this.patch.y,
        this.patch.z,
        this.patchVelocity.x,
        this.patchVelocity.y,
        this.patchVelocity.z,
      ) > 0.0001
    ) {
      this.recoils.push({
        anchor: { ...this.anchor },
        offset: { ...this.patch },
        velocity: { ...this.patchVelocity },
      });
    }
    this.patch = zero();
    this.patchVelocity = zero();
    this.tissue.impulse(point.y, 0.28);
    this.held = true;
    this.targetX = x;
    this.targetY = y;
    this.targetZ = this.z;
    this.anchor = { ...point };
    const n = normal || {
      x: point.x * 0.6,
      y: (point.y - 1.2) * 0.6,
      z: point.z,
    };
    const length = Math.hypot(n.x, n.y, n.z) || 1;
    this.normal = { x: n.x / length, y: n.y / length, z: n.z / length };
  }
  dragTo(x: number, y: number, z = this.z) {
    this.targetX = clamp(x, -2.4, 2.4);
    this.targetY = clamp(y, -0.3, 2);
    this.targetZ = clamp(z, -2.2, 1.9);
  }
  release() {
    if (this.held) this.tissue.impulse(this.anchor.y, -0.3);
    // Never clear patch displacement/velocity: the local spring carries recoil.
    this.held = false;
    this.vx = clamp(this.vx, -3.5, 3.5);
    this.vy = clamp(this.vy, -4.5, 4.5);
    this.vz = clamp(this.vz, -3.5, 3.5);
    this.releaseSecond();
  }
  grabSecond(point: Point) {
    this.secondAnchor = { ...point };
    const length = Math.hypot(point.x, point.y - 1.2, point.z) || 1;
    this.secondNormal = {
      x: point.x / length,
      y: (point.y - 1.2) / length,
      z: point.z / length,
    };
    this.pinching = true;
    this.pinchAmount = 0.15;
  }
  pinchTo(amount: number) {
    this.pinchAmount = clamp(amount, 0, 1);
  }
  releaseSecond() {
    this.pinching = false;
    this.pinchAmount = 0;
  }
  nudge(point: Point, strength: number) {
    const offset = {
      x: point.x * 0.009 * strength,
      y: 0,
      z: -Math.min(0.07, strength * 0.018),
    };
    this.recoils.push({ anchor: { ...point }, offset, velocity: zero() });
    if (this.recoils.length > 12) this.recoils.shift();
  }
  reset() {
    this.tissue.reset();
    this.wrap.amount = 0;
    this.secondPatch = zero();
    this.secondV = zero();
    this.releaseSecond();
    this.z =
      this.vz =
      this.targetZ =
      this.puff =
      this.fullness =
      this.sleep =
      this.lastImpact =
        0;
    this.driveZ = null;
    this.x =
      this.y =
      this.vx =
      this.vy =
      this.squash =
      this.squashVelocity =
      this.oval =
      this.ovalVelocity =
      this.shear =
      this.shearVelocity =
      this.shearZ =
      this.shearZVelocity =
      this.excitement =
        0;
    this.patch = zero();
    this.patchVelocity = zero();
    this.recoils = [];
    this.drive = null;
    this.reachX =
      this.reachY =
      this.reachVX =
      this.reachVY =
      this.cheekL =
      this.cheekR =
        0;
    this.pose = {
      lean: 0,
      squash: 0,
      oval: 0,
      reachX: 0,
      reachY: 0,
      cheekL: 0,
      cheekR: 0,
      puff: 0,
      fullness: 0,
      sleep: 0,
      swallow: 0,
    };
    this.held = false;
    this.stiffness = 35;
    this.damping = 45;
    this.accumulator = 0;
  }
  advance(dt: number) {
    this.accumulator += clamp(dt, 0, 0.1);
    while (this.accumulator >= 1 / 120) {
      this.integrate(1 / 120);
      this.accumulator -= 1 / 120;
    }
  }
  private integrate(dt: number) {
    const omega = 10 + this.stiffness * 0.14 + this.puff * 4;
    const zeta = 0.12 + this.damping * 0.008;
    const spring = (q: number, v: number, target: number, w = omega) =>
      (w * w * (target - q) - 2 * zeta * w * v) * dt;
    const dx = this.targetX - this.x,
      dy = this.targetY - this.y;
    const ax = this.held
      ? dx * 42 - this.vx * 8
      : this.drive !== null && this.y < 0.02
        ? clamp((this.drive - this.vx) * 7, -3.5, 3.5)
        : -this.vx * (this.y < 0.02 ? 5 : 0.35);
    const ay = this.held ? dy * 48 - this.vy * 8 - 1.5 : -6.8;
    const az = this.held
      ? (this.targetZ - this.z) * 42 - this.vz * 8
      : this.driveZ !== null && this.y < 0.02
        ? clamp((this.driveZ - this.vz) * 7, -3.5, 3.5)
        : -this.vz * (this.y < 0.02 ? 5 : 0.35);
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.vz += az * dt;
    this.z = clamp(this.z + this.vz * dt, -2.2, 1.9);
    this.x = clamp(this.x + this.vx * dt, -2.4, 2.4);
    this.y += this.vy * dt;
    if (this.y < 0) {
      const impact = Math.max(0, -this.vy);
      this.y = 0;
      this.vy = impact > 0.35 ? impact * (0.22 - this.damping * 0.0012) : 0;
      if (impact > 0.35) {
        this.tissue.impulse(0.24, Math.min(2.5, impact * 0.45));
        this.lastImpact = impact;
        this.impactSerial++;
        this.squashVelocity -= impact * 0.95;
        this.ovalVelocity += impact * 0.14;
        this.excitement = Math.min(1, impact * 0.25);
      }
    }
    this.squashVelocity += spring(
      this.squash,
      this.squashVelocity,
      (this.held ? clamp(dy * 0.18, -0.16, 0.24) : 0) + this.pose.squash,
    );
    this.squash += this.squashVelocity * dt;
    if (Math.abs(this.squash) > 0.4) {
      this.squash = clamp(this.squash, -0.4, 0.4);
      this.squashVelocity *= 0.3;
    }
    this.ovalVelocity += spring(
      this.oval,
      this.ovalVelocity,
      (this.held ? clamp(Math.abs(dx) * 0.035, 0, 0.08) : 0) + this.pose.oval,
      omega * 0.8,
    );
    this.oval = clamp(this.oval + this.ovalVelocity * dt, -0.16, 0.16);
    this.shearVelocity += spring(
      this.shear,
      this.shearVelocity,
      clamp(-ax * 0.008, -0.23, 0.23) + this.pose.lean,
      omega * 0.85,
    );
    this.shear = clamp(this.shear + this.shearVelocity * dt, -0.4, 0.4);
    this.shearZVelocity += spring(
      this.shearZ,
      this.shearZVelocity,
      clamp(-az * 0.008, -0.16, 0.16) +
        (this.held ? -this.normal.z * 0.035 : 0),
      omega * 0.9,
    );
    this.shearZ = clamp(this.shearZ + this.shearZVelocity * dt, -0.2, 0.2);
    this.reachVX += spring(
      this.reachX,
      this.reachVX,
      this.pose.reachX,
      omega * 0.65,
    );
    this.reachVY += spring(
      this.reachY,
      this.reachVY,
      this.pose.reachY,
      omega * 0.65,
    );
    this.reachX = clamp(this.reachX + this.reachVX * dt, -0.85, 0.85);
    this.reachY = clamp(this.reachY + this.reachVY * dt, -0.5, 1.05);
    this.cheekL += (this.pose.cheekL - this.cheekL) * (1 - Math.exp(-dt * 14));
    this.cheekR += (this.pose.cheekR - this.cheekR) * (1 - Math.exp(-dt * 14));
    this.puff += (this.pose.puff - this.puff) * (1 - Math.exp(-dt * 5));
    this.fullness +=
      (this.pose.fullness - this.fullness) * (1 - Math.exp(-dt * 1.5));
    this.sleep += (this.pose.sleep - this.sleep) * (1 - Math.exp(-dt * 3));
    const depth =
      ((0.37 - this.stiffness * 0.0018) * (1 + this.pinchAmount * 0.9)) /
      (1 + this.puff * 0.65);
    const wanted = this.held
      ? {
          x: dx * 0.78 - this.normal.x * depth,
          y: dy * 0.78 - this.normal.y * depth,
          z: (this.targetZ - this.z) * 0.78 - this.normal.z * depth,
        }
      : zero();
    for (const key of ['x', 'y', 'z'] as const) {
      const secondTarget = this.pinching ? -this.secondNormal[key] * depth : 0;
      this.secondV[key] += spring(
        this.secondPatch[key],
        this.secondV[key],
        secondTarget,
        omega * 1.45,
      );
      this.secondPatch[key] += this.secondV[key] * dt;
      this.patchVelocity[key] += spring(
        this.patch[key],
        this.patchVelocity[key],
        wanted[key],
        omega * 1.45,
      );
      this.patch[key] += this.patchVelocity[key] * dt;
      if (Math.abs(this.patch[key]) > 0.8) {
        this.patch[key] = clamp(this.patch[key], -0.8, 0.8);
        this.patchVelocity[key] *= 0.3;
      }
    }
    this.recoils = this.recoils.filter((recoil) => {
      for (const key of ['x', 'y', 'z'] as const) {
        recoil.velocity[key] += spring(
          recoil.offset[key],
          recoil.velocity[key],
          0,
          omega * 1.45,
        );
        recoil.offset[key] += recoil.velocity[key] * dt;
      }
      return (
        Math.hypot(recoil.offset.x, recoil.offset.y, recoil.offset.z) >
          0.00005 ||
        Math.hypot(recoil.velocity.x, recoil.velocity.y, recoil.velocity.z) >
          0.001
      );
    });
    this.excitement *= Math.exp(-dt * 3);
    this.tissue.advance(dt, this.stiffness, this.damping);
    this.time += dt;
  }
  deform(x: number, y: number, z: number, out: Point = zero()): Point {
    const sleepSquash =
      -this.sleep * (0.34 + 0.008 * Math.sin(this.time * 1.7));
    const sx = Math.exp(-(this.squash + sleepSquash) / 2 + this.oval),
      sy = Math.exp(this.squash + sleepSquash),
      sz = Math.exp(-(this.squash + sleepSquash) / 2 - this.oval);
    if (this.puff > 0.00001) inflatePoint(x, y, z, this.puff, out);
    else {
      out.x = x;
      out.y = y;
      out.z = z;
    }
    const top = (y * y) / 2.7;
    out.x = out.x * sx + this.shear * top;
    out.y *= sy;
    out.z = out.z * sz + this.shearZ * top;
    const base = 1 - Math.exp(-Math.max(0, y) * 4);
    const belly = Math.exp(-(((y - 0.55) / 0.7) ** 2)) * this.fullness;
    out.x *= 1 + belly * 0.11 * (1 - this.puff * 0.8);
    out.z *= 1 + belly * 0.085 * (1 - this.puff * 0.8);
    out.y -= this.fullness * 0.035 * base * (1 - this.puff);
    // Front flesh reaches while the underside remains attached to the table.
    const front = clamp((z + 0.25) / 1.4, 0, 1);
    const reach =
      Math.exp(-(((y - 1.12) / 0.96) ** 2)) *
      (1 - Math.exp(-Math.max(0, y - 0.04) * 7)) *
      front;
    out.x += this.reachX * reach;
    out.y += this.reachY * reach;
    for (const side of [-1, 1]) {
      const cheek = side < 0 ? this.cheekL : this.cheekR;
      const bulge =
        Math.exp(-(((x - side * 0.57) / 0.42) ** 2) - ((y - 0.99) / 0.4) ** 2) *
        front *
        cheek;
      out.x += side * bulge * 0.075;
      out.z += bulge * 0.095;
    }
    const swallowY = 1.05 - this.pose.swallow * 0.55;
    const swallowWave =
      Math.sin(this.pose.swallow * Math.PI) *
      Math.exp(-((x / 0.48) ** 2) - ((y - swallowY) / 0.16) ** 2) *
      front;
    out.z += swallowWave * 0.035;
    for (let i = -2; i < this.recoils.length; i++) {
      const anchor =
          i === -2
            ? this.secondAnchor
            : i < 0
              ? this.anchor
              : this.recoils[i].anchor,
        offset =
          i === -2
            ? this.secondPatch
            : i < 0
              ? this.patch
              : this.recoils[i].offset;
      if (
        Math.abs(offset.x) + Math.abs(offset.y) + Math.abs(offset.z) <
        0.00001
      )
        continue;
      const rx = x - anchor.x,
        ry = y - anchor.y,
        rz = z - anchor.z,
        e = 0.48,
        r2 = rx * rx + ry * ry + rz * rz;
      // Regularized elastic point displacement, with radial compensation.
      const weight = e / (2 * Math.pow(r2 + e * e, 1.5)),
        along = rx * offset.x + ry * offset.y + rz * offset.z,
        scale = r2 + 2 * e * e;
      out.x += weight * (scale * offset.x + along * rx);
      out.y += weight * (scale * offset.y + along * ry);
      out.z += weight * (scale * offset.z + along * rz);
    }
    if (this.wrap.amount > 0.00001) {
      const w = this.wrap,
        dx = x - w.point.x,
        dy = y - w.point.y,
        dz = z - w.point.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const cup = Math.exp(-d2 / 0.055),
        lip = Math.exp(-d2 / 0.17) * 0.32;
      const displacement = (lip - cup) * w.amount;
      out.x += w.normal.x * displacement;
      out.y += w.normal.y * displacement;
      out.z += w.normal.z * displacement;
    }
    const tissue = this.tissue.sample(y, this.tissuePoint);
    out.x *= 1 + tissue.radial;
    out.z *= 1 + tissue.radial;
    out.y += tissue.axial;
    out.y = Math.max(-this.y, out.y);
    return out;
  }
}
