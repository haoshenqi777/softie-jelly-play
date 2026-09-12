/** A readable glance/tilt/hold sequence with a long quiet tail. The motor and
 * eyes sample the same clock; its curves request forces, never mesh poses. */
const smooth = (x: number) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * u * (u * (u * 6 - 15) + 10);
};
function glance(t: number) {
  if (t < 0.35) return 0;
  if (t < 0.95) return -smooth((t - 0.35) / 0.6);
  if (t < 1.5) return -1;
  if (t < 2.4) return -1 + 2 * smooth((t - 1.5) / 0.9);
  if (t < 3.05) return 1;
  if (t < 4.05) return 1 - smooth(t - 3.05);
  return 0;
}
export function curiosityMotion(age: number, stage: string = 'inspecting') {
  const seconds = Number.isFinite(age) ? Math.max(0, age) : 0;
  const t = seconds % 8.6;
  const side = Math.floor(seconds / 8.6) % 2 ? -1 : 1;
  const scanning = stage === 'inspecting';
  const eyes = scanning ? glance(t + 0.15) * side : 0;
  const head = scanning ? glance(t) * side : 0;
  return {
    gazeX: eyes * 0.95,
    gazeY: -0.4,
    yaw: head * 0.12,
    roll: head * 0.16,
    bend: head * 0.13,
    stretch: Math.abs(head) * 0.018,
    crown: Math.abs(head) * 0.045,
    lid: Math.abs(eyes) * 0.22,
  };
}
