const N = 19,
  HEIGHT = 2.78;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// Coupled flesh layers carry compression away from contact. Radial strain is
// paired with axial compensation, the small-strain incompressible relation
// d(uy)/dy = -2 * radial strain. Existing global modes handle large motion.
export class SlimeTissue {
  private q = new Float64Array(N);
  private v = new Float64Array(N);
  private dy = new Float64Array(N);
  impulse(y: number, strength: number) {
    for (let i = 0; i < N; i++) {
      const d = ((i * HEIGHT) / (N - 1) - y) / 0.22;
      this.v[i] += clamp(strength, -3, 3) * Math.exp(-d * d);
    }
  }
  advance(dt: number, stiffness: number, damping: number) {
    const h = Math.min(dt, 0.1) / Math.ceil(Math.min(dt, 0.1) * 240 || 1);
    const count = Math.ceil(Math.min(dt, 0.1) * 240 || 1);
    const coupling = 440 + stiffness * 4,
      restore = 30 + stiffness * 0.5;
    const drag = 1.8 + damping * 0.07;
    for (let step = 0; step < count; step++) {
      for (let i = 0; i < N; i++) {
        const lap =
          this.q[Math.max(0, i - 1)] +
          this.q[Math.min(N - 1, i + 1)] -
          2 * this.q[i];
        this.v[i] +=
          (coupling * lap - restore * this.q[i] - drag * this.v[i]) * h;
      }
      for (let i = 0; i < N; i++) {
        this.q[i] += this.v[i] * h;
        if (Math.abs(this.q[i]) > 0.12) {
          this.q[i] = clamp(this.q[i], -0.12, 0.12);
          this.v[i] *= 0.3;
        }
      }
    }
    this.dy[0] = 0;
    for (let i = 1; i < N; i++)
      this.dy[i] =
        this.dy[i - 1] - ((this.q[i - 1] + this.q[i]) * HEIGHT) / (N - 1);
  }
  sample(y: number, out = { radial: 0, axial: 0 }) {
    const t = clamp((y / HEIGHT) * (N - 1), 0, N - 1.000001),
      i = Math.floor(t),
      f = t - i;
    const smooth = f * f * (3 - 2 * f);
    out.radial = this.q[i] + (this.q[i + 1] - this.q[i]) * smooth;
    out.axial = this.dy[i] + (this.dy[i + 1] - this.dy[i]) * smooth;
    return out;
  }
  reset() {
    this.q.fill(0);
    this.v.fill(0);
    this.dy.fill(0);
  }
}
