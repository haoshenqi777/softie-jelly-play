export const heightAt = (t: number) =>
  0.025 +
  2.37 * Math.pow((t + 1) / 2, 1.27) +
  0.36 * Math.exp(-(Math.acos(t) ** 2) / 0.065);
export const radiusAt = (t: number) =>
  Math.pow(Math.sqrt(Math.max(0, 1 - t * t)), 0.83) * (1 - 0.065 * t);

// A material-height lookup morphs the entire skin and its embedded features.
// The inflated envelope is spherical with a small, soft contact patch underneath.
const top = heightAt(1),
  bottom = heightAt(-1);
const roundProfile = Array.from({ length: 2049 }, (_, i) => {
  const y = bottom + ((top - bottom) * i) / 2048;
  let low = -1,
    high = 1;
  for (let k = 0; k < 24; k++) {
    const t = (low + high) / 2;
    if (heightAt(t) < y) low = t;
    else high = t;
  }
  const t = (low + high) / 2;
  return {
    y: Math.max(bottom, 1.6 + 1.7 * t),
    radial: (1.7 * Math.pow(Math.max(0, 1 - t * t), 0.085)) / (1 - 0.065 * t),
  };
});
export function inflatePoint(
  x: number,
  y: number,
  z: number,
  amount: number,
  out: { x: number; y: number; z: number },
) {
  const index = Math.max(
    0,
    Math.min(2047.99999, ((y - bottom) / (top - bottom)) * 2048),
  );
  const i = Math.floor(index),
    f = index - i;
  const a = roundProfile[i],
    b = roundProfile[i + 1];
  const r = a.radial + (b.radial - a.radial) * f;
  out.x = x * (1 + (r / 1.64 - 1) * amount);
  out.y = y + (a.y + (b.y - a.y) * f - y) * amount;
  out.z = z * (1 + (r / 1.18 - 1) * amount);
}
