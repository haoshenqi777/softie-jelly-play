import type { PostureSample } from './posture.ts';
import type { VolumeSoftBody } from './solver.ts';

/** Small active strains, applied as forces before XPBD. The belly leads and the
 * crown follows with its own response time; changing a beat never resets a pose. */
export class BodyGesture {
  private readonly crown: Float64Array;
  private readonly forces: Float64Array;
  private readonly value = [0, 0, 0];
  private readonly speed = [0, 0, 0];
  private readonly solver: VolumeSoftBody;
  constructor(solver: VolumeSoftBody) {
    this.solver = solver;
    this.forces = new Float64Array(solver.x.length);
    this.crown = new Float64Array(solver.nodeCount);
    let low = Infinity,
      high = -Infinity;
    for (let i = 1; i < solver.rest.length; i += 3) {
      low = Math.min(low, solver.rest[i]);
      high = Math.max(high, solver.rest[i]);
    }
    for (let i = 0; i < solver.nodeCount; i++) {
      const h = Math.max(
        0,
        Math.min(
          1,
          ((solver.rest[i * 3 + 1] - low) / (high - low) - 0.5) / 0.45,
        ),
      );
      this.crown[i] = h * h * (3 - 2 * h);
    }
  }
  reset() {
    this.value.fill(0);
    this.speed.fill(0);
  }
  drive(
    pose: PostureSample,
    axis: ArrayLike<number>,
    stretch: number,
    bend: number,
    reach: number,
    dt: number,
  ) {
    if (![stretch, bend, reach, dt].every(Number.isFinite) || dt <= 0) return;
    dt = Math.min(dt, 1 / 120);
    const target = [stretch, bend, reach];
    for (let k = 0; k < 3; k++) {
      const frequency = k === 2 ? 7 : 12;
      this.speed[k] +=
        (frequency *
          frequency *
          (Math.max(-0.2, Math.min(0.2, target[k])) - this.value[k]) -
          1.7 * frequency * this.speed[k]) *
        dt;
      this.value[k] += this.speed[k] * dt;
    }
    const [s, b, r] = this.value,
      up = pose.up;
    const tx = axis[1] * up[2] - axis[2] * up[1],
      ty = axis[2] * up[0] - axis[0] * up[2],
      tz = axis[0] * up[1] - axis[1] * up[0];
    let fx = 0,
      fy = 0,
      fz = 0,
      total = 0;
    for (let i = 0; i < this.solver.nodeCount; i++) {
      const n = i * 3,
        m = this.solver.mass[i],
        w = this.crown[i];
      const x = this.solver.x[n] - pose.center[0],
        y = this.solver.x[n + 1] - pose.center[1],
        z = this.solver.x[n + 2] - pose.center[2];
      const h = x * up[0] + y * up[1] + z * up[2];
      const strain = 300 * (s * (1 - 0.7 * w) + r * w),
        curl = 220 * b * w;
      // Axial stretch has radial compensation. XPBD supplies the volume and
      // contact response; no material, rest mesh or render transform changes.
      this.forces[n] = strain * (1.5 * h * up[0] - 0.5 * x) + curl * tx;
      this.forces[n + 1] = strain * (1.5 * h * up[1] - 0.5 * y) + curl * ty;
      this.forces[n + 2] = strain * (1.5 * h * up[2] - 0.5 * z) + curl * tz;
      fx += this.forces[n] * m;
      fy += this.forces[n + 1] * m;
      fz += this.forces[n + 2] * m;
      total += m;
    }
    fx /= total;
    fy /= total;
    fz /= total;
    this.solver.wake();
    for (let i = 0; i < this.solver.nodeCount; i++) {
      const n = i * 3;
      this.solver.velocity[n] += (this.forces[n] - fx) * dt;
      this.solver.velocity[n + 1] += (this.forces[n + 1] - fy) * dt;
      this.solver.velocity[n + 2] += (this.forces[n + 2] - fz) * dt;
    }
  }
}
