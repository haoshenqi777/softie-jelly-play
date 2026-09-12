import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import type { Binding, Cage } from './cage.ts';
import { sampleBinding } from './surface.ts';

/** Persistent material coordinate. A local tetrahedron transports its frame. */
export class MaterialAnchor {
  readonly binding: Binding;
  readonly restPoint: Vector3;
  private inverseRest: Matrix3;
  private tangent: Vector3;
  private normal: Vector3;
  constructor(cage: Cage, point: Vector3, normal: Vector3) {
    this.restPoint = point.clone();
    this.normal = normal.clone().normalize();
    this.tangent = new Vector3(
      ...((Math.abs(normal.y) < 0.85 ? [0, 1, 0] : [1, 0, 0]) as [
        number,
        number,
        number,
      ]),
    )
      .cross(this.normal)
      .normalize();
    this.binding = cage.bind(point.toArray());
    this.inverseRest = this.edges(cage.positions).invert();
  }
  private edges(nodes: ArrayLike<number>) {
    const p = this.binding.ids.map((id) =>
      new Vector3().fromArray(nodes, id * 3),
    );
    const a = p[1].sub(p[0]),
      b = p[2].sub(p[0]),
      c = p[3].sub(p[0]);
    return new Matrix3().set(a.x, b.x, c.x, a.y, b.y, c.y, a.z, b.z, c.z);
  }
  sample(nodes: ArrayLike<number>) {
    const f = this.edges(nodes).multiply(this.inverseRest);
    const n = this.normal
      .clone()
      .applyMatrix3(f.clone().invert().transpose())
      .normalize();
    const u = this.tangent.clone().applyMatrix3(f).normalize();
    const v = new Vector3().crossVectors(n, u).normalize();
    u.crossVectors(v, n).normalize();
    const rotation = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(u, v, n),
    );
    return {
      point: sampleBinding(this.binding, nodes, new Vector3()),
      normal: n,
      rotation,
    };
  }
}
