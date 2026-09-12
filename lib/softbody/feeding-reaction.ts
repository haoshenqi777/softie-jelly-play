import type { IntakeStage } from '../contact-intake.ts';
import type { FacePose } from './expression-poses.ts';
import type { ExpressionId } from './expression-settings.ts';

export type FeedingSignal = {
  id: number | null;
  stage: IntakeStage;
  held: boolean;
  pressure: number;
  withdrawing: boolean;
  wrap: number;
  diffusionAge: number;
};
export type FeedingPerformance = {
  active: boolean;
  id: number | null;
  stage: IntakeStage;
  beat:
    | 'none'
    | 'contact'
    | 'effort'
    | 'seal'
    | 'enclose'
    | 'savor'
    | 'rest'
    | 'finish'
    | 'afterglow'
    | 'withdraw';
  age: number;
  face: ExpressionId;
  strength: number;
  pose: Partial<FacePose>;
  gazeX: number;
  gazeY: number;
  track: boolean;
  stretch: number;
  bend: number;
  crown: number;
  lateral: boolean;
};
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => {
  const u = clamp(x);
  return u * u * (3 - 2 * u);
};
// Finite gestures with zero velocity at both ends and quiet gaps between them.
const pulse = (t: number, start: number, length: number) =>
  t <= start || t >= start + length
    ? 0
    : Math.sin((Math.PI * (t - start)) / length) ** 2;
const empty = (): FeedingPerformance => ({
  active: false,
  id: null,
  stage: 'idle',
  beat: 'none',
  age: 0,
  face: 'neutral',
  strength: 0,
  pose: {},
  gazeX: 0,
  gazeY: 0,
  track: false,
  stretch: 0,
  bend: 0,
  crown: 0,
  lateral: false,
});

/** One fixed-step clock follows observed intake, never advances the candy.
 * The expression rig and physical gesture motor consume the same performance. */
export class FeedingReaction {
  private id: number | null = null;
  private stage: IntakeStage = 'idle';
  private age = 0;
  private pressure = 0;
  private enclosed = false;
  private satisfied = false;
  private finished = false;
  private interrupted = false;
  private gazeX = 0;
  private gazeY = 0;
  private output = empty();
  frame() {
    return this.output;
  }
  reset() {
    this.id = null;
    this.stage = 'idle';
    this.age = this.pressure = 0;
    this.gazeX = this.gazeY = 0;
    this.enclosed = this.finished = this.interrupted = false;
    this.satisfied = false;
    this.output = empty();
  }
  interrupt() {
    if (this.stage === 'settling' || this.stage === 'done')
      this.interrupted = true;
  }
  step(
    dt: number,
    signal: FeedingSignal | null,
    contact?: { x: number; y: number; z: number },
  ) {
    if (!Number.isFinite(dt) || dt <= 0) return this.output;
    dt = Math.min(0.1, dt);
    if (!signal || signal.id === null || signal.stage === 'idle') {
      if (this.id !== null) this.reset();
      return this.output;
    }
    if (signal.id !== this.id) {
      this.reset();
      this.id = signal.id;
      if (contact) {
        this.gazeX = Math.max(-1, Math.min(1, contact.x / 0.95));
        this.gazeY = Math.max(-0.8, Math.min(0.9, (contact.y - 0.6) / 1.2));
      }
    }
    if (signal.stage !== this.stage) {
      this.stage = signal.stage;
      this.age = 0;
    }
    this.age += dt;
    const f = empty();
    f.id = this.id;
    f.stage = this.stage;
    f.age = this.age;
    if (this.finished || this.interrupted) return (this.output = f);
    if (this.stage === 'done' && !this.enclosed) return (this.output = f);
    f.active = true;
    f.strength = 1;
    const target = signal.held
      ? clamp(signal.pressure / 100)
      : ['wrapping', 'entering'].includes(this.stage)
        ? 0.5
        : 0;
    this.pressure += (target - this.pressure) * (1 - Math.exp(-dt * 9));
    if (signal.withdrawing) {
      f.beat = 'withdraw';
      f.face = 'angry';
      f.strength = 0.85;
      f.pose = { mouthWidth: 0.62, mouthSmile: -0.3, lidL: 0.5, lidR: 0.5 };
      return (this.output = f);
    }
    if (['pressing', 'wrapping', 'entering', 'sealing'].includes(this.stage)) {
      const effort = ease((this.pressure - 0.15) / 0.6);
      f.beat = effort > 0.38 ? 'effort' : 'contact';
      f.face = effort > 0.38 ? 'effort' : 'curious';
      f.pose = {
        heightL: 1.04,
        heightR: 1.02,
        closeL: 0.9 * effort,
        closeR: 0.92 * effort,
        pinch: 0.8 * effort,
        mouthOpen: 0.38 * (1 - effort),
        mouthSmile: 1 - 0.6 * effort,
        mouthWidth: 0.88 - 0.22 * effort,
        mouthWave: 0.004 * effort,
        lookX: 0,
        lookY: 0,
      };
      f.track = true;
      f.gazeX = this.gazeX * (1 - 0.55 * effort);
      f.gazeY = this.gazeY;
      f.lateral = true;
      // Local contact owns deformation; expressions must not push the body.
      if (this.stage === 'sealing' && !signal.held) {
        f.beat = 'seal';
        f.face = 'shy';
        f.strength = 0.62;
        f.pose = { lookX: 0, lookY: 0, mouthWidth: 0.8 };
      }
    } else if (this.stage === 'inside') {
      this.enclosed = true;
      const settle = pulse(this.age, 0.08, 0.9);
      f.beat = 'enclose';
      f.face = 'content';
      f.pose = {
        closeL: 0.9,
        closeR: 0.84,
        mouthWidth: 0.74,
        mouthSmile: 0.95,
      };
      f.stretch =
        -0.02 * pulse(this.age, 0, 0.3) + 0.055 * pulse(this.age, 0.24, 0.8);
      f.crown = 0.075 * pulse(this.age, 0.36, 0.85);
      f.bend = 0.028 * settle;
    } else if (this.stage === 'dissolving') {
      this.enclosed = true;
      const t = Math.max(0, signal.diffusionAge);
      const savor = pulse(t, 0.65, 1.25) + 0.72 * pulse(t, 3.7, 1.25);
      f.beat = savor > 0.12 ? 'savor' : 'rest';
      f.face = savor > 0.12 ? 'content' : 'soothed';
      f.pose = {
        closeL: 0.9 * savor,
        closeR: 0.85 * savor,
        arcL: 0.037,
        arcR: 0.034,
        mouthWidth: 0.94 - 0.22 * savor,
        mouthSmile: 1 + 0.05 * savor,
        mouthOpen: 0,
      };
      f.stretch = 0.045 * savor;
      f.bend = 0.035 * (pulse(t, 0.65, 1.25) - 0.72 * pulse(t, 3.7, 1.25));
      f.lateral = true;
      f.crown = 0.07 * (pulse(t, 0.83, 1.3) + 0.72 * pulse(t, 3.88, 1.3));
    } else if (this.stage === 'settling') {
      // The visible sugar has just gone. Respond NOW; colour diffusion keeps
      // running for another 5.25 seconds and must not delay satisfaction.
      this.enclosed = true;
      this.satisfied = true;
      const t = this.age;
      const joy = pulse(t, 0.08, 1.25);
      const lookBack = pulse(t, 1.55, 1.2);
      f.beat = t < 1.5 ? 'finish' : 'afterglow';
      f.face = t < 1.5 ? 'content' : t < 3 ? 'proud' : 'soothed';
      f.pose = {
        mouthOpen: 0,
        mouthSmile: 1.15,
        mouthWidth: 0.88,
        ...(t < 1.5
          ? { closeL: 0.98, closeR: 0.94, arcL: 0.048, arcR: 0.046 }
          : t < 3
            ? { closeL: 0.06, closeR: 0.96, arcR: 0.042, mouthSkew: 0.012 }
            : {}),
      };
      f.stretch = -0.025 * pulse(t, 0, 0.28) + 0.065 * joy;
      f.crown = 0.095 * pulse(t, 0.22, 1.35);
      f.bend = 0.04 * joy - 0.03 * lookBack;
      f.lateral = true;
    } else if (this.stage === 'done') {
      if (this.age >= 3.4) {
        this.finished = true;
        f.active = false;
        return (this.output = f);
      }
      if (this.satisfied) {
        f.beat = 'afterglow';
        f.face = 'soothed';
        f.strength = 1 - ease(this.age / 3.4);
        return (this.output = f);
      }
      const joy = pulse(this.age, 0.1, 0.85);
      f.beat = this.age < 1.15 ? 'finish' : 'afterglow';
      f.face =
        this.age < 1.15 ? 'content' : this.age < 2.4 ? 'proud' : 'soothed';
      f.strength = 1 - ease((this.age - 1.6) / 1.8);
      f.pose = {
        mouthOpen: 0,
        mouthWidth: 0.8,
        mouthSmile: 1.12,
        ...(this.age > 1.2 && this.age < 2.3
          ? { closeL: 0.08, closeR: 0.95, arcR: 0.038, mouthSkew: 0.01 }
          : {}),
      };
      f.stretch = -0.008 * pulse(this.age, 0, 0.28) + 0.018 * joy;
      f.crown = 0.025 * pulse(this.age, 0.28, 1.05);
      f.bend = 0.008 * joy;
    }
    return (this.output = f);
  }
}
