import type { Matrix4 } from 'three';

const vertical = [0, 1, 0];

/** Volume-preserving world-space squash along the measured load direction. */
export function candyCompressionMatrix(
  out: Matrix4,
  compression: number,
  axis: ArrayLike<number> = vertical,
) {
  const s = 1 - compression,
    r = 1 / Math.sqrt(s),
    d = s - r;
  const x = axis[0],
    y = axis[1],
    z = axis[2];
  return out.set(
    r + d * x * x,
    d * x * y,
    d * x * z,
    0,
    d * x * y,
    r + d * y * y,
    d * y * z,
    0,
    d * x * z,
    d * y * z,
    r + d * z * z,
    0,
    0,
    0,
    0,
    1,
  );
}

/** Inverse of the same symmetric deformation, also its normal transform. */
export function inverseCandyCompression(
  x: number,
  y: number,
  z: number,
  compression: number,
  axis: ArrayLike<number> = vertical,
  out: Float64Array,
) {
  const s = 1 - compression,
    r = Math.sqrt(s),
    d = (1 / s - r) * (x * axis[0] + y * axis[1] + z * axis[2]);
  out[0] = x * r + axis[0] * d;
  out[1] = y * r + axis[1] * d;
  out[2] = z * r + axis[2] * d;
}
