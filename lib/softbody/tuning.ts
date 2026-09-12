export const FEEL_CONTROLS = [
  {
    key: 'stiffness',
    group: '身体',
    label: '软硬',
    low: '柔软',
    high: '有支撑',
    hint: '按下、拉伸时，身体抵抗变形的力度。',
  },
  {
    key: 'damping',
    group: '身体',
    label: '黏弹阻尼',
    low: '晃得久',
    high: '收得快',
    hint: '控制变形后余晃的消退速度。',
  },
  {
    key: 'crown',
    group: '身体',
    label: '顶部柔软度',
    low: '跟随身体',
    high: '更软更弹',
    hint: '只调顶部到肩部的柔软渐变，不改变静态造型。',
  },
  {
    key: 'crownRange',
    group: '身体',
    label: '顶部柔软范围',
    low: '只在头顶',
    high: '延伸到肩部',
    hint: '控制柔软区域向下延伸多少；柔软程度由上一项单独控制。',
  },
  {
    key: 'grip',
    group: '触摸',
    label: '抓取力度',
    low: '轻轻牵引',
    high: '紧跟手指',
    hint: '控制身体跟随手指的紧密程度。',
  },
  {
    key: 'radius',
    group: '触摸',
    label: '触碰范围',
    low: '局部捏起',
    high: '带动一片',
    hint: '改变抓取影响的范围，重新抓取时生效。',
  },
  {
    key: 'press',
    group: '触摸',
    label: '按压深度',
    low: '轻戳',
    high: '深揉',
    hint: '控制点击身体和「戳一下」的下压幅度。',
  },
  {
    key: 'gravity',
    group: '运动',
    label: '重力感',
    low: '轻盈',
    high: '沉甸甸',
    hint: '改变下落加速度，也会影响站立时的自然下压。',
  },
  {
    key: 'jump',
    group: '运动',
    label: '跳跃高度',
    low: '小跳',
    high: '跳得高',
    hint: '控制「试跳一下」的高度，独立于重力调节。',
  },
  {
    key: 'bounce',
    group: '运动',
    label: '落地回弹',
    low: '软着陆',
    high: '再弹一下',
    hint: '控制碰到桌面后的回弹；身体自身仍有弹性。',
  },
  {
    key: 'friction',
    group: '运动',
    label: '桌面摩擦',
    low: '滑溜溜',
    high: '稳稳停住',
    hint: '控制落地后横向滑动多久。',
  },
] as const;
export type FeelKey = (typeof FEEL_CONTROLS)[number]['key'];
export type FeelTuning = Record<FeelKey, number>;
export const DEFAULT_FEEL: Readonly<FeelTuning> = Object.freeze({
  stiffness: 50,
  damping: 50,
  crown: 50,
  crownRange: 50,
  grip: 50,
  radius: 50,
  press: 50,
  gravity: 50,
  jump: 50,
  bounce: 0,
  friction: 50,
});
export const FEEL_PRESETS = [
  { name: '原版手感', values: DEFAULT_FEEL },
  {
    name: '软糯布丁',
    values: {
      ...DEFAULT_FEEL,
      stiffness: 25,
      damping: 72,
      crown: 75,
      grip: 42,
      radius: 65,
      press: 55,
      gravity: 55,
      jump: 30,
      bounce: 8,
      friction: 70,
    },
  },
  {
    name: '弹弹果冻',
    values: {
      ...DEFAULT_FEEL,
      stiffness: 55,
      damping: 25,
      crown: 58,
      grip: 65,
      radius: 45,
      press: 45,
      gravity: 45,
      jump: 62,
      bounce: 35,
      friction: 40,
    },
  },
] as const;
export function normalizeFeel(
  input: unknown,
  base: Readonly<FeelTuning> = DEFAULT_FEEL,
): FeelTuning {
  const result = { ...base };
  if (!input || typeof input !== 'object') return result;
  const record = input as Record<string, unknown>;
  for (const { key } of FEEL_CONTROLS) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value))
      result[key] = Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
  }
  return result;
}
export function physicalFeel(input: Readonly<FeelTuning>) {
  const t = normalizeFeel(input);
  return {
    shear: 240 * 2.5 ** ((t.stiffness - 50) / 50),
    damping: 12 * 4 ** ((t.damping - 50) / 50),
    crownSoftness: 0.2 + (0.7 * t.crown) / 100,
    crownSpan: 0.15 + (0.4 * t.crownRange) / 100,
    gripStrength: 70000 * 4 ** ((t.grip - 50) / 50),
    gripRadius: 0.58 * 1.5 ** ((t.radius - 50) / 50),
    pressDepth: 0.18 + (0.48 * t.press) / 100,
    gravity: 5 * 2 ** ((t.gravity - 50) / 50),
    jumpHeight: 1.156 * 2 ** ((t.jump - 50) / 50),
    restitution: (0.8 * t.bounce) / 100,
    friction: 10 * 4 ** ((t.friction - 50) / 50),
  };
}
export type SupportVariant = 'original' | 'support' | 'crown';

/** Compare from one immutable starting point, never from the previous trial. */
export function supportVariants(
  input: Readonly<FeelTuning>,
): Record<SupportVariant, FeelTuning> {
  const original = normalizeFeel(input);
  const support = normalizeFeel(
    { stiffness: original.stiffness + 24 },
    original,
  );
  const crown = normalizeFeel(
    { crownRange: Math.min(original.crownRange, 17.5) },
    support,
  );
  return { original, support, crown };
}
export const FEEL_STORAGE_KEY = 'softie.feel.v1';
export function parseSavedFeel(text: string | null): FeelTuning | null {
  if (!text) return null;
  try {
    const saved = JSON.parse(text);
    if (
      saved?.version !== 1 ||
      !saved.values ||
      typeof saved.values !== 'object'
    )
      return null;
    return normalizeFeel(saved.values);
  } catch {
    return null;
  }
}
