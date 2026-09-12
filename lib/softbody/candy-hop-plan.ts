export type CandyHopMotion = 'high-pounce' | 'left-hop' | 'right-hop';
// Candy IDs survive a hand interruption. The single-candy limit must not reset
// choreography, and a repeated invitation must not change an airborne target.
const plans = [
  { motion: 'high-pounce', angle: 0, height: 1.22, gather: 0.52, bend: 0 },
  {
    motion: 'left-hop',
    angle: -0.55,
    height: 0.76,
    gather: 0.32,
    bend: -0.032,
  },
  { motion: 'right-hop', angle: 0.55, height: 0.91, gather: 0.4, bend: 0.032 },
] as const;
export function candyHopPlan(id = 1) {
  return plans[(Math.max(1, Math.trunc(id)) - 1) % plans.length];
}
