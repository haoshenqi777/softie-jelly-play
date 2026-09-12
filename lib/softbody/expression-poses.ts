import type { ExpressionId } from './expression-settings.ts';

// World-space curve measurements; the approved natural face remains identity.
export const NEUTRAL_FACE = {
  lidL: 1,
  lidR: 1,
  lowerL: -1,
  lowerR: -1,
  slopeL: 0,
  slopeR: 0,
  lidCurveL: 0,
  lidCurveR: 0,
  closeL: 0,
  closeR: 0,
  arcL: -0.012,
  arcR: -0.012,
  widthL: 1,
  widthR: 1,
  heightL: 1,
  heightR: 1,
  liftL: 0,
  liftR: 0,
  pinch: 0,
  mouthSmile: 1,
  mouthWidth: 1,
  mouthOpen: 0,
  mouthRound: 1,
  mouthSkew: 0,
  mouthWave: 0,
  lookX: 0,
  lookY: 0,
};
export type FacePose = typeof NEUTRAL_FACE;
const pose = (p: Partial<FacePose>): FacePose => ({ ...NEUTRAL_FACE, ...p });
const POSES: Record<ExpressionId, FacePose> = {
  neutral: pose({}),
  peek: pose({ lidR: 0.65, lookX: -0.85, mouthWidth: 0.88, mouthSkew: 0.007 }),
  curious: pose({ heightL: 1.07, heightR: 1.02, mouthOpen: 0.6, lookY: 0.65 }),
  shy: pose({
    lidL: 0.15,
    lidR: 0.2,
    slopeL: 0.24,
    slopeR: -0.24,
    lidCurveL: 0.12,
    lidCurveR: 0.12,
    mouthSmile: 0.8,
    mouthWidth: 0.72,
    lookY: -0.65,
  }),
  giggle: pose({
    closeL: 1,
    lowerR: 0.12,
    arcL: 0.053,
    arcR: 0.042,
    mouthWidth: 0.85,
    mouthSmile: 1.12,
    mouthSkew: 0.012,
  }),
  happy: pose({
    closeL: 1,
    closeR: 1,
    arcL: 0.055,
    arcR: 0.055,
    widthL: 0.94,
    widthR: 0.94,
    mouthOpen: 1,
    mouthRound: 0,
  }),
  proud: pose({
    lidL: 0.15,
    lidR: 0.27,
    slopeL: -0.05,
    slopeR: 0.08,
    lidCurveL: 0.07,
    lidCurveR: 0.07,
    mouthWidth: 0.82,
    mouthSmile: 0.8,
    mouthSkew: 0.018,
    lookX: 0.2,
  }),
  content: pose({
    closeL: 1,
    closeR: 1,
    widthL: 0.88,
    widthR: 0.88,
    arcL: 0.032,
    arcR: 0.03,
    mouthWidth: 0.62,
    mouthSmile: 0.72,
  }),
  sad: pose({
    lidL: 0.25,
    lidR: 0.25,
    slopeL: 0.42,
    slopeR: -0.42,
    lidCurveL: -0.16,
    lidCurveR: -0.16,
    mouthSmile: -0.78,
    mouthWidth: 0.72,
  }),
  angry: pose({
    lidL: 0.13,
    lidR: 0.13,
    slopeL: -0.28,
    slopeR: 0.28,
    lidCurveL: 0.08,
    lidCurveR: 0.08,
    mouthSmile: -0.16,
    mouthWidth: 0.55,
    mouthWave: 0.011,
  }),
  soothed: pose({
    closeR: 1,
    arcL: 0.048,
    arcR: 0.048,
    mouthSmile: 1.1,
    mouthWidth: 0.8,
    mouthSkew: 0.009,
  }),
  surprised: pose({
    heightL: 1.1,
    heightR: 1.1,
    widthL: 1.035,
    widthR: 1.035,
    liftL: 0.006,
    liftR: 0.006,
    mouthOpen: 1,
  }),
  effort: pose({
    closeL: 1,
    closeR: 1,
    pinch: 1,
    mouthSmile: 0.08,
    mouthWidth: 0.6,
    mouthWave: 0.007,
  }),
  dizzy: pose({
    lidL: 0.1,
    lidR: 0.68,
    closeR: 0.22,
    liftL: -0.008,
    liftR: 0.015,
    arcR: -0.025,
    mouthSmile: -0.2,
    mouthWidth: 0.65,
    mouthWave: 0.009,
    lookX: 0.22,
  }),
  sleepy: pose({
    closeL: 1,
    closeR: 0.86,
    lidR: 0.2,
    arcL: -0.027,
    arcR: -0.023,
    mouthOpen: 0.34,
    mouthWidth: 0.6,
    lookY: -0.25,
  }),
  waking: pose({
    lidR: -0.1,
    closeR: 0.22,
    heightL: 1.06,
    mouthOpen: 0.85,
    lookY: 0.1,
  }),
};

export function sampleFace(
  id: ExpressionId,
  age: number,
  microMotion: boolean,
): FacePose {
  const p = { ...POSES[id] };
  if (!microMotion) return p;
  const t = Math.max(0, Number.isFinite(age) ? age : 0);
  // Small authored variations, not per-frame random noise.
  if (id === 'peek') p.lookX *= 0.7 + 0.3 * Math.cos(t * 1.7);
  if (id === 'shy') p.lookY += 0.16 * Math.sin(t * 1.6);
  if (id === 'giggle') {
    p.closeR += 0.15 * Math.sin(t * 3.4) ** 2;
    p.mouthSkew += 0.002 * Math.sin(t * 3.4);
  }
  if (id === 'happy') p.mouthOpen *= 0.93 + 0.07 * Math.cos(t * 4.2);
  if (id === 'sad') {
    p.lookY = -0.18 + 0.18 * Math.cos(t * 1.4);
    p.mouthSkew = 0.0015 * Math.sin(t * 5);
  }
  if (id === 'dizzy') {
    p.lookX += 0.2 * Math.sin(t * 3.1);
    p.lookY += 0.16 * Math.cos(t * 2.7);
  }
  if (id === 'sleepy') p.closeR = 0.91 + 0.05 * Math.sin(t * 1.1);
  return p;
}
