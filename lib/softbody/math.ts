/** Row-major 3x3 helpers. All writes are into caller-owned buffers. */
export function determinant(a: ArrayLike<number>): number {
  return (
    a[0] * (a[4] * a[8] - a[5] * a[7]) -
    a[1] * (a[3] * a[8] - a[5] * a[6]) +
    a[2] * (a[3] * a[7] - a[4] * a[6])
  );
}
export function cofactor(a: ArrayLike<number>, out: Float64Array): void {
  out[0] = a[4] * a[8] - a[5] * a[7];
  out[1] = a[5] * a[6] - a[3] * a[8];
  out[2] = a[3] * a[7] - a[4] * a[6];
  out[3] = a[2] * a[7] - a[1] * a[8];
  out[4] = a[0] * a[8] - a[2] * a[6];
  out[5] = a[1] * a[6] - a[0] * a[7];
  out[6] = a[1] * a[5] - a[2] * a[4];
  out[7] = a[2] * a[3] - a[0] * a[5];
  out[8] = a[0] * a[4] - a[1] * a[3];
}
export function inverse(a: ArrayLike<number>, out: Float64Array): number {
  const d = determinant(a);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-12)
    throw new Error('Degenerate rest tetrahedron');
  const c = new Float64Array(9);
  cofactor(a, c);
  for (let r = 0; r < 3; r++)
    for (let k = 0; k < 3; k++) out[r * 3 + k] = c[k * 3 + r] / d;
  return d;
}
