import { Matrix4, Vector3 } from 'three/webgpu';
import { mix, uniform, vec3, vec4 } from 'three/tsl';
import {
  PigmentLayer,
  validPigment,
  type PigmentId,
} from './studio-pigment.ts';
import { smoothRange, type AbsorptionFrame } from './absorption-motion.ts';

/** Procedural material-space concentration: no screen-space blobs or particles.
 * Uniforms can later be driven by a body-bound candy/contact source. */
export class AbsorptionField {
  private underlay?: AbsorptionField;
  private inherited = uniform(0);
  private strength = 100;
  private hue = 0;
  private palette = false;
  get appearance() {
    return { id: this.state.base, strength: this.strength, hue: this.hue };
  }
  select(id: PigmentId, strength = 100, hue = 0) {
    this.inherited.value = 0;
    this.palette = true;
    this.strength = Number.isFinite(strength)
      ? Math.max(0, Math.min(100, strength))
      : 100;
    this.hue = Number.isFinite(hue) ? Math.max(-45, Math.min(45, hue)) : 0;
    this.baseline.configureShade(validPigment(id), this.strength, this.hue);
    this.target = validPigment(id);
    this.clear();
  }
  freeze(): Record<string, unknown> {
    return {
      version: 1,
      base: this.state.base,
      strength: this.strength,
      hue: this.hue,
      target: this.target,
      radius: this.radius.value,
      released: this.released.value,
      settled: this.settled.value,
      drift: this.drift.value,
      source: this.source.value.toArray(),
      underlay:
        this.inherited.value && this.underlay ? this.underlay.freeze() : null,
    };
  }
  restore(value: unknown) {
    const s =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    this.select(
      validPigment(s.base),
      typeof s.strength === 'number' ? s.strength : 100,
      typeof s.hue === 'number' ? s.hue : 0,
    );
    this.setTarget(validPigment(s.target ?? s.base));
    if (s.underlay && this.underlay) {
      this.underlay.restore(s.underlay);
      this.inherited.value = 1;
    }
    const bounded = (v: unknown, lo: number, hi: number, fallback: number) =>
      typeof v === 'number' && Number.isFinite(v)
        ? Math.max(lo, Math.min(hi, v))
        : fallback;
    this.radius.value = bounded(s.radius, 0.12, 6, 0.12);
    this.released.value = bounded(s.released, 0, 1, 0);
    this.settled.value = bounded(s.settled, 0, 1, 0);
    this.drift.value = bounded(s.drift, 0, 10, 0);
    if (
      Array.isArray(s.source) &&
      s.source.length === 3 &&
      s.source.every(
        (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 10,
      )
    )
      this.source.value.fromArray(s.source);
  }
  readonly source = uniform(new Vector3(-0.52, 0.46, 0.66));
  readonly radius = uniform(0.12);
  readonly released = uniform(0);
  readonly settled = uniform(0);
  readonly drift = uniform(0);
  readonly worldToRest = uniform(new Matrix4());
  private baseline = new PigmentLayer();
  private target: PigmentId = 'mint';
  private mint = new PigmentLayer();
  private bridge = new PigmentLayer();
  constructor(historyDepth = 0) {
    if (historyDepth > 0)
      this.underlay = new AbsorptionField(Math.min(2, historyDepth) - 1);
    this.mint.configure('mint', 100);
    this.bridge.configure('peach', 100);
  }
  get state() {
    return { base: this.baseline.state.id, target: this.target };
  }
  setTarget(id: PigmentId) {
    this.target = validPigment(id);
    if (this.palette) this.mint.configureShade(this.target);
    else this.mint.configure(this.target, 100);
  }
  commit() {
    this.inherited.value = 0;
    if (this.palette) {
      this.baseline.configureShade(this.target);
      this.strength = 100;
      this.hue = 0;
    } else this.baseline.configure(this.target, 100);
    this.clear();
  }
  beginDye(id: PigmentId, source: Vector3) {
    if (
      this.underlay &&
      (this.released.value > 0 ||
        this.settled.value > 0 ||
        this.inherited.value)
    ) {
      const previous = this.freeze();
      this.underlay.restore(previous);
      this.inherited.value = 1;
    }
    this.clear();
    this.setTarget(id);
    this.source.value.copy(source);
  }
  clear() {
    this.radius.value = 0.12;
    this.released.value = this.settled.value = this.drift.value = 0;
  }
  updateDigestion(f: { released: number; diffusionAge: number }) {
    this.radius.value = 0.12 + Math.sqrt(f.diffusionAge) * 0.48;
    this.released.value = f.released;
    this.settled.value = smoothRange(7.5, 11.75, f.diffusionAge);
    this.drift.value = f.diffusionAge * 0.09;
  }
  materialPoint(p: ReturnType<typeof vec3>) {
    return this.worldToRest.mul(vec4(p, 1)).xyz;
  }
  materialDirection(p: ReturnType<typeof vec3>) {
    return this.worldToRest.mul(vec4(p, 0)).xyz;
  }
  update(f: AbsorptionFrame) {
    this.radius.value = 0.12 + f.dye * 3.5;
    this.released.value = smoothRange(4.9, 6.3, f.time);
    this.settled.value = smoothRange(9.5, 12, f.time);
    this.drift.value = f.dye * 1.8;
  }
  concentration(p: readonly number[]) {
    const bx = (p[0] - this.source.value.x) / 1.05;
    const by = (p[1] - this.source.value.y) / 0.8;
    const bz = (p[2] - this.source.value.z) / 0.95;
    const curl = 0.17 * this.released.value * (1 - this.settled.value);
    const x = bx + Math.sin(by * 4.7 + this.drift.value) * curl;
    const y = by + Math.sin(bz * 5.1 - this.drift.value) * curl;
    const z = bz + Math.sin(bx * 4.3 + this.drift.value) * curl;
    const wave =
      Math.sin(x * 5.2 + this.drift.value) *
      Math.sin(y * 4.1 - this.drift.value * 0.6) *
      Math.sin(z * 4.8) *
      0.1;
    const d = Math.hypot(x, y, z) + wave;
    const local =
      (1 - smoothRange(this.radius.value * 0.35, this.radius.value * 1.15, d)) *
      this.released.value;
    return local + (1 - local) * this.settled.value;
  }
  private weight(p: ReturnType<typeof vec3>) {
    const base = p.sub(this.source).div(vec3(1.05, 0.8, 0.95));
    const curl = this.released.mul(this.settled.oneMinus()).mul(0.17);
    const q = base.add(
      vec3(
        base.y.mul(4.7).add(this.drift).sin(),
        base.z.mul(5.1).sub(this.drift).sin(),
        base.x.mul(4.3).add(this.drift).sin(),
      ).mul(curl),
    );
    const wave = q.x
      .mul(5.2)
      .add(this.drift)
      .sin()
      .mul(q.y.mul(4.1).sub(this.drift.mul(0.6)).sin())
      .mul(q.z.mul(4.8).sin())
      .mul(0.1);
    const local = q
      .length()
      .add(wave)
      .smoothstep(this.radius.mul(0.35), this.radius.mul(1.15))
      .oneMinus()
      .mul(this.released);
    return mix(local, 1, this.settled);
  }
  tint(
    rgb: ReturnType<typeof vec3>,
    p: ReturnType<typeof vec3>,
    deeper?: ReturnType<typeof vec3>,
  ): ReturnType<typeof vec3> {
    // Sample the surface and a point along the refracted path. The deeper sample
    // makes the concentration visible within the gel before reaching its skin.
    const w = deeper
      ? this.weight(p).max(this.weight(deeper).mul(0.9))
      : this.weight(p);
    // The approved warm bridge preserves pastel color at the moving interface
    // instead of desaturating the whole cloud with complementary RGB mixing.
    const base = this.underlay
      ? mix(
          this.baseline.tint(rgb),
          this.underlay.tint(rgb, p, deeper),
          this.inherited,
        )
      : this.baseline.tint(rgb);
    const warm = mix(base, this.bridge.tint(rgb), w.mul(w.oneMinus()).mul(1.2));
    return mix(warm, this.mint.tint(rgb), w);
  }
}
