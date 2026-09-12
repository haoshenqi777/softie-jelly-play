import { heightAt, radiusAt } from './slime-shape.ts';
import type { SlimeDynamics } from './slime-physics';
import type { Point3 } from './candy-physics';

const rings = Array.from({ length: 49 }, (_, i) => {
  const t = -Math.cos((i / 48) * Math.PI);
  return { y: heightAt(t), r: radiusAt(t) };
});
// The contact meridian uses exactly the same profile and displacement field
// as the visible skin. Sampling follows the candy's azimuth, including puff,
// sleepy flattening and the locally indented skin.
export class SlimeContactSurface {
  private physics: SlimeDynamics;
  private samples = rings.map(() => ({ x: 0, y: 0, z: 0 }));
  constructor(physics: SlimeDynamics) {
    this.physics = physics;
  }
  contact = (p: Point3, radius: number) => {
    const s = this.physics;
    const q = { x: p.x - s.x, y: p.y - s.y, z: p.z - s.z };
    const axisX = 1.64 + (1.7 - 1.64) * s.puff,
      axisZ = 1.18 + (1.7 - 1.18) * s.puff;
    const angle = Math.atan2(q.z / axisZ, q.x / axisX),
      ca = Math.cos(angle),
      sa = Math.sin(angle);
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      s.deform(1.64 * r.r * ca, r.y, 1.18 * r.r * sa, this.samples[i]);
    }
    let best = Infinity,
      index = 0,
      fraction = 0;
    for (let i = 0; i < rings.length - 1; i++) {
      const a = this.samples[i],
        b = this.samples[i + 1];
      const dx = b.x - a.x,
        dy = b.y - a.y,
        dz = b.z - a.z;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((q.x - a.x) * dx + (q.y - a.y) * dy + (q.z - a.z) * dz) /
            (dx * dx + dy * dy + dz * dz || 1),
        ),
      );
      const d =
        (q.x - a.x - dx * t) ** 2 +
        (q.y - a.y - dy * t) ** 2 +
        (q.z - a.z - dz * t) ** 2;
      if (d < best) {
        best = d;
        index = i;
        fraction = t;
      }
    }
    const a = this.samples[index],
      b = this.samples[index + 1];
    const dy = b.y - a.y,
      dx = b.x - a.x,
      dz = b.z - a.z;
    // The azimuth tangent changes as the flattened body inflates into a sphere.
    const rr = Math.max(
      0.001,
      rings[index].r + (rings[index + 1].r - rings[index].r) * fraction,
    );
    const yy =
      rings[index].y + (rings[index + 1].y - rings[index].y) * fraction;
    const left = s.deform(
      1.64 * rr * Math.cos(angle - 0.01),
      yy,
      1.18 * rr * Math.sin(angle - 0.01),
    );
    const right = s.deform(
      1.64 * rr * Math.cos(angle + 0.01),
      yy,
      1.18 * rr * Math.sin(angle + 0.01),
    );
    const tx = right.x - left.x,
      ty = right.y - left.y,
      tz = right.z - left.z;
    let nx = dy * tz - dz * ty,
      ny = dz * tx - dx * tz,
      nz = dx * ty - dy * tx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const x = a.x + dx * fraction,
      y = a.y + dy * fraction,
      z = a.z + dz * fraction;
    const signed = (q.x - x) * nx + (q.y - y) * ny + (q.z - z) * nz;
    if (signed >= radius) return null;
    return {
      position: {
        x: s.x + x + nx * radius,
        y: s.y + y + ny * radius,
        z: s.z + z + nz * radius,
      },
      normal: { x: nx, y: ny, z: nz },
    };
  };
}
