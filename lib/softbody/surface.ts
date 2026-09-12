import * as THREE from 'three/webgpu';
import type { Binding, Cage } from './cage';

export function sampleBinding(
  binding: Binding,
  nodes: ArrayLike<number>,
  out: THREE.Vector3,
) {
  out.set(0, 0, 0);
  for (let k = 0; k < 4; k++) {
    const i = binding.ids[k] * 3,
      w = binding.weights[k];
    out.x += nodes[i] * w;
    out.y += nodes[i + 1] * w;
    out.z += nodes[i + 2] * w;
  }
  return out;
}

export class EmbeddedSurface {
  readonly rest: Float32Array;
  private restNormals: Float32Array;
  private ids: Uint16Array;
  private weights: Float32Array;
  readonly geometry: THREE.BufferGeometry;
  constructor(geometry: THREE.BufferGeometry, cage: Cage) {
    this.geometry = geometry;
    // The mechanical rest surface replaces legacy preset morphs. Keeping their
    // deltas makes Three expand bounds by unused poses and shifts contact shadows.
    geometry.morphAttributes = {};
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
    this.rest = new Float32Array(position.array);
    this.restNormals = new Float32Array(normal.array);
    this.ids = new Uint16Array(position.count * 4);
    this.weights = new Float32Array(position.count * 4);
    const p = [0, 0, 0];
    for (let i = 0; i < position.count; i++) {
      p[0] = position.getX(i);
      p[1] = position.getY(i);
      p[2] = position.getZ(i);
      const binding = cage.bind(p);
      this.ids.set(binding.ids, i * 4);
      this.weights.set(binding.weights, i * 4);
    }
    position.setUsage(THREE.DynamicDrawUsage);
    normal.setUsage(THREE.DynamicDrawUsage);
  }
  update(nodes: Float64Array, transforms: Float64Array) {
    const position = this.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const normal = this.geometry.getAttribute(
      'normal',
    ) as THREE.BufferAttribute;
    const output = position.array,
      normals = normal.array;
    for (let v = 0; v < position.count; v++) {
      const p = v * 3;
      let x = 0,
        y = 0,
        z = 0;
      let m0 = 0,
        m1 = 0,
        m2 = 0,
        m3 = 0,
        m4 = 0,
        m5 = 0,
        m6 = 0,
        m7 = 0,
        m8 = 0;
      for (let k = 0; k < 4; k++) {
        const id = this.ids[v * 4 + k],
          w = this.weights[v * 4 + k];
        x += nodes[id * 3] * w;
        y += nodes[id * 3 + 1] * w;
        z += nodes[id * 3 + 2] * w;
        const a = id * 9;
        m0 += transforms[a] * w;
        m1 += transforms[a + 1] * w;
        m2 += transforms[a + 2] * w;
        m3 += transforms[a + 3] * w;
        m4 += transforms[a + 4] * w;
        m5 += transforms[a + 5] * w;
        m6 += transforms[a + 6] * w;
        m7 += transforms[a + 7] * w;
        m8 += transforms[a + 8] * w;
      }
      output[p] = x;
      output[p + 1] = y;
      output[p + 2] = z;
      // Inverse-transpose transport via cofactor, without dividing by det(F).
      // Rest normals are smooth authored normals, not the coarse cage facets.
      const n0 = this.restNormals[p],
        n1 = this.restNormals[p + 1],
        n2 = this.restNormals[p + 2];
      const nx =
        (m4 * m8 - m5 * m7) * n0 +
        (m5 * m6 - m3 * m8) * n1 +
        (m3 * m7 - m4 * m6) * n2;
      const ny =
        (m2 * m7 - m1 * m8) * n0 +
        (m0 * m8 - m2 * m6) * n1 +
        (m1 * m6 - m0 * m7) * n2;
      const nz =
        (m1 * m5 - m2 * m4) * n0 +
        (m2 * m3 - m0 * m5) * n1 +
        (m0 * m4 - m1 * m3) * n2;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      normals[p] = nx / length;
      normals[p + 1] = ny / length;
      normals[p + 2] = nz / length;
    }
    position.needsUpdate = normal.needsUpdate = true;
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }
}

type FaceAnchor = { triangle: number[]; weights: number[]; offset: number[] };

// Each facial vertex follows an actual visible-body triangle, including its
// small surface-normal offset. Picking, optics and facial motion share this mesh.
export class AttachedFace {
  private geometry: THREE.BufferGeometry;
  private body: THREE.BufferGeometry;
  private anchors: FaceAnchor[] = [];
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();
  private u = new THREE.Vector3();
  private v = new THREE.Vector3();
  private n = new THREE.Vector3();
  constructor(geometry: THREE.BufferGeometry, body: THREE.BufferGeometry) {
    this.geometry = geometry;
    geometry.morphAttributes = {};
    this.body = body;
    const surface = body.getAttribute('position'),
      index = body.getIndex()!;
    const adjacency: number[][] = Array.from(
      { length: surface.count },
      () => [],
    );
    for (let i = 0; i < index.count; i += 3)
      for (let k = 0; k < 3; k++) adjacency[index.getX(i + k)].push(i);
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    position.setUsage(THREE.DynamicDrawUsage);
    const point = new THREE.Vector3(),
      closest = new THREE.Vector3(),
      bary = new THREE.Vector3();
    const triangle = new THREE.Triangle(this.a, this.b, this.c);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i);
      let vertex = 0,
        distance = Infinity;
      for (let j = 0; j < surface.count; j++) {
        const d =
          (surface.getX(j) - point.x) ** 2 +
          (surface.getY(j) - point.y) ** 2 +
          (surface.getZ(j) - point.z) ** 2;
        if (d < distance) {
          distance = d;
          vertex = j;
        }
      }
      let anchor: FaceAnchor | undefined;
      distance = Infinity;
      for (const start of adjacency[vertex]) {
        const ids = [
          index.getX(start),
          index.getX(start + 1),
          index.getX(start + 2),
        ];
        this.a.fromBufferAttribute(surface, ids[0]);
        this.b.fromBufferAttribute(surface, ids[1]);
        this.c.fromBufferAttribute(surface, ids[2]);
        if (triangle.getArea() < 1e-9) continue;
        triangle.closestPointToPoint(point, closest);
        const d = point.distanceToSquared(closest);
        if (d >= distance) continue;
        distance = d;
        triangle.getBarycoord(closest, bary);
        this.basis();
        const delta = point.clone().sub(closest);
        anchor = {
          triangle: ids,
          weights: bary.toArray(),
          offset: [delta.dot(this.u), delta.dot(this.v), delta.dot(this.n)],
        };
      }
      if (!anchor) throw new Error('Facial surface attachment failed');
      this.anchors.push(anchor);
    }
  }
  private basis() {
    this.u.subVectors(this.b, this.a).normalize();
    this.v.subVectors(this.c, this.a);
    this.n.crossVectors(this.u, this.v).normalize();
    this.v.crossVectors(this.n, this.u).normalize();
  }
  update() {
    const surface = this.body.getAttribute('position');
    const position = this.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    for (let i = 0; i < this.anchors.length; i++) {
      const { triangle: ids, weights: w, offset: o } = this.anchors[i];
      this.a.fromBufferAttribute(surface, ids[0]);
      this.b.fromBufferAttribute(surface, ids[1]);
      this.c.fromBufferAttribute(surface, ids[2]);
      this.basis();
      position.setXYZ(
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
    position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }
}
