import { Box3, Sphere, type BufferGeometry } from 'three/webgpu';

/** Same area-weighted normals and exact bounds as BufferGeometry's three
 * separate passes. Direct packed-array access avoids per-component accessor
 * calls over the full contact mesh; no topology or shading approximation.
 * Internal contract: EmbeddedSurface supplies packed Float32 float3 positions
 * and normals, with morph attributes removed before BodyIntake calls this. */
export function updateDeformedSurface(geometry: BufferGeometry) {
  const position = geometry.attributes.position,
    normal = geometry.attributes.normal;
  if (
    !geometry.index ||
    'isInterleavedBufferAttribute' in position ||
    'isInterleavedBufferAttribute' in normal
  ) {
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return;
  }
  const p = position.array,
    n = normal.array,
    index = geometry.index.array;
  n.fill(0);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3,
      b = index[i + 1] * 3,
      c = index[i + 2] * 3;
    const cx = p[c] - p[b],
      cy = p[c + 1] - p[b + 1],
      cz = p[c + 2] - p[b + 2];
    const ax = p[a] - p[b],
      ay = p[a + 1] - p[b + 1],
      az = p[a + 2] - p[b + 2];
    const nx = cy * az - cz * ay,
      ny = cz * ax - cx * az,
      nz = cx * ay - cy * ax;
    n[a] += nx;
    n[a + 1] += ny;
    n[a + 2] += nz;
    n[b] += nx;
    n[b + 1] += ny;
    n[b + 2] += nz;
    n[c] += nx;
    n[c + 1] += ny;
    n[c + 2] += nz;
  }
  let lx = Infinity,
    ly = Infinity,
    lz = Infinity,
    hx = -Infinity,
    hy = -Infinity,
    hz = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const inv =
      1 /
      (Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1);
    n[i] *= inv;
    n[i + 1] *= inv;
    n[i + 2] *= inv;
    lx = Math.min(lx, p[i]);
    ly = Math.min(ly, p[i + 1]);
    lz = Math.min(lz, p[i + 2]);
    hx = Math.max(hx, p[i]);
    hy = Math.max(hy, p[i + 1]);
    hz = Math.max(hz, p[i + 2]);
  }
  const box = geometry.boundingBox ?? (geometry.boundingBox = new Box3());
  box.min.set(lx, ly, lz);
  box.max.set(hx, hy, hz);
  const sphere =
    geometry.boundingSphere ?? (geometry.boundingSphere = new Sphere());
  box.getCenter(sphere.center);
  const { x, y, z } = sphere.center;
  let radius = 0;
  for (let i = 0; i < p.length; i += 3)
    radius = Math.max(
      radius,
      (p[i] - x) ** 2 + (p[i + 1] - y) ** 2 + (p[i + 2] - z) ** 2,
    );
  sphere.radius = Math.sqrt(radius);
  normal.needsUpdate = true;
}
