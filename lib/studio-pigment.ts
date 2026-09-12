import { Color, Vector3 } from 'three/webgpu';
import { mix, uniform, vec3 } from 'three/tsl';

export const PIGMENTS = [
  { id: 'rose', label: '玫瑰', swatch: '#ed91a3' },
  { id: 'strawberry', label: '草莓', swatch: '#ef8985' },
  { id: 'peach', label: '蜜桃琥珀', swatch: '#efa078' },
  { id: 'honey', label: '蜜糖', swatch: '#eac578' },
  { id: 'lemon', label: '柠檬', swatch: '#e9df87' },
  { id: 'mint', label: '海盐青', swatch: '#54c4c0' },
  { id: 'sky', label: '月光蓝', swatch: '#92a9ee' },
  { id: 'grape', label: '葡萄', swatch: '#c49ade' },
  { id: 'lychee', label: '荔枝白', swatch: '#e9e0ce' },
  { id: 'whitegrape', label: '青提绿', swatch: '#c8d971' },
  { id: 'pomegranate', label: '红石榴', swatch: '#e95069' },
  { id: 'tea', label: '烟晶茶', swatch: '#b2957b' },
] as const;
export type PigmentId = (typeof PIGMENTS)[number]['id'];
// Keep older IDs readable in saved appearances; the product has eight chosen colors.
export const PLAY_PIGMENTS = (
  [
    'rose',
    'peach',
    'mint',
    'sky',
    'lychee',
    'whitegrape',
    'pomegranate',
    'tea',
  ] as const
).map((id) => PIGMENTS.find((p) => p.id === id)!);
export const validPigment = (id: unknown): PigmentId =>
  PIGMENTS.some((p) => p.id === id) ? (id as PigmentId) : 'rose';
const shadeRecipes: Record<PigmentId, [string, string]> = {
  rose: ['#ed91a3', '#c9617b'],
  strawberry: ['#ee9d9b', '#d36779'],
  peach: ['#f49a76', '#c85830'],
  honey: ['#e8cb93', '#cf9d66'],
  lemon: ['#ebe0a5', '#cbb76d'],
  mint: ['#59cfc5', '#087f91'],
  sky: ['#9cafea', '#3c56b4'],
  grape: ['#cdb6dc', '#a084ba'],
  lychee: ['#f3eee3', '#d3c2a5'],
  whitegrape: ['#d4e38b', '#92ac31'],
  pomegranate: ['#ef687a', '#b91e3c'],
  tea: ['#c9b099', '#8e684a'],
};

// Relative extinction per channel, calibrated against the approved pink
// light capture. These are art-directed color endpoints, not measured spectra.
const extinction = {
  rose: [0, 1, 0.85],
  mint: [0.88, 0, 0.34],
  honey: [0, 0.3, 1.05],
  strawberry: [0, 1.6, 1.7],
  peach: [0, 0.52, 1.2],
  lemon: [0, 0.075, 1.05],
  sky: [1.05, 0.32, 0],
  grape: [0.35, 1.04, 0],
  lychee: [0, 0.06, 0.14],
  whitegrape: [0.18, 0, 1.35],
  pomegranate: [0, 1.65, 1.45],
  tea: [0.15, 0.56, 0.9],
} as const satisfies Record<PigmentId, readonly [number, number, number]>;
const paths = {
  rose: [extinction.rose, extinction.rose],
  mint: [
    extinction.rose,
    [0, 0.5, 1],
    [0, 0.08, 1],
    [0.36, 0, 0.75],
    extinction.mint,
  ],
  honey: [extinction.rose, [0, 0.55, 1], extinction.honey],
  strawberry: [extinction.rose, extinction.strawberry],
  peach: [extinction.rose, [0, 0.7, 1], extinction.peach],
  lemon: [extinction.rose, [0, 0.5, 1], extinction.lemon],
  sky: [extinction.rose, [0, 1, 0.32], extinction.grape, extinction.sky],
  grape: [extinction.rose, [0, 1, 0.32], extinction.grape],
  lychee: [extinction.rose, extinction.lychee],
  whitegrape: [extinction.rose, [0, 0.08, 1], extinction.whitegrape],
  pomegranate: [extinction.rose, extinction.pomegranate],
  tea: [extinction.rose, [0, 0.4, 1], extinction.tea],
} as const satisfies Record<
  PigmentId,
  readonly (readonly [number, number, number])[]
>;

export class PigmentLayer {
  readonly shadeEnabled = uniform(0);
  readonly shadeStrength = uniform(1);
  readonly shadeAbsorption = uniform(new Vector3());
  private shadeDeep = uniform(new Vector3());
  readonly amount = uniform(0);
  readonly colorWeight = uniform(0);
  readonly absorption = uniform(new Vector3(...extinction.rose));
  private id: PigmentId = 'rose';

  configure(id: PigmentId, percent = 100) {
    this.shadeEnabled.value = 0;
    this.id = Object.hasOwn(extinction, id) ? id : 'rose';
    const value = Number.isFinite(percent)
      ? Math.min(100, Math.max(0, percent))
      : 0;
    this.amount.value = this.id === 'rose' ? 0 : value / 100;
    // Pink and mint are complementary. A direct RGB crossfade turns grey.
    // Warm colors travel through peach/gold; cool colors through violet/blue.
    const path = paths[this.id];
    const t = this.amount.value * (path.length - 1);
    const index = Math.min(path.length - 2, Math.floor(t));
    const u = t - index;
    const ease = u * u * (3 - 2 * u);
    const start = path[index],
      end = path[index + 1];
    this.absorption.value.set(
      start[0] + (end[0] - start[0]) * ease,
      start[1] + (end[1] - start[1]) * ease,
      start[2] + (end[2] - start[2]) * ease,
    );
    const a = this.absorption.value;
    const low = Math.min(a.x, a.y, a.z);
    const range = Math.max(a.x, a.y, a.z) - low;
    const contrast = Math.max(...start) * (1 - ease) + Math.max(...end) * ease;
    a.addScalar(-low).multiplyScalar(contrast / Math.max(0.00001, range));
    const entry = Math.min(1, this.amount.value / 0.15);
    this.colorWeight.value = entry * entry * (3 - 2 * entry);
  }
  get state() {
    return { id: this.id, amount: this.amount.value };
  }

  configureShade(id: PigmentId, strength = 100, hue = 0) {
    id = validPigment(id);
    this.configure(id, 100);
    this.shadeStrength.value = Number.isFinite(strength)
      ? Math.max(0, Math.min(100, strength)) / 100
      : 1;
    this.shadeEnabled.value =
      id === 'rose' && !hue && this.shadeStrength.value === 1 ? 0 : 1;
    const shift = Number.isFinite(hue)
      ? Math.max(-45, Math.min(45, hue)) / 360
      : 0;
    shadeRecipes[id].forEach((hex, i) => {
      const c = new Color(hex).offsetHSL(shift, 0, 0);
      const carrier = Math.max(c.r, c.g, c.b);
      const a = new Vector3(
        ...[c.r, c.g, c.b].map((v) =>
          Math.max(0, -Math.log(Math.max(0.02, v) / carrier) / 1.18),
        ),
      );
      // Neutral optical density makes tea warm brown and lychee barely tinted,
      // while the density-zero white reflections remain unchanged.
      a.addScalar(
        id === 'tea' ? (i ? 0.21 : 0.13) : id === 'lychee' ? 0.015 : 0,
      );
      (i ? this.shadeDeep : this.shadeAbsorption).value.copy(a);
    });
  }

  tint(source: ReturnType<typeof vec3>) {
    // Recover an achromatic light carrier and optical density from the colored
    // response. Equal RGB channels have zero density: white/grey stays neutral.
    // Log/exp transports the capture's depth contrast into each new pigment.
    const carrier = source.r.max(source.g).max(source.b).max(0);
    const low = source.r.min(source.g).min(source.b).max(0);
    const density = carrier.add(0.00001).div(low.add(0.00001)).log();
    const dyed = carrier.mul(
      vec3(
        density.negate().mul(this.absorption.x).exp(),
        density.negate().mul(this.absorption.y).exp(),
        density.negate().mul(this.absorption.z).exp(),
      ),
    );
    const absorption = mix(
      this.shadeAbsorption,
      this.shadeDeep,
      density.smoothstep(1.1, 2.8).mul(0.5),
    );
    const d = density.negate().mul(this.shadeStrength);
    const recipe = carrier.mul(
      vec3(
        d.mul(absorption.x).exp(),
        d.mul(absorption.y).exp(),
        d.mul(absorption.z).exp(),
      ),
    );
    // Strength changes density, not hue. Neutral reflected cards stay neutral.
    return mix(mix(source, dyed, this.colorWeight), recipe, this.shadeEnabled);
  }
}
