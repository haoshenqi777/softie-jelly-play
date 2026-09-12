export type Point3 = [number, number, number];
export const ABSORPTION_DURATION = 12;
export const ABSORPTION_STAGES = [
  {
    id: 'contact',
    label: '贴住 · 包裹',
    time: 1.65,
    description: '接触处让开一点，周围的凝胶慢慢合拢。',
  },
  {
    id: 'inside',
    label: '留在里面',
    time: 3.8,
    description: '糖还完整地留着，隔着身体轻轻晃。',
  },
  {
    id: 'dissolve',
    label: '慢慢融化',
    time: 6.7,
    description: '先融掉棱角，一点薄荷色从这里散开。',
  },
  {
    id: 'finish',
    label: '成为它的颜色',
    time: 12,
    description: '甜味散开，身体恢复原来的轮廓。',
  },
] as const;
export const smoothRange = (a: number, b: number, v: number) => {
  const x = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
export type AbsorptionFrame = ReturnType<typeof absorptionFrame>;
export function absorptionFrame(seconds: number) {
  const t = Number.isFinite(seconds) ? Math.min(12, Math.max(0, seconds)) : 0;
  const entry = smoothRange(0.85, 3.3, t);
  const wrap = smoothRange(0.25, 1.5, t) * (1 - smoothRange(1.7, 3.6, t));
  const settle =
    t > 3.3
      ? Math.sin((t - 3.3) * 7) *
        Math.exp(-(t - 3.3) * 2.2) *
        (1 - smoothRange(5, 6, t))
      : 0;
  return {
    time: t,
    wrap,
    settle,
    entry,
    dissolve: smoothRange(4.6, 9.6, t),
    dye: smoothRange(4.9, 12, t),
    candy: [
      -0.7 + entry * 0.18,
      0.15 + entry * 0.31 + settle * 0.025,
      1.64 - entry * 0.98,
    ] as Point3,
  };
}

/** A bounded lookdev envelope. All inputs are original material coordinates.
 * The motor/contact solver will drive these weights when integrated in play. */
export function deformAbsorptionPoint(
  p: readonly number[],
  f: AbsorptionFrame,
  out: Point3 = [0, 0, 0],
): Point3 {
  const [x, y, z] = p;
  if (f.wrap === 0 && f.settle === 0) {
    out[0] = x;
    out[1] = y;
    out[2] = z;
    return out;
  }
  const dx = (x + 0.7) / 0.43;
  const dy = (y - 0.21) / 0.31;
  const r2 = dx * dx + dy * dy;
  const front = smoothRange(0.65, 1.2, z);
  const center = Math.exp(-r2 * 2.4);
  const collar = Math.exp(-Math.pow(Math.sqrt(r2) - 0.95, 2) * 4);
  const support = 1 - Math.exp(-y * 25);
  const w = f.wrap * front * (1 - smoothRange(0.3, 0.49, y));
  // The center yields, the adjacent surface reaches over the candy. A smooth
  // falloff makes one continuous skin and leaves the approved crown at rest.
  out[0] = x - dx * Math.exp(-r2 * 1.1) * w * 0.04;
  out[1] = y + collar * w * 0.075 * support;
  out[2] = z + (collar * 0.25 - center * 0.12) * w;
  const rebound = f.settle * 0.012 * smoothRange(0.6, 2.3, y);
  out[0] += rebound;
  return out;
}

export class AbsorptionTimeline {
  private seconds = 0;
  playing = false;
  speed = 1;
  get frame() {
    return absorptionFrame(this.seconds);
  }
  configure(v: { time?: number; playing?: boolean; speed?: number }) {
    if (v.time !== undefined) this.seconds = absorptionFrame(v.time).time;
    if (v.playing !== undefined) this.playing = v.playing;
    if (v.speed !== undefined && Number.isFinite(v.speed))
      this.speed = Math.min(1, Math.max(0.1, v.speed));
  }
  update(dt: number) {
    if (this.playing && Number.isFinite(dt))
      this.seconds = Math.min(
        12,
        this.seconds + Math.min(0.1, Math.max(0, dt)) * this.speed,
      );
    if (this.seconds >= 12) this.playing = false;
    return this.frame;
  }
}
