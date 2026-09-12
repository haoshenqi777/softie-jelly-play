import type { V3 } from './behavior-types.ts';

export function cameraFacing(
  cameraPosition: V3,
  center: V3,
  lastDirection: V3,
): V3 {
  const x = cameraPosition[0] - center[0],
    z = cameraPosition[2] - center[2],
    n = Math.hypot(x, z);
  return Number.isFinite(n) && n > 1e-5
    ? [x / n, 0, z / n]
    : [...lastDirection];
}

/** Detect angular motion in radians/second so camera quiet time is independent
 * of display refresh rate. Direction vectors are projected onto the table. */
export function cameraDirectionMoving(
  previous: V3,
  current: V3,
  dt: number,
): boolean {
  if (!Number.isFinite(dt) || dt <= 0) return false;
  const cross = previous[0] * current[2] - previous[2] * current[0];
  const dot = previous[0] * current[0] + previous[2] * current[2];
  const angle = Math.abs(Math.atan2(cross, dot));
  return Number.isFinite(angle) && angle / dt > 0.01;
}

export function rendezvous(
  cameraPosition: V3,
  anchor: V3,
  width: number,
  lastDirection: V3,
): { point: V3; direction: V3 } {
  const direction = cameraFacing(cameraPosition, anchor, lastDirection);
  return {
    point: [
      anchor[0] + direction[0] * width * 0.08,
      0,
      anchor[2] + direction[2] * width * 0.08,
    ],
    direction,
  };
}
