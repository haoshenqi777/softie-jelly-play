type Timing = {
  bite: number;
  chewEnd: number;
  swallowEnd: number;
  spreadEnd: number;
  end: number;
};
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
export function sampleMeal(age: number, t: Timing) {
  const chewing = age >= t.bite && age < t.chewEnd;
  const cycle = (age - t.bite) / 0.7;
  const chew = chewing ? Math.sin(cycle * Math.PI) ** 2 : 0;
  return {
    ingest: smooth(age / t.bite),
    chew,
    chewSide: (Math.floor(cycle) % 2 === 0 ? -1 : 1) * chew,
    swallow: smooth((age - t.chewEnd) / (t.swallowEnd - t.chewEnd)),
    dispersion: smooth((age - t.swallowEnd) / 3.8),
    visibility:
      age < 0
        ? 0
        : smooth((age - 0.38) / 0.5) * (1 - smooth((age - 6.1) / 2.1)),
  };
}
