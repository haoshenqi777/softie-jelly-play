import { determinant, inverse } from './math.ts';

export type PostureSample = {
  up: number[];
  forward: number[];
  center: number[];
  omega: number[];
  minY: number;
  verticalSpeed: number;
};

/** Mass-weighted affine fit followed by polar decomposition, independent of
 * camera rotation and resistant to a locally bending crown. Buffers are reused. */
export class BodyPosture {
  private readonly mass: Float64Array;
  private readonly centered: Float64Array;
  private readonly total: number;
  private readonly restInverse = new Float64Array(9);
  private readonly covariance = new Float64Array(9);
  private readonly rotation = new Float64Array(9);
  private readonly scratch = new Float64Array(9);
  private readonly inertia = new Float64Array(9);
  private readonly sampleValue: PostureSample = {
    up: [0, 1, 0],
    forward: [0, 0, 1],
    center: [0, 0, 0],
    omega: [0, 0, 0],
    minY: 0,
    verticalSpeed: 0,
  };

  constructor(rest: Float64Array, mass: Float64Array) {
    this.mass = mass;
    this.centered = rest.slice();
    this.total = mass.reduce((a, b) => a + b, 0);
    const center = [0, 0, 0];
    for (let i = 0; i < mass.length; i++)
      for (let k = 0; k < 3; k++)
        center[k] += (rest[i * 3 + k] * mass[i]) / this.total;
    for (let i = 0; i < mass.length; i++)
      for (let k = 0; k < 3; k++) this.centered[i * 3 + k] -= center[k];
    for (let i = 0; i < mass.length; i++)
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
          this.covariance[r * 3 + c] +=
            mass[i] * this.centered[i * 3 + r] * this.centered[i * 3 + c];
    inverse(this.covariance, this.restInverse);
  }

  sample(x: Float64Array, velocity: Float64Array): PostureSample {
    const result = this.sampleValue,
      center = result.center;
    center.fill(0);
    result.minY = Infinity;
    result.verticalSpeed = 0;
    for (let i = 0; i < this.mass.length; i++) {
      const w = this.mass[i] / this.total;
      for (let k = 0; k < 3; k++) center[k] += x[i * 3 + k] * w;
      result.minY = Math.min(result.minY, x[i * 3 + 1]);
      result.verticalSpeed += velocity[i * 3 + 1] * w;
    }
    const a = this.covariance,
      inertia = this.inertia;
    a.fill(0);
    inertia.fill(0);
    let lx = 0,
      ly = 0,
      lz = 0;
    for (let i = 0; i < this.mass.length; i++) {
      const n = i * 3,
        m = this.mass[i];
      const rx = x[n] - center[0],
        ry = x[n + 1] - center[1],
        rz = x[n + 2] - center[2];
      for (let c = 0; c < 3; c++) {
        const v = m * this.centered[n + c];
        a[c] += rx * v;
        a[3 + c] += ry * v;
        a[6 + c] += rz * v;
      }
      inertia[0] += m * (ry * ry + rz * rz);
      inertia[4] += m * (rx * rx + rz * rz);
      inertia[8] += m * (rx * rx + ry * ry);
      inertia[1] -= m * rx * ry;
      inertia[2] -= m * rx * rz;
      inertia[5] -= m * ry * rz;
      lx += m * (ry * velocity[n + 2] - rz * velocity[n + 1]);
      ly += m * (rz * velocity[n] - rx * velocity[n + 2]);
      lz += m * (rx * velocity[n + 1] - ry * velocity[n]);
    }
    inertia[3] = inertia[1];
    inertia[6] = inertia[2];
    inertia[7] = inertia[5];
    if (Math.abs(determinant(inertia)) > 1e-10) {
      inverse(inertia, this.scratch);
      for (let k = 0; k < 3; k++)
        result.omega[k] =
          this.scratch[k * 3] * lx +
          this.scratch[k * 3 + 1] * ly +
          this.scratch[k * 3 + 2] * lz;
    } else result.omega.fill(0);
    const r = this.rotation;
    for (let row = 0; row < 3; row++)
      for (let c = 0; c < 3; c++)
        r[row * 3 + c] =
          a[row * 3] * this.restInverse[c] +
          a[row * 3 + 1] * this.restInverse[3 + c] +
          a[row * 3 + 2] * this.restInverse[6 + c];
    if (determinant(r) > 1e-8) {
      for (let iteration = 0; iteration < 7; iteration++) {
        inverse(r, this.scratch);
        let change = 0;
        for (let row = 0; row < 3; row++)
          for (let c = 0; c < 3; c++) {
            const index = row * 3 + c,
              next = 0.5 * (r[index] + this.scratch[c * 3 + row]);
            change = Math.max(change, Math.abs(next - r[index]));
            r[index] = next;
          }
        if (change < 1e-7) break;
      }
      for (let k = 0; k < 3; k++) {
        result.up[k] = r[k * 3 + 1];
        result.forward[k] = r[k * 3 + 2];
      }
    }
    return result;
  }
}
