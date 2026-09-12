import * as THREE from 'three/webgpu';

export type FaceBinding = {
  ids: number[];
  weights: number[];
  offset: number[];
  z: number;
};

/** Rest-space front surface lookup. Expressions move across real triangles;
 * their small depth offsets rotate with those triangles during softbody motion. */
export class FaceChart {
  private body: THREE.BufferGeometry;
  private rest: THREE.BufferAttribute;
  private index: THREE.BufferAttribute;
  private bins = new Map<string, number[]>();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();
  private u = new THREE.Vector3();
  private v = new THREE.Vector3();
  private n = new THREE.Vector3();
  constructor(body: THREE.BufferGeometry) {
    this.body = body;
    this.rest = body.getAttribute('position').clone() as THREE.BufferAttribute;
    this.index = body.getIndex()!;
    for (let t = 0; t < this.index.count; t += 3) {
      const ids = [
        this.index.getX(t),
        this.index.getX(t + 1),
        this.index.getX(t + 2),
      ];
      const xs = ids.map((i) => this.rest.getX(i)),
        ys = ids.map((i) => this.rest.getY(i));
      if (
        Math.max(...ids.map((i) => this.rest.getZ(i))) < 0 ||
        Math.max(...ys) < 0.15 ||
        Math.min(...ys) > 1.4 ||
        Math.max(...xs) < -1.2 ||
        Math.min(...xs) > 1.2
      )
        continue;
      for (
        let x = Math.floor(Math.min(...xs) * 10);
        x <= Math.floor(Math.max(...xs) * 10);
        x++
      )
        for (
          let y = Math.floor(Math.min(...ys) * 10);
          y <= Math.floor(Math.max(...ys) * 10);
          y++
        ) {
          const key = `${x},${y}`;
          const bin = this.bins.get(key) ?? [];
          bin.push(t);
          this.bins.set(key, bin);
        }
    }
  }
  private basis(source: THREE.BufferAttribute, ids: number[]) {
    this.a.fromBufferAttribute(source, ids[0]);
    this.b.fromBufferAttribute(source, ids[1]);
    this.c.fromBufferAttribute(source, ids[2]);
    this.u.subVectors(this.b, this.a).normalize();
    this.v.subVectors(this.c, this.a);
    this.n.crossVectors(this.u, this.v).normalize();
    this.v.crossVectors(this.n, this.u).normalize();
  }
  bind(x: number, y: number, depth = 0): FaceBinding {
    let best: FaceBinding | undefined;
    for (const t of this.bins.get(
      `${Math.floor(x * 10)},${Math.floor(y * 10)}`,
    ) ?? []) {
      const ids = [
        this.index.getX(t),
        this.index.getX(t + 1),
        this.index.getX(t + 2),
      ];
      const ax = this.rest.getX(ids[0]),
        ay = this.rest.getY(ids[0]),
        bx = this.rest.getX(ids[1]),
        by = this.rest.getY(ids[1]),
        cx = this.rest.getX(ids[2]),
        cy = this.rest.getY(ids[2]);
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-12) continue;
      const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d,
        b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d,
        c = 1 - a - b;
      if (Math.min(a, b, c) < -1e-7) continue;
      const z =
        a * this.rest.getZ(ids[0]) +
        b * this.rest.getZ(ids[1]) +
        c * this.rest.getZ(ids[2]);
      if (best && z <= best.z) continue;
      best = { ids, weights: [a, b, c], offset: [], z };
    }
    if (!best) throw new Error(`Expression outside facial surface: ${x},${y}`);
    this.basis(this.rest, best.ids);
    best.offset = [this.u.z * depth, this.v.z * depth, this.n.z * depth];
    return best;
  }
  apply(bindings: FaceBinding[], geometry: THREE.BufferGeometry) {
    const source = this.body.getAttribute('position') as THREE.BufferAttribute;
    const out = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < bindings.length; i++) {
      const { ids, weights: w, offset: o } = bindings[i];
      this.basis(source, ids);
      out.setXYZ(
        i,
        this.a.x * w[0] +
          this.b.x * w[1] +
          this.c.x * w[2] +
          this.u.x * o[0] +
          this.v.x * o[1] +
          this.n.x * o[2],
        this.a.y * w[0] +
          this.b.y * w[1] +
          this.c.y * w[2] +
          this.u.y * o[0] +
          this.v.y * o[1] +
          this.n.y * o[2],
        this.a.z * w[0] +
          this.b.z * w[1] +
          this.c.z * w[2] +
          this.u.z * o[0] +
          this.v.z * o[1] +
          this.n.z * o[2],
      );
    }
    out.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }
}
