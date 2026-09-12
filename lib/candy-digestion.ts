import { HARD_CUBE_VOLUMES } from './hard-candy-volume.ts';
import { HARD_CUBE_BEVEL, BASE_CANDY_RADIUS } from './candy-physics.ts';
/** Shared artistic timing, with actual remaining volume driving core size. */
export const DIGESTION = { hold: 1.25, dissolve: 6.5, total: 13 } as const;
export type DigestionShape = 'round' | { bevel: number };
const clamp = (v: number) =>
  Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const ease = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
const cubeVolume = (half: number, radius: number) => {
  const r = Math.min(half, radius),
    a = half - r;
  return (
    8 * a * a * a +
    24 * a * a * r +
    6 * Math.PI * a * r * r +
    (4 * Math.PI * r * r * r) / 3
  );
};
export function erosionForReleased(
  released: number,
  shape: DigestionShape = { bevel: 0.045 },
) {
  const mass = clamp(released);
  if (mass === 0 || mass === 1) return mass;
  if (shape === 'round') return 1 - Math.cbrt(1 - mass);
  if (
    Math.abs(shape.bevel - (HARD_CUBE_BEVEL * 0.18) / BASE_CANDY_RADIUS) < 1e-6
  ) {
    const remaining = 1 - mass;
    let lo = 0,
      hi = HARD_CUBE_VOLUMES.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (HARD_CUBE_VOLUMES[mid] > remaining) lo = mid;
      else hi = mid;
    }
    const u =
      (HARD_CUBE_VOLUMES[lo] - remaining) /
      (HARD_CUBE_VOLUMES[lo] - HARD_CUBE_VOLUMES[hi]);
    return (lo + u) / (HARD_CUBE_VOLUMES.length - 1);
  }
  const initial = cubeVolume(0.18, shape.bevel),
    target = initial * (1 - mass);
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 20; i++) {
    const u = (lo + hi) / 2;
    if (cubeVolume(0.18 * (1 - u), shape.bevel + 0.11 * u) > target) lo = u;
    else hi = u;
  }
  return (lo + hi) / 2;
}
export function digestionAt(
  elapsed: number,
  shape: DigestionShape = { bevel: 0.045 },
) {
  const time = Math.max(
    0,
    Math.min(DIGESTION.total, Number.isFinite(elapsed) ? elapsed : 0),
  );
  const diffusionAge = Math.max(0, time - DIGESTION.hold);
  const released = ease(diffusionAge / DIGESTION.dissolve);
  return {
    time,
    stage: (time >= DIGESTION.total
      ? 'done'
      : time < DIGESTION.hold
        ? 'inside'
        : released < 1
          ? 'dissolving'
          : 'settling') as 'inside' | 'dissolving' | 'settling' | 'done',
    released,
    remaining: 1 - released,
    dissolve: erosionForReleased(released, shape),
    diffusionAge,
  };
}
