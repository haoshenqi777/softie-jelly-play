import type { ExpressionId } from './expression-settings.ts';

export type EmotionEvent =
  | 'touch'
  | 'poke'
  | 'stroke'
  | 'stretch'
  | 'release'
  | 'land'
  | 'food'
  | 'withdraw'
  | 'fed'
  | 'stumble'
  | 'righting'
  | 'recovered'
  | 'recovery-cancel'
  | 'sleep';

type Beat = { id: ExpressionId; duration: number; strength: number };
const EPSILON = 1e-9;
const SLEEP_AFTER = 32;
const STROKE_GAP = 0.5;
const RIGHTING_HEARTBEAT_GAP = 0.6;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Pure reaction timing; the expression rig owns interpolation and geometry. */
export class EmotionDirector {
  private id: ExpressionId = 'neutral';
  private strength = 1;
  private age = 0;
  private heat = 0;
  private idle = 0;
  private nextPeek = 8;
  private timeline: Beat[] = [];
  private remaining = 0;
  private hold: 'stretch' | 'stroke' | 'righting' | null = null;
  private recoveryOwned = false;
  get recovering() {
    return this.recoveryOwned;
  }
  private rightingRemaining = 0;
  private strokeSeconds = 0;
  private strokeQuiet = 1;
  private needsSoothing = false;
  private soothing = false;
  private landingCooldown = 0;
  private withdrawals = 0;

  /** Observed attention keeps idle sleep away without restarting reactions. */
  attend() {
    this.idle = 0;
    this.nextPeek = 8;
    // Sleep is a durable idle state, unlike a timed direct-input reaction.
    if (this.id === 'sleepy' && !this.hold && !this.timeline.length) {
      this.id = 'neutral';
      this.age = 0;
      this.strength = 1;
    }
  }

  reset(): void {
    this.id = 'neutral';
    this.strength = 1;
    this.age = 0;
    this.heat = 0;
    this.idle = 0;
    this.nextPeek = 8;
    this.timeline = [];
    this.remaining = 0;
    this.hold = null;
    this.recoveryOwned = false;
    this.rightingRemaining = 0;
    this.landingCooldown = 0;
    this.withdrawals = 0;
    this.clearStroke();
  }

  frame(): {
    id: ExpressionId;
    strength: number;
    age: number;
    heat: number;
    idle: number;
  } {
    return {
      id: this.id,
      strength: this.strength,
      age: this.age,
      heat: this.heat,
      idle: this.idle,
    };
  }

  update(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let left = Math.min(0.1, dt);
    // Split at performance boundaries so a 30 Hz frame and a 120 Hz frame
    // carry the same leftover time into the next expression.
    while (left > 0) {
      this.finishDue();
      let step = left;
      if (this.timeline.length) step = Math.min(step, this.remaining);
      if (this.hold === 'stroke')
        step = Math.min(step, STROKE_GAP - this.strokeQuiet);
      if (this.hold === 'righting')
        step = Math.min(step, this.rightingRemaining);
      if (!this.hold && !this.timeline.length && this.id === 'neutral') {
        step = Math.min(
          step,
          SLEEP_AFTER - this.idle,
          this.nextPeek - this.idle,
        );
      }
      this.age += step;
      if (this.hold !== 'stretch' && this.hold !== 'righting')
        this.idle += step;
      if (this.hold === 'righting') this.rightingRemaining -= step;
      this.heat = Math.max(0, this.heat - step * 0.04);
      this.landingCooldown = Math.max(0, this.landingCooldown - step);
      this.strokeQuiet += step;
      if (this.timeline.length) this.remaining -= step;
      left -= step;
    }
    this.finishDue();
    if (this.strokeQuiet >= 0.8 && !this.soothing && this.hold !== 'stroke') {
      this.strokeSeconds = 0;
      this.needsSoothing = false;
    }
    if (this.idle >= 12) this.withdrawals = 0;
  }

  /** stroke: gentle-motion seconds; stretch/righting: 0..1 strength;
   * stumble: 0..1 tilt severity (sideways to upside-down).
   * righting must be refreshed within 0.6 seconds while physically active.
   */
  notify(event: EmotionEvent, amount?: number): void {
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0))
      return;
    if (event === 'recovery-cancel') {
      this.clearRecovery();
      return;
    }
    if (
      event === 'land' &&
      (this.hold === 'righting' ||
        (amount ?? 0) <= 1.2 ||
        this.landingCooldown > EPSILON)
    )
      return;
    if (event === 'stroke' && (amount ?? 0.1) <= 0) return;

    if (
      event === 'touch' ||
      event === 'poke' ||
      event === 'stroke' ||
      event === 'stretch'
    )
      this.clearRecovery();

    this.idle = 0;
    this.nextPeek = 8;
    if (
      this.id === 'sleepy' &&
      (event === 'touch' || event === 'poke' || event === 'stroke')
    ) {
      this.clearStroke();
      this.play({ id: 'waking', duration: 1.2, strength: 1 });
      return;
    }
    // Pointer-up emits release then poke. Neither should erase the waking
    // expression begun by pointer-down a fraction of a second earlier.
    if (
      this.id === 'waking' &&
      (event === 'touch' ||
        event === 'release' ||
        event === 'poke' ||
        event === 'stroke')
    )
      return;

    switch (event) {
      case 'stumble':
        this.clearStroke();
        this.play(
          clamp(amount ?? 0) >= 0.65
            ? { id: 'dizzy', duration: 0.7, strength: 0.85 }
            : { id: 'surprised', duration: 0.35, strength: 0.75 },
          { id: 'peek', duration: 0.6, strength: 0.8 },
        );
        this.recoveryOwned = true;
        break;
      case 'righting':
        this.clearStroke();
        this.timeline = [];
        this.remaining = 0;
        this.hold = 'righting';
        this.recoveryOwned = true;
        this.rightingRemaining = RIGHTING_HEARTBEAT_GAP;
        this.set('effort', 0.5 + 0.5 * clamp(amount ?? 1));
        break;
      case 'recovered':
        this.clearStroke();
        this.play(
          { id: 'soothed', duration: 0.75, strength: 0.85 },
          { id: 'proud', duration: 1.1, strength: 0.8 },
        );
        this.recoveryOwned = true;
        break;
      case 'touch':
        if (this.id === 'neutral' || this.id === 'peek') {
          this.play({ id: 'shy', duration: 0.8, strength: 0.65 });
        }
        break;
      case 'poke': {
        this.clearStroke();
        this.heat = clamp(this.heat + 0.31 * clamp(amount ?? 1));
        if (this.heat >= 0.78) {
          this.play(
            { id: 'angry', duration: 2.1, strength: 0.7 + 0.3 * this.heat },
            { id: 'sad', duration: 1.1, strength: 0.55 },
          );
        } else {
          this.play(
            { id: 'surprised', duration: 0.42, strength: 0.8 },
            { id: 'effort', duration: 0.22, strength: 0.45 },
          );
        }
        break;
      }
      case 'stroke':
        this.stroke(Math.min(amount ?? 0.1, 2));
        break;
      case 'stretch':
        if ((amount ?? 0) <= 0) {
          this.release();
          break;
        }
        this.clearStroke();
        this.timeline = [];
        this.hold = 'stretch';
        this.set('effort', 0.5 + 0.5 * clamp(amount ?? 0));
        break;
      case 'release':
        this.release();
        break;
      case 'land':
        this.clearStroke();
        this.landingCooldown = 1.2;
        this.play(
          (amount ?? 0) > 3
            ? { id: 'dizzy', duration: 1.5, strength: 0.9 }
            : { id: 'surprised', duration: 0.65, strength: 0.7 },
        );
        break;
      case 'food':
        this.clearStroke();
        this.play({ id: 'curious', duration: 3, strength: 0.9 });
        break;
      case 'withdraw':
        this.clearStroke();
        this.withdrawals = Math.min(3, this.withdrawals + 1);
        if (this.withdrawals >= 2) {
          this.heat = clamp(this.heat + 0.4);
          this.play({ id: 'angry', duration: 2, strength: 0.8 });
        } else this.play({ id: 'sad', duration: 2.4, strength: 0.85 });
        break;
      case 'fed':
        this.clearStroke();
        this.heat *= 0.25;
        this.withdrawals = 0;
        this.play(
          { id: 'proud', duration: 1.2, strength: 0.85 },
          { id: 'content', duration: 2.6, strength: 0.9 },
        );
        break;
      case 'sleep':
        this.clearStroke();
        this.recoveryOwned = false;
        this.timeline = [];
        this.hold = null;
        this.set('sleepy', 1);
        break;
    }
  }

  private stroke(seconds: number): void {
    if (this.hold === 'stretch') return;
    this.strokeSeconds = Math.min(8, this.strokeSeconds + seconds);
    this.strokeQuiet = 0;
    if (this.soothing) {
      this.heat = Math.max(0, this.heat - seconds * 0.65);
      return;
    }
    this.needsSoothing ||=
      this.id === 'angry' || this.id === 'sad' || this.heat >= 0.65;
    if (this.needsSoothing) {
      if (this.strokeSeconds + EPSILON < 0.35) return;
      this.soothing = true;
      const extraComfort = Math.max(0, this.strokeSeconds - 0.35);
      this.heat = Math.max(0, this.heat - 0.4 - extraComfort * 0.65);
      this.play(
        { id: 'soothed', duration: 1.15, strength: 0.9 },
        { id: 'content', duration: 2.6, strength: 0.8 },
      );
      return;
    }
    if (this.strokeSeconds + EPSILON < 0.18) return;
    const id =
      this.strokeSeconds >= 1.9
        ? 'content'
        : this.strokeSeconds >= 0.85
          ? 'happy'
          : 'giggle';
    this.timeline = [];
    this.hold = 'stroke';
    this.set(id, id === 'giggle' ? 0.7 : 0.85);
  }

  private release(): void {
    if (this.hold === 'righting') return;
    if (this.hold === 'stretch' || this.id === 'effort') {
      this.timeline = [];
      this.hold = null;
      this.set('neutral', 1);
    } else if (this.hold === 'stroke') {
      this.settleStroke();
    }
  }

  private clearRecovery(): void {
    if (!this.recoveryOwned) return;
    this.recoveryOwned = false;
    this.rightingRemaining = 0;
    this.timeline = [];
    this.remaining = 0;
    this.hold = null;
    this.set('neutral', 1);
  }

  private clearStroke(): void {
    this.strokeSeconds = 0;
    this.strokeQuiet = 1;
    this.needsSoothing = false;
    this.soothing = false;
  }

  private settleStroke(): void {
    const id = this.id === 'giggle' ? 'giggle' : 'content';
    this.clearStroke();
    this.play({ id, duration: id === 'giggle' ? 0.6 : 1.8, strength: 0.75 });
  }

  private set(id: ExpressionId, strength: number): void {
    if (id !== this.id) this.age = 0;
    this.id = id;
    this.strength = clamp(strength);
  }

  private play(...beats: Beat[]): void {
    this.recoveryOwned = false;
    this.rightingRemaining = 0;
    this.hold = null;
    this.timeline = beats;
    this.remaining = beats[0].duration;
    this.set(beats[0].id, beats[0].strength);
  }

  private finishDue(): void {
    if (this.hold === 'righting' && this.rightingRemaining <= EPSILON)
      this.clearRecovery();
    if (this.timeline.length && this.remaining <= EPSILON) {
      this.timeline.shift();
      if (this.timeline.length) {
        this.remaining = this.timeline[0].duration;
        this.set(this.timeline[0].id, this.timeline[0].strength);
      } else if (this.soothing && this.strokeQuiet < STROKE_GAP) {
        this.hold = 'stroke';
        this.set('content', 0.8);
      } else {
        this.recoveryOwned = false;
        this.soothing = false;
        this.set('neutral', 1);
      }
    }
    if (this.hold === 'stroke' && this.strokeQuiet + EPSILON >= STROKE_GAP)
      this.settleStroke();
    if (!this.hold && !this.timeline.length && this.id !== 'sleepy') {
      if (this.idle + EPSILON >= SLEEP_AFTER) this.set('sleepy', 1);
      else if (this.idle + EPSILON >= this.nextPeek) {
        this.nextPeek += 12;
        this.play({ id: 'peek', duration: 1.15, strength: 0.6 });
      }
    }
  }
}
