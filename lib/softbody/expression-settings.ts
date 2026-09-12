export const EXPRESSIONS = [
  {
    id: 'neutral',
    group: 'daily',
    label: '乖乖看你',
    hint: '安静地看着你，偶尔轻轻眨眼。',
  },
  {
    id: 'peek',
    group: 'daily',
    label: '偷偷瞄你',
    hint: '眼神先溜过去，停一会儿，再偷偷收回来。',
  },
  {
    id: 'curious',
    group: 'daily',
    label: '想要糖果',
    hint: '先盯住，再睁圆一点眼睛，小嘴慢半拍。',
  },
  {
    id: 'shy',
    group: 'daily',
    label: '害羞一下',
    hint: '眼皮轻轻垂下，藏着一点笑意。',
  },
  {
    id: 'giggle',
    group: 'daily',
    label: '憋不住笑',
    hint: '一只眼睛先弯起来，小嘴努力忍着。',
  },
  {
    id: 'happy',
    group: 'daily',
    label: '笑出声了',
    hint: '圆圆的笑眼，小小的笑声，慢慢收回。',
  },
  {
    id: 'proud',
    group: 'daily',
    label: '小小得意',
    hint: '抬起一点嘴角：是不是做得很好？',
  },
  {
    id: 'content',
    group: 'daily',
    label: '吃饱满足',
    hint: '眼睛慢慢合上，嘴角松松的，很安心。',
  },
  {
    id: 'sad',
    group: 'reaction',
    label: '有点委屈',
    hint: '眼角垂下去，停一会儿，又想看看你。',
  },
  {
    id: 'angry',
    group: 'reaction',
    label: '假装生气',
    hint: '嘴巴抿起来，圆眼睛藏在低低的眼皮下面。',
  },
  {
    id: 'soothed',
    group: 'reaction',
    label: '被哄好了',
    hint: '眼皮先松开，笑意晚一点才藏不住。',
  },
  {
    id: 'surprised',
    group: 'reaction',
    label: '吓了一跳',
    hint: '眼睛忽然睁圆，小嘴张开，随后松口气。',
  },
  {
    id: 'effort',
    group: 'reaction',
    label: '努力使劲',
    hint: '眼睛软软地挤紧，小嘴抿住。',
  },
  {
    id: 'dizzy',
    group: 'reaction',
    label: '晕乎乎',
    hint: '两只眼睛有点跟不上，小嘴也晃一下。',
  },
  {
    id: 'sleepy',
    group: 'reaction',
    label: '困得眯眼',
    hint: '一只眼皮先变重，另一只还想撑一会儿。',
  },
  {
    id: 'waking',
    group: 'reaction',
    label: '突然惊醒',
    hint: '一只眼睛醒了，另一只还没反应过来。',
  },
] as const;
export type ExpressionId = (typeof EXPRESSIONS)[number]['id'];
export type ExpressionSettings = {
  expression: ExpressionId;
  intensity: number;
  speed: number;
  autoBlink: boolean;
  gaze: boolean;
  sequence: boolean;
  responsive: boolean;
  microMotion: boolean;
};
export const DEFAULT_EXPRESSION: ExpressionSettings = {
  expression: 'neutral',
  intensity: 100,
  speed: 50,
  autoBlink: true,
  gaze: true,
  sequence: false,
  responsive: true,
  microMotion: true,
};

export const EXPRESSION_STORAGE_KEY = 'softie.expression.v1';
export function normalizeExpression(
  values: unknown,
  base = DEFAULT_EXPRESSION,
): ExpressionSettings {
  const next = { ...base };
  if (!values || typeof values !== 'object' || Array.isArray(values))
    return next;
  const input = values as Record<string, unknown>;
  if (EXPRESSIONS.some((e) => e.id === input.expression)) {
    next.expression = input.expression as ExpressionId;
    next.responsive = false;
    next.sequence = false;
  }
  for (const key of ['intensity', 'speed'] as const)
    if (typeof input[key] === 'number' && Number.isFinite(input[key]))
      next[key] = Math.max(0, Math.min(100, input[key]));
  for (const key of [
    'autoBlink',
    'gaze',
    'sequence',
    'responsive',
    'microMotion',
  ] as const)
    if (typeof input[key] === 'boolean') next[key] = input[key];
  if (input.sequence === true) next.responsive = false;
  else if (input.responsive === true) next.sequence = false;
  return next;
}
export function parseSavedExpression(
  raw: string | null,
): ExpressionSettings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      parsed.version !== 1 ||
      !parsed.values ||
      typeof parsed.values !== 'object' ||
      Array.isArray(parsed.values)
    )
      return null;
    return { ...normalizeExpression(parsed.values), sequence: false };
  } catch {
    return null;
  }
}
