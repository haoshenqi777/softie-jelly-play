const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
export type FoodPhase =
  | 'idle'
  | 'offered'
  | 'catching'
  | 'chewing'
  | 'swallowing'
  | 'spreading'
  | 'savoring';
export const MEAL = {
  bite: 0.65,
  chewEnd: 2.75,
  swallowEnd: 3.45,
  spreadEnd: 5.25,
  end: 6.1,
};
export type SlimeMood =
  | 'calm'
  | 'pleased'
  | 'grumpy'
  | 'curious'
  | 'eating'
  | 'full'
  | 'sleepy'
  | 'asleep'
  | 'disappointed';

// Gesture intent and little emotional memories are independent of frame rate,
// rendering, and the spring solver. A drag never counts as a rapid poke.
export class SlimeCharacter {
  affection = 0;
  annoyance = 0;
  comfort = 0;
  grump = 0;
  lean = 0;
  foodNear = false;
  offered = false;
  mealAge = -1;
  fullness = 0;
  puff = 0;
  disappointment = 0;
  sleep = 0;
  wakeAge = 0;
  dizzy = 0;
  refused = 0;
  private sated = false;
  private idleAge = 0;
  private foodNotice = 0;
  private withdrawCooldown = 0;
  private digestionAge = 0;
  private mealCounted = false;
  private absorbing = false;
  private tapHeat = 0;
  private lastSide = 1;
  private emotionTime = 0;
  private touchLean = 0;
  surprise = 0;
  get pokeSide() {
    return this.lastSide;
  }
  get busy() {
    return this.mealAge >= 0;
  }
  get isFull() {
    return this.sated;
  }
  wake() {
    if (this.sleep > 0.35) {
      this.wakeAge = 1.1;
      this.surprise = 0.8;
    }
    this.idleAge = 0;
  }
  refuse() {
    this.refused = 1;
    this.wake();
  }
  land(strength: number) {
    if (strength > 3) {
      this.dizzy = 1;
      this.wake();
    }
  }
  get phase(): FoodPhase {
    if (this.mealAge < 0) return this.offered ? 'offered' : 'idle';
    return this.mealAge < MEAL.bite
      ? 'catching'
      : this.mealAge < MEAL.chewEnd
        ? 'chewing'
        : this.mealAge < MEAL.swallowEnd
          ? 'swallowing'
          : this.mealAge < MEAL.spreadEnd
            ? 'spreading'
            : 'savoring';
  }
  get spread() {
    return this.mealAge < 0
      ? 1
      : clamp(
          (this.mealAge - MEAL.swallowEnd) / (MEAL.spreadEnd - MEAL.swallowEnd),
        );
  }
  get chew() {
    return this.phase === 'chewing'
      ? Math.sin(((this.mealAge - MEAL.bite) / 0.7) * Math.PI) ** 2
      : 0;
  }
  get chewSide() {
    return this.phase === 'chewing'
      ? (Math.floor((this.mealAge - MEAL.bite) / 0.7) % 2 === 0 ? -1 : 1) *
          this.chew
      : 0;
  }
  get swallow() {
    return this.phase === 'swallowing'
      ? Math.sin(clamp((this.mealAge - MEAL.chewEnd) / 0.7) * Math.PI)
      : 0;
  }
  get appetite() {
    if (this.isFull) return 0;
    return this.phase === 'catching' || (this.offered && this.foodNear) ? 1 : 0;
  }
  get mood(): SlimeMood {
    if (this.sleep > 0.94) return 'asleep';
    if (this.sleep > 0.25) return 'sleepy';
    if (this.disappointment > 0.4) return 'disappointed';
    if (this.phase === 'catching' || (this.offered && this.foodNear))
      return 'curious';
    if (this.phase === 'chewing' || this.phase === 'swallowing')
      return 'eating';
    if (this.phase === 'spreading' || this.phase === 'savoring')
      return 'pleased';
    if (this.annoyance > 0.52) return 'grumpy';
    if (this.isFull) return 'full';
    return this.affection > 0.3 ? 'pleased' : 'calm';
  }
  poke(side: number) {
    this.wake();
    if (this.busy) return;
    this.lastSide = Math.sign(side) || 1;
    this.surprise = 1;
    this.annoyance = clamp(this.annoyance + 0.13 + this.tapHeat * 0.27);
    this.tapHeat = Math.min(1.8, this.tapHeat + 0.65);
    this.affection *= 0.55;
  }
  stroke(speed: number, dt: number, side: number) {
    if (this.busy || this.offered || speed < 0.04 || speed > 2.1) return;
    const time = clamp(dt, 0, 0.08);
    this.wake();
    this.lastSide = clamp(side, -1, 1);
    this.touchLean = this.lastSide;
    this.affection = clamp(this.affection + time * 1.15);
    this.annoyance = clamp(this.annoyance - time * 1.15);
    this.tapHeat = Math.max(0, this.tapHeat - time * 1.5);
  }
  offerFood() {
    if (this.busy || this.isFull) return false;
    this.wake();
    this.offered = true;
    return true;
  }
  cancelFood() {
    this.offered = false;
    this.foodNear = false;
    this.foodNotice = 0;
  }
  withdrawFood() {
    if (
      this.offered &&
      this.foodNotice > 0.45 &&
      !this.isFull &&
      this.withdrawCooldown <= 0
    ) {
      this.disappointment = 1;
      this.annoyance = clamp(Math.max(0.76, this.annoyance + 0.24));
      this.affection *= 0.3;
      this.withdrawCooldown = 4;
      this.wake();
    }
    this.cancelFood();
  }
  absorb() {
    if (!this.eat()) return false;
    this.absorbing = true;
    return true;
  }
  eat() {
    if (this.busy || this.isFull) return false;
    this.absorbing = false;
    this.wake();
    this.cancelFood();
    this.mealAge = 0;
    this.mealCounted = false;
    this.annoyance *= 0.25;
    return true;
  }
  advance(dt: number, active = false) {
    const time = clamp(dt, 0, 0.1);
    this.emotionTime += time;
    this.touchLean *= Math.exp(-time * 2.4);
    this.withdrawCooldown = Math.max(0, this.withdrawCooldown - time);
    this.disappointment = Math.max(0, this.disappointment - time * 1.5);
    this.refused = Math.max(0, this.refused - time * 0.65);
    this.dizzy = Math.max(0, this.dizzy - time * 0.8);
    this.wakeAge = Math.max(0, this.wakeAge - time);
    if (this.offered && this.foodNear) this.foodNotice += time;
    this.digestionAge += time;
    if (this.digestionAge > 75)
      this.fullness = Math.max(0, this.fullness - time * 0.008);
    if (this.sated && this.fullness < 0.78) this.sated = false;
    if (active || this.busy || this.offered || this.puff > 0.1)
      this.idleAge = 0;
    else this.idleAge += time;
    const sleepTarget = clamp((this.idleAge - 35) / 25);
    this.sleep +=
      (sleepTarget - this.sleep) *
      (1 - Math.exp(-time * (sleepTarget > this.sleep ? 1.8 : 5)));
    this.tapHeat *= Math.exp(-time * 1.4);
    this.surprise *= Math.exp(-time * 3.6);
    this.annoyance = Math.max(0, this.annoyance - time * 0.05);
    this.affection = Math.max(0, this.affection - time * 0.07);
    if (this.busy) {
      this.mealAge += time;
      if (
        !this.mealCounted &&
        this.mealAge >= (this.absorbing ? 0.9 : MEAL.swallowEnd)
      ) {
        this.mealCounted = true;
        this.fullness = clamp(this.fullness + 1 / 7);
        this.sated = this.fullness > 0.98;
        this.digestionAge = 0;
      }
      if (this.mealAge >= MEAL.end) {
        this.mealAge = -1;
        this.affection = 0.85;
      }
    }
    const weight = 1 - Math.exp(-time * 6);
    this.comfort += (this.affection - this.comfort) * weight;
    this.grump += (clamp((this.annoyance - 0.3) / 0.45) - this.grump) * weight;
    const puffTarget =
      this.disappointment > 0.45 ? 0 : clamp((this.annoyance - 0.25) / 0.3);
    this.puff +=
      (puffTarget - this.puff) *
      (1 - Math.exp(-time * (puffTarget > this.puff ? 1.25 : 0.7)));
    // A centered, breathing sway. Touch may invite a brief lean, never a held pose.
    const sway =
      Math.sin(this.emotionTime * 2.2) *
        (0.045 + 0.012 * Math.sin(this.emotionTime * 0.55)) +
      Math.sin(this.emotionTime * 4.4 + 0.5) * 0.006;
    const leanTarget =
      (sway + this.touchLean * 0.025) *
      this.comfort *
      (1 - this.puff) *
      (1 - this.sleep) *
      (this.busy ? 0.25 : 1);
    this.lean += (leanTarget - this.lean) * (1 - Math.exp(-time * 4));
  }
  reset() {
    this.emotionTime = this.touchLean = 0;
    this.fullness =
      this.puff =
      this.disappointment =
      this.sleep =
      this.wakeAge =
      this.dizzy =
      this.refused =
        0;
    this.idleAge =
      this.foodNotice =
      this.withdrawCooldown =
      this.digestionAge =
        0;
    this.sated = this.mealCounted = false;
    this.affection =
      this.annoyance =
      this.comfort =
      this.grump =
      this.lean =
      this.tapHeat =
      this.surprise =
        0;
    this.mealAge = -1;
    this.cancelFood();
  }
}
