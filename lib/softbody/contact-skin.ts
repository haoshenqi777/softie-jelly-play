/** Local surface strain and dihedral regularization. The coarse solid still
 * owns volume and motion; these constraints prevent fine contact DOFs from
 * stretching one triangle into a spike. Dihedral gradients follow Bridson,
 * as used by InteractiveComputerGraphics/PositionBasedDynamics (MIT).
 * See docs/superpowers/plans/2026-09-11-contact-surface-research.md. */
import { createContactKernel } from './contact-kernel.ts';
type Edge = {
  a: number;
  b: number;
  c: number;
  d: number;
  angle: number;
  length: number;
  cosine: number;
  ids: number[];
};
export class ContactSkin {
  private kernel: Awaited<ReturnType<typeof createContactKernel>> | null = null;
  async accelerate(bytes: BufferSource) {
    const kernel = await createContactKernel(
      bytes,
      this.rest.length / 3,
      this.index,
      this.edges.length,
    );
    kernel.bind(this.movable, this.ids, this.selected, this.triangles);
    kernel.prepare(this.base, this.degrees, this.triangleFrames, this.selected);
    this.kernel = kernel;
  }
  get backend() {
    return this.kernel ? 'wasm' : 'js';
  }
  regularizeContact(
    ...args: Parameters<NonNullable<ContactSkin['kernel']>['regularize']>
  ) {
    return this.kernel?.regularize(...args);
  }
  wetting(normal: Float64Array, bound: number) {
    return this.kernel?.wetting(normal, bound);
  }
  private edges: Edge[] = [];
  private selected: Edge[] = [];
  private ids: number[] = [];
  private movable: Uint8Array;
  private p: Float64Array;
  private base: Float64Array;
  private samplePoint = new Float64Array(3);
  private grads = new Float64Array(12);
  private triangles: number[] = [];
  private triangleFrames = new Float64Array(0);
  private sums: Float64Array;
  private degrees: Float64Array;
  constructor(
    private rest: Float32Array,
    private index: ArrayLike<number>,
  ) {
    this.p = new Float64Array(rest.length);
    this.base = new Float64Array(rest.length);
    this.movable = new Uint8Array(rest.length / 3);
    this.sums = new Float64Array(rest.length);
    this.degrees = new Float64Array(rest.length / 3);
    const map = new Map<string, Edge>();
    for (let t = 0; t < index.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = index[t + k],
          b = index[t + ((k + 1) % 3)],
          c = index[t + ((k + 2) % 3)],
          key = Math.min(a, b) + ':' + Math.max(a, b);
        const edge = map.get(key);
        if (edge) edge.d = c;
        else
          map.set(key, {
            a,
            b,
            c,
            d: -1,
            angle: 0,
            length: 0,
            cosine: 1,
            ids: [],
          });
      }
    this.p.set(rest);
    for (const e of map.values()) {
      if (e.d < 0) continue;
      e.angle = this.bend(e, false);
      e.cosine = Math.cos(e.angle + 0.19);
      e.ids = [e.c, e.d, e.a, e.b];
      if (Number.isFinite(e.angle)) this.edges.push(e);
    }
  }
  bind(mask: ArrayLike<number>) {
    this.movable.fill(0);
    this.ids = [];
    this.selected = [];
    const used = new Set<number>();
    for (let i = 0; i < mask.length; i++) this.movable[i] = mask[i] > 0 ? 1 : 0;
    for (const e of this.edges)
      if (
        this.movable[e.a] ||
        this.movable[e.b] ||
        this.movable[e.c] ||
        this.movable[e.d]
      ) {
        this.selected.push(e);
        used.add(e.a);
        used.add(e.b);
        used.add(e.c);
        used.add(e.d);
      }
    this.ids = [...used];
    this.triangles = [];
    for (let i = 0; i < this.index.length; i += 3)
      if (
        this.movable[this.index[i]] ||
        this.movable[this.index[i + 1]] ||
        this.movable[this.index[i + 2]]
      )
        this.triangles.push(i);
    this.triangleFrames = new Float64Array(this.triangles.length * 4);
    this.kernel?.bind(this.movable, this.ids, this.selected, this.triangles);
  }
  prepare(sample: (i: number, out: Float64Array) => void) {
    for (const i of this.ids) {
      sample(i, this.samplePoint);
      this.base.set(this.samplePoint, i * 3);
    }
    if (this.kernel) {
      this.kernel.prepareBase(this.base);
      return;
    }
    this.degrees.fill(0);
    for (const e of this.selected) {
      const a = e.a * 3,
        b = e.b * 3;
      e.length = Math.hypot(
        this.base[b] - this.base[a],
        this.base[b + 1] - this.base[a + 1],
        this.base[b + 2] - this.base[a + 2],
      );
      this.degrees[e.a] += e.length;
      this.degrees[e.b] += e.length;
    }
    for (let j = 0; j < this.triangles.length; j++) {
      const t = this.triangles[j],
        a = this.index[t] * 3,
        b = this.index[t + 1] * 3,
        c = this.index[t + 2] * 3,
        p = this.base;
      const ux = p[b] - p[a],
        uy = p[b + 1] - p[a + 1],
        uz = p[b + 2] - p[a + 2],
        vx = p[c] - p[a],
        vy = p[c + 1] - p[a + 1],
        vz = p[c + 2] - p[a + 2];
      const x = uy * vz - uz * vy,
        y = uz * vx - ux * vz,
        z = ux * vy - uy * vx,
        len = Math.hypot(x, y, z) || 1;
      this.triangleFrames[j * 4] = x / len;
      this.triangleFrames[j * 4 + 1] = y / len;
      this.triangleFrames[j * 4 + 2] = z / len;
      this.triangleFrames[j * 4 + 3] = len;
    }
    // End reference preparation; native path returns above.
  }
  solve(offset: Float64Array) {
    if (this.kernel) {
      this.kernel.solve(offset);
      return;
    }
    if (!this.ids.length) return;
    for (const i of this.ids)
      for (let a = 0; a < 3; a++)
        this.p[i * 3 + a] = this.base[i * 3 + a] + offset[i * 3 + a];
    this.fair();
    for (const e of this.selected) {
      const a = e.a * 3,
        b = e.b * 3,
        wa = this.movable[e.a],
        wb = this.movable[e.b];
      if (wa + wb === 0) continue;
      const dx = this.p[b] - this.p[a],
        dy = this.p[b + 1] - this.p[a + 1],
        dz = this.p[b + 2] - this.p[a + 2],
        len = Math.hypot(dx, dy, dz);
      const rest = e.length;
      const target = Math.max(rest * 0.7, Math.min(rest * 1.45, len));
      if (len > 1e-7 && len !== target) {
        const s = ((len - target) / len / (wa + wb)) * 0.85;
        for (let k = 0; k < 3; k++) {
          const d = (k === 0 ? dx : k === 1 ? dy : dz) * s;
          this.p[a + k] += d * wa;
          this.p[b + k] -= d * wb;
        }
      }
    }
    for (const e of this.selected) this.bend(e, true);
    this.preventInversion();
    for (const i of this.ids)
      if (this.movable[i])
        for (let a = 0; a < 3; a++)
          offset[i * 3 + a] = this.p[i * 3 + a] - this.base[i * 3 + a];
  }
  private fair() {
    this.sums.fill(0);
    for (const e of this.selected) {
      const a = e.a * 3,
        b = e.b * 3;
      const weight = e.length;
      for (let d = 0; d < 3; d++) {
        this.sums[a + d] += (this.p[b + d] - this.base[b + d]) * weight;
        this.sums[b + d] += (this.p[a + d] - this.base[a + d]) * weight;
      }
    }
    for (const i of this.ids)
      if (this.movable[i] && this.degrees[i] > 0)
        for (let d = 0; d < 3; d++) {
          const j = i * 3 + d;
          this.p[j] +=
            (this.base[j] + this.sums[j] / this.degrees[i] - this.p[j]) * 0.35;
        }
  }
  private preventInversion() {
    const p = this.p,
      g = this.grads;
    for (let j = 0; j < this.triangles.length; j++) {
      const t = this.triangles[j],
        a = this.index[t] * 3,
        b = this.index[t + 1] * 3,
        c = this.index[t + 2] * 3;
      const nx = this.triangleFrames[j * 4],
        ny = this.triangleFrames[j * 4 + 1],
        nz = this.triangleFrames[j * 4 + 2],
        area = this.triangleFrames[j * 4 + 3];
      const ux = p[b] - p[a],
        uy = p[b + 1] - p[a + 1],
        uz = p[b + 2] - p[a + 2],
        vx = p[c] - p[a],
        vy = p[c + 1] - p[a + 1],
        vz = p[c + 2] - p[a + 2];
      const C =
        (uy * vz - uz * vy) * nx +
        (uz * vx - ux * vz) * ny +
        (ux * vy - uy * vx) * nz -
        area * 0.25;
      if (C >= 0) continue;
      let denom = 0;
      for (let k = 0; k < 3; k++) {
        const i1 = this.index[t + ((k + 1) % 3)] * 3,
          i2 = this.index[t + ((k + 2) % 3)] * 3,
          dx = p[i1] - p[i2],
          dy = p[i1 + 1] - p[i2 + 1],
          dz = p[i1 + 2] - p[i2 + 2];
        g[k * 3] = dy * nz - dz * ny;
        g[k * 3 + 1] = dz * nx - dx * nz;
        g[k * 3 + 2] = dx * ny - dy * nx;
        denom +=
          this.movable[this.index[t + k]] *
          (g[k * 3] ** 2 + g[k * 3 + 1] ** 2 + g[k * 3 + 2] ** 2);
      }
      if (denom < 1e-15) continue;
      const s = (-C / denom) * 0.85;
      for (let k = 0; k < 3; k++)
        if (this.movable[this.index[t + k]])
          for (let d = 0; d < 3; d++)
            p[this.index[t + k] * 3 + d] += s * g[k * 3 + d];
    }
  }
  private bend(edge: Edge, solve: boolean) {
    // p0/p1 are opposite the shared p2/p3 edge.
    const p = this.p,
      i0 = edge.c * 3,
      i1 = edge.d * 3,
      i2 = edge.a * 3,
      i3 = edge.b * 3;
    const ex = p[i3] - p[i2],
      ey = p[i3 + 1] - p[i2 + 1],
      ez = p[i3 + 2] - p[i2 + 2],
      elen = Math.hypot(ex, ey, ez);
    if (elen < 1e-6) return NaN;
    const ax = p[i2] - p[i0],
      ay = p[i2 + 1] - p[i0 + 1],
      az = p[i2 + 2] - p[i0 + 2],
      bx = p[i3] - p[i0],
      by = p[i3 + 1] - p[i0 + 1],
      bz = p[i3 + 2] - p[i0 + 2];
    const cx = p[i3] - p[i1],
      cy = p[i3 + 1] - p[i1 + 1],
      cz = p[i3 + 2] - p[i1 + 2],
      dx = p[i2] - p[i1],
      dy = p[i2 + 1] - p[i1 + 1],
      dz = p[i2 + 2] - p[i1 + 2];
    let nx = ay * bz - az * by,
      ny = az * bx - ax * bz,
      nz = ax * by - ay * bx,
      mx = cy * dz - cz * dy,
      my = cz * dx - cx * dz,
      mz = cx * dy - cy * dx;
    const n2 = nx * nx + ny * ny + nz * nz,
      m2 = mx * mx + my * my + mz * mz;
    if (n2 < 1e-16 || m2 < 1e-16) return NaN;
    const cosine = Math.max(
      -1,
      Math.min(1, (nx * mx + ny * my + nz * mz) / Math.sqrt(n2 * m2)),
    );
    if (solve && cosine >= edge.cosine) return 0;
    const phi = Math.acos(cosine);
    if (!solve) return phi;
    // Allow a smooth concave contact; only resist excess curvature at mesh scale.
    const limit = edge.angle + 0.19;
    if (phi <= limit) return phi;
    const sign =
      (ny * mz - nz * my) * ex +
        (nz * mx - nx * mz) * ey +
        (nx * my - ny * mx) * ez >
      0
        ? -1
        : 1;
    nx /= n2;
    ny /= n2;
    nz /= n2;
    mx /= m2;
    my /= m2;
    mz /= m2;
    const a0 = (-bx * ex - by * ey - bz * ez) / elen,
      a1 = (-cx * ex - cy * ey - cz * ez) / elen,
      b0 = (ax * ex + ay * ey + az * ez) / elen,
      b1 = (dx * ex + dy * ey + dz * ez) / elen;
    const g = this.grads;
    g[0] = elen * nx;
    g[1] = elen * ny;
    g[2] = elen * nz;
    g[3] = elen * mx;
    g[4] = elen * my;
    g[5] = elen * mz;
    g[6] = a0 * nx + a1 * mx;
    g[7] = a0 * ny + a1 * my;
    g[8] = a0 * nz + a1 * mz;
    g[9] = b0 * nx + b1 * mx;
    g[10] = b0 * ny + b1 * my;
    g[11] = b0 * nz + b1 * mz;
    const ids = edge.ids;
    let denom = 0;
    for (let k = 0; k < 4; k++)
      denom +=
        this.movable[ids[k]] *
        (g[k * 3] ** 2 + g[k * 3 + 1] ** 2 + g[k * 3 + 2] ** 2);
    if (denom < 1e-10) return phi;
    const scale = ((phi - limit) / denom) * 0.6 * sign;
    for (let k = 0; k < 4; k++)
      if (this.movable[ids[k]])
        for (let a = 0; a < 3; a++) p[ids[k] * 3 + a] -= scale * g[k * 3 + a];
    return phi;
  }
}
