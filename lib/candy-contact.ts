import * as THREE from 'three/webgpu';
import type { Point3, CandyCollision } from './candy-physics';
import { candySupport, candyBevel, type CandyBody } from './candy-physics.ts';

/** Cached vertex-cluster shell: indexed GLB topology, refreshed from live skin. */
export class CandyContact {
  readonly bounds = new THREE.Box3();
  private body: THREE.Mesh;
  private groups: number[][] = [];
  private points: THREE.Vector3[] = [];
  private faces: {
    ids: number[];
    triangle: THREE.Triangle;
    normal: THREE.Vector3;
    box: THREE.Box3;
  }[] = [];
  private query = new THREE.Vector3();
  private closest = new THREE.Vector3();
  private bestPoint = new THREE.Vector3();
  private bestNormal = new THREE.Vector3();
  private delta = new THREE.Vector3();
  private floorRay = new THREE.Ray();
  private exitPoint = new THREE.Vector3();
  private exitNormal = new THREE.Vector3();
  private room?: { x: number; zMin: number; zMax: number };
  get triangleCount() {
    return this.faces.length;
  }
  constructor(
    body: THREE.Mesh,
    room?: { x: number; zMin: number; zMax: number },
  ) {
    this.room = room;
    this.body = body;
    const position = body.geometry.getAttribute('position');
    const normal = body.geometry.getAttribute('normal');
    const index = body.geometry.index;
    // Spatial grouping does not assume exported indices retain authoring rings.
    const cells = new Map<string, number>();
    const remap = new Uint32Array(position.count);
    const box = new THREE.Box3().setFromBufferAttribute(
      position as THREE.BufferAttribute,
    );
    const size = box.getSize(new THREE.Vector3());
    const cell = Math.max(size.x, size.y, size.z) / 16;
    for (let i = 0; i < position.count; i++) {
      const key = `${Math.floor((position.getX(i) - box.min.x) / cell)},${Math.floor((position.getY(i) - box.min.y) / cell)},${Math.floor((position.getZ(i) - box.min.z) / cell)}`;
      let id = cells.get(key);
      if (id === undefined) {
        id = this.groups.length;
        cells.set(key, id);
        this.groups.push([]);
        this.points.push(new THREE.Vector3());
      }
      this.groups[id].push(i);
      remap[i] = id;
    }
    const seen = new Set<string>();
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      n = new THREE.Vector3();
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const source = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
      const ids = source.map((k) => remap[k]);
      if (new Set(ids).size < 3) continue;
      const key = [...ids].sort((x, y) => x - y).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      a.fromBufferAttribute(position, source[0]);
      b.fromBufferAttribute(position, source[1]);
      c.fromBufferAttribute(position, source[2]);
      THREE.Triangle.getNormal(a, b, c, n);
      if (
        normal &&
        n.dot(this.delta.fromBufferAttribute(normal, source[0])) < 0
      )
        [ids[1], ids[2]] = [ids[2], ids[1]];
      this.faces.push({
        ids,
        triangle: new THREE.Triangle(),
        normal: new THREE.Vector3(),
        box: new THREE.Box3(),
      });
    }
    this.update();
  }
  update() {
    const position = this.body.geometry.getAttribute('position');
    this.body.updateWorldMatrix(true, false);
    this.bounds.makeEmpty();
    for (let i = 0; i < this.groups.length; i++) {
      const point = this.points[i].set(0, 0, 0),
        group = this.groups[i];
      for (const vertex of group)
        point.add(this.delta.fromBufferAttribute(position, vertex));
      point
        .multiplyScalar(1 / group.length)
        .applyMatrix4(this.body.matrixWorld);
      this.bounds.expandByPoint(point);
    }
    for (const face of this.faces) {
      const [a, b, c] = face.ids;
      face.triangle.set(this.points[a], this.points[b], this.points[c]);
      face.triangle.getNormal(face.normal);
      face.box
        .makeEmpty()
        .expandByPoint(this.points[a])
        .expandByPoint(this.points[b])
        .expandByPoint(this.points[c]);
    }
  }
  contact = (p: Point3, radius: number): CandyCollision | null => {
    this.query.set(p.x, p.y, p.z);
    // Small margin covers smoothing introduced by vertex clustering.
    const cube = (p as Partial<CandyBody>).kind === 'cube';
    const support = (n: Point3) =>
      cube ? candySupport(p as CandyBody, n) : radius;
    const bevel = cube ? candyBevel('cube', radius) : radius;
    let clearance = (radius - bevel) * Math.sqrt(3) + bevel + 0.025;
    if (this.bounds.distanceToPoint(this.query) > clearance) return null;
    let best = Infinity;
    for (const face of this.faces) {
      if (
        face.normal.lengthSq() < 0.5 ||
        face.box.distanceToPoint(this.query) ** 2 > best
      )
        continue;
      face.triangle.closestPointToPoint(this.query, this.closest);
      const distance = this.closest.distanceToSquared(this.query);
      if (distance < best) {
        best = distance;
        this.bestPoint.copy(this.closest);
        this.bestNormal.copy(face.normal);
      }
    }
    if (!Number.isFinite(best)) return null;
    const signed = this.delta
      .subVectors(this.query, this.bestPoint)
      .dot(this.bestNormal);
    // For outside edges/corners use the true closest-point normal.
    if (signed > 0 && best > 1e-10)
      this.bestNormal.copy(this.delta).normalize();
    clearance = support(this.bestNormal) + 0.025;
    if (signed >= 0 && best >= clearance * clearance) return null;
    // Preserve local skin contact before searching for a floor-safe ejection.
    // Absorption follows this surface; a bouncing candy uses the feasible exit.
    const surface = {
      x: this.bestPoint.x,
      y: this.bestPoint.y,
      z: this.bestPoint.z,
    };
    const surfaceNormal = {
      x: this.bestNormal.x,
      y: this.bestNormal.y,
      z: this.bestNormal.z,
    };
    this.bestPoint.addScaledVector(this.bestNormal, clearance);
    // Respect room and desk jointly with skin: choose a real surface exit,
    // rather than projecting through a wall then clamping back inside skin.
    if (!this.feasible(this.bestPoint, radius)) {
      let nearestExit = Infinity;
      for (let direction = -1; direction <= 32; direction++) {
        const angle = (direction * Math.PI) / 16;
        this.delta.set(Math.cos(angle), 0, Math.sin(angle));
        if (direction === 32) this.delta.set(0, 1, 0);
        if (direction === -1) {
          this.bounds.getCenter(this.delta);
          this.delta.subVectors(this.query, this.delta).setY(0);
          if (this.delta.lengthSq() < 1e-8) this.delta.set(1, 0, 0);
          this.delta.normalize();
        }
        this.floorRay.set(this.query, this.delta);
        let furthest = -1;
        for (const face of this.faces) {
          if (!this.floorRay.intersectsBox(face.box)) continue;
          if (
            this.floorRay.intersectTriangle(
              face.triangle.a,
              face.triangle.b,
              face.triangle.c,
              false,
              this.closest,
            )
          ) {
            const distance = this.closest.distanceToSquared(this.query);
            if (distance > furthest) {
              furthest = distance;
              this.exitPoint.copy(this.closest);
              this.exitNormal.copy(face.normal);
            }
          }
        }
        if (furthest < 0) continue;
        // Offset along the ray enough to clear the actual crossed plane.
        this.exitPoint.addScaledVector(
          this.delta,
          clearance / Math.max(0.1, this.exitNormal.dot(this.delta)),
        );
        if (!this.feasible(this.exitPoint, radius)) continue;
        const distance = this.exitPoint.distanceToSquared(this.query);
        if (distance < nearestExit) {
          nearestExit = distance;
          this.bestPoint.copy(this.exitPoint);
          this.bestNormal.copy(this.delta);
          if (direction === -1) break;
        }
      }
    }
    return {
      surface,
      surfaceNormal,
      position: {
        x: this.bestPoint.x,
        y: this.bestPoint.y,
        z: this.bestPoint.z,
      },
      normal: {
        x: this.bestNormal.x,
        y: this.bestNormal.y,
        z: this.bestNormal.z,
      },
    };
  };
  private feasible(point: THREE.Vector3, radius: number) {
    return (
      point.y >= radius &&
      (!this.room ||
        (point.x >= -this.room.x + radius &&
          point.x <= this.room.x - radius &&
          point.z >= this.room.zMin + radius &&
          point.z <= this.room.zMax - radius))
    );
  }
  /** Coarse, double-sided visibility test used only on pointer down. */
  occludes(ray: THREE.Ray, distance: number) {
    for (const face of this.faces) {
      if (
        ray.intersectTriangle(
          face.triangle.a,
          face.triangle.b,
          face.triangle.c,
          false,
          this.closest,
        ) &&
        ray.origin.distanceTo(this.closest) < distance - 0.025
      )
        return true;
    }
    return false;
  }
}
