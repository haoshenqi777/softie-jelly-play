import { inverseCandyCompression } from '../candy-deformation.ts';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
type Candy = {
  position: Float64Array;
  rotation: Float64Array;
  half: number;
  radius: number;
  compression?: number;
  compressionAxis?: ArrayLike<number>;
};

/** A cohesive collar with real three-axis offsets, tied to the existing skin.
 * This is a bounded elastic surface model, not a topology-changing liquid. */
export class ContactRim {
  readonly offset: Float64Array;
  private velocity: Float64Array;
  readonly weight: Float64Array;
  readonly movable: Uint8Array;
  readonly point = new Float64Array(3);
  readonly normal = new Float64Array([0, 0, 1]);
  amount = 0;
  release = 0;
  coverage = 0;
  maxOffset = 0;
  private nodes: number[] = [];
  private entryOffset: Float64Array;
  private previous: Float64Array;
  private opened = false;
  private p = new Float64Array(3);
  private compressed = new Float64Array(3);
  constructor(count: number) {
    this.offset = new Float64Array(count * 3);
    this.velocity = new Float64Array(count * 3);
    this.weight = new Float64Array(count);
    this.movable = new Uint8Array(count);
    this.entryOffset = new Float64Array(count * 3);
    this.previous = new Float64Array(count * 3);
  }
  bind(
    positions: ArrayLike<number>,
    point: ArrayLike<number>,
    normal: ArrayLike<number>,
    half: number,
  ) {
    this.reset();
    for (let i = 0; i < this.weight.length; i++) {
      const x = positions[i * 3] - point[0],
        y = positions[i * 3 + 1] - point[1],
        z = positions[i * 3 + 2] - point[2];
      const axial = x * normal[0] + y * normal[1] + z * normal[2];
      const r =
        Math.sqrt(Math.max(0, x * x + y * y + z * z - axial * axial)) / half;
      const w =
        smooth(0.42, 1.12, r) *
        (1 - smooth(1.45, 3.15, r)) *
        (1 - smooth(1.3, 3, Math.abs(axial) / half));
      if (w > 0.001 || (r < 1.12 && Math.abs(axial) < half * 3)) {
        this.weight[i] = w;
        this.movable[i] = 1;
        this.nodes.push(i);
      }
    }
  }
  step(
    dt: number,
    candy: Candy,
    sample: (i: number, out: Float64Array) => void,
  ) {
    this.previous.set(this.offset);
    if (this.amount === 0 && this.maxOffset === 0) {
      this.coverage = 0;
      return;
    }
    let coverage = 0,
      count = 0;
    this.maxOffset = 0;
    const n = this.normal,
      center = candy.position;
    const burial =
      (center[0] - this.point[0]) * n[0] +
      (center[1] - this.point[1]) * n[1] +
      (center[2] - this.point[2]) * n[2];
    if (this.release > 0 && !this.opened) {
      this.entryOffset.set(this.offset);
      this.opened = true;
    }
    const memory = this.opened ? 1 - smooth(0, candy.half * 1.25, -burial) : 0;
    // The collar becomes ordinary skin as the entire candy passes beneath it.
    const active =
      this.amount *
      (1 - smooth(candy.half * 0.4, candy.half * 1.45, -burial) * this.release);
    if (active < 1e-5) {
      for (const i of this.nodes)
        for (let a = 0; a < 3; a++) {
          const j = i * 3 + a;
          this.velocity[j] +=
            (-144 * this.offset[j] - 24 * this.velocity[j]) * dt;
          this.offset[j] += this.velocity[j] * dt;
          if (
            Math.abs(this.offset[j]) < 1e-8 &&
            Math.abs(this.velocity[j]) < 1e-7
          )
            this.offset[j] = this.velocity[j] = 0;
          this.maxOffset = Math.max(this.maxOffset, Math.abs(this.offset[j]));
        }
      this.coverage = 0;
      return;
    }
    const [qx, qy, qz, qw] = candy.rotation;
    const height = Math.max(
      -candy.half * 0.85,
      Math.min(
        candy.half * 0.9,
        candy.half * (-0.55 + 0.8 * this.amount),
        candy.half * 0.2 - burial,
      ),
    );
    inverseCandyCompression(
      n[0] * height,
      n[1] * height,
      n[2] * height,
      candy.compression ?? 0,
      candy.compressionAxis,
      this.compressed,
    );
    const [ox, oy, oz] = this.compressed;
    const ocx = 2 * (-qy * oz + qz * oy),
      ocy = 2 * (-qz * ox + qx * oz),
      ocz = 2 * (-qx * oy + qy * ox);
    const ax = ox + qw * ocx - qy * ocz + qz * ocy,
      ay = oy + qw * ocy - qz * ocx + qx * ocz,
      az = oz + qw * ocz - qx * ocy + qy * ocx;
    const h = candy.half - candy.radius,
      radiusSquared = candy.radius * candy.radius;
    for (const i of this.nodes) {
      sample(i, this.p);
      const dx = this.p[0] - this.point[0],
        dy = this.p[1] - this.point[1],
        dz = this.p[2] - this.point[2];
      const axial = dx * n[0] + dy * n[1] + dz * n[2];
      let tx = dx - n[0] * axial,
        ty = dy - n[1] * axial,
        tz = dz - n[2] * axial;
      const len = Math.hypot(tx, ty, tz) || 1;
      tx /= len;
      ty /= len;
      tz /= len;
      // Grow a low collar along the candy flank, not a cone reaching out
      // toward its exposed front face. The concave centre remains behind it.
      inverseCandyCompression(
        tx,
        ty,
        tz,
        candy.compression ?? 0,
        candy.compressionAxis,
        this.compressed,
      );
      const [ux, uy, uz] = this.compressed;
      // Inverse quaternion transforms the radial direction to the real candy.
      const cx = 2 * (-qy * uz + qz * uy),
        cy = 2 * (-qz * ux + qx * uz),
        cz = 2 * (-qx * uy + qy * ux);
      const lx = ux + qw * cx - qy * cz + qz * cy,
        ly = uy + qw * cy - qz * cx + qx * cz,
        lz = uz + qw * cz - qx * cy + qy * cx;
      let lo = 0,
        hi = candy.half * 1.8;
      for (let j = 0; j < 10; j++) {
        const m = (lo + hi) / 2,
          a = Math.abs(ax + lx * m) - h,
          b = Math.abs(ay + ly * m) - h,
          c = Math.abs(az + lz * m) - h;
        // Only the sign is needed in this bracket search. Interior core points
        // are always inside; outside it compare squared distance to the radius.
        const px = Math.max(a, 0),
          py = Math.max(b, 0),
          pz = Math.max(c, 0);
        if (px * px + py * py + pz * pz > radiusSquared) hi = m;
        else lo = m;
      }
      // The innermost fully wet ring reaches the flank. Outer material keeps
      // its radial order instead of every latitude collapsing onto that ring.
      const radius =
        (lo + hi) / 2 + 0.004 + Math.max(0, len - candy.half * 1.12) * 0.75;
      const w = this.weight[i];
      let targetX =
        (center[0] + n[0] * height + tx * radius - this.p[0]) * w * active;
      let targetY =
        (center[1] + n[1] * height + ty * radius - this.p[1]) * w * active;
      let targetZ =
        (center[2] + n[2] * height + tz * radius - this.p[2]) * w * active;
      // Retain the actually formed cavity while the candy crosses the skin.
      // Heal it with burial, so opening contact cannot erase resistance in a
      // single frame. This rest displacement is transported with the body.
      if (memory > 0) {
        const cavity =
          Math.min(
            0,
            this.entryOffset[i * 3] * n[0] +
              this.entryOffset[i * 3 + 1] * n[1] +
              this.entryOffset[i * 3 + 2] * n[2],
          ) * memory;
        const correction = Math.min(
          0,
          cavity - (targetX * n[0] + targetY * n[1] + targetZ * n[2]),
        );
        targetX += n[0] * correction;
        targetY += n[1] * correction;
        targetZ += n[2] * correction;
      }
      let error = 0,
        distance = 0;
      for (let a = 0; a < 3; a++) {
        const j = i * 3 + a,
          target = a === 0 ? targetX : a === 1 ? targetY : targetZ;
        this.velocity[j] +=
          ((target - this.offset[j]) * 144 - this.velocity[j] * 24) * dt;
        this.offset[j] += this.velocity[j] * dt;
        error += (this.offset[j] - target) ** 2;
        distance += target * target;
      }
      this.maxOffset = Math.max(
        this.maxOffset,
        Math.hypot(
          this.offset[i * 3],
          this.offset[i * 3 + 1],
          this.offset[i * 3 + 2],
        ),
      );
      if (w > 0.85 && distance > 0.0001) {
        coverage += this.amount * clamp(1 - Math.sqrt(error / distance));
        count++;
      }
    }
    this.coverage = count ? coverage / count : 0;
  }
  apply(positions: Float32Array) {
    for (const i of this.nodes)
      for (let a = 0; a < 3; a++)
        positions[i * 3 + a] += this.offset[i * 3 + a];
  }
  finishStep(dt: number) {
    if (this.release <= 0) return;
    // Opening the hard constraint must not release all stored strain in one
    // frame. Bound viscous recovery in physical units/second, using one shared
    // scale for the patch so neighbouring vertices preserve their continuity.
    let largest = 0;
    for (const i of this.nodes)
      largest = Math.max(
        largest,
        Math.hypot(
          this.offset[i * 3] - this.previous[i * 3],
          this.offset[i * 3 + 1] - this.previous[i * 3 + 1],
          this.offset[i * 3 + 2] - this.previous[i * 3 + 2],
        ),
      );
    const scale = largest > 0 ? Math.min(1, (0.9 * dt) / largest) : 1;
    for (const i of this.nodes)
      for (let a = 0; a < 3; a++) {
        const j = i * 3 + a,
          d = (this.offset[j] - this.previous[j]) * scale;
        this.offset[j] = this.previous[j] + d;
        this.velocity[j] = d / dt;
      }
  }
  reset() {
    this.offset.fill(0);
    this.velocity.fill(0);
    this.weight.fill(0);
    this.movable.fill(0);
    this.entryOffset.fill(0);
    this.previous.fill(0);
    this.opened = false;
    this.nodes = [];
    this.amount = this.release = this.coverage = this.maxOffset = 0;
  }
  transport(q: ArrayLike<number>) {
    const x = q[0],
      y = q[1],
      z = q[2],
      w = q[3];
    for (const values of [this.offset, this.velocity, this.entryOffset])
      for (const i of this.nodes) {
        const j = i * 3,
          a = values[j],
          b = values[j + 1],
          c = values[j + 2];
        const u = 2 * (y * c - z * b),
          v = 2 * (z * a - x * c),
          s = 2 * (x * b - y * a);
        values[j] = a + w * u + y * s - z * v;
        values[j + 1] = b + w * v + z * u - x * s;
        values[j + 2] = c + w * s + x * v - y * u;
      }
  }
}
