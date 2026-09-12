export type SocialBeat =
  | 'none'
  | 'look'
  | 'inflate'
  | 'stamp'
  | 'wait'
  | 'soften'
  | 'nuzzle'
  | 'content';

export const SOCIAL_SECONDS = {
  look: 0.28,
  inflate: 0.65,
  stamp: 0.32,
  wait: 5.5,
  soften: 0.85,
  nuzzle: 1.1,
  content: 1.8,
} as const;

/** A supported performance, not a second navigator or a second mood owner. */
export class SocialResponse {
  private state = { beat: 'none' as SocialBeat, age: 0, comfort: 0, joy: 0 };
  private credit = 0;
  private gap = Infinity;

  frame() {
    return this.state;
  }

  arrive(mood: number) {
    if (['soften', 'nuzzle', 'content'].includes(this.state.beat)) return;
    this.enter(mood > 0.1 ? 'look' : 'none');
  }

  interrupt(hard = false) {
    this.enter('none');
    this.credit = 0;
    this.gap = Infinity;
    this.state.comfort = 0;
    if (hard) this.state.joy = 0;
  }

  stroke(seconds: number, mood: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(mood))
      return 0;
    if (this.gap > 0.65) this.credit = 0;
    const before = Math.max(0, this.credit - 0.45);
    this.credit = Math.min(3, this.credit + Math.min(0.6, seconds));
    this.gap = 0;
    const eligible = Math.max(0, this.credit - 0.45) - before;
    this.state.comfort = Math.min(1, Math.max(0, this.credit - 0.45) / 1.35);
    if (this.credit > 0.45) {
      if (!['soften', 'nuzzle', 'content'].includes(this.state.beat))
        this.enter('soften');
      this.state.joy = Math.min(1, this.state.joy + eligible * 0.6);
    }
    return Math.min(Math.max(0, mood), eligible * 0.65);
  }

  step(dt: number, mood: number, active: boolean, held = false) {
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(mood)) return;
    dt = Math.min(dt, 0.1);
    this.gap += dt;
    this.state.joy = Math.max(0, this.state.joy - dt * 0.035);
    if (this.gap > 0.65) {
      this.credit = 0;
      this.state.comfort = Math.max(0, this.state.comfort - dt * 0.25);
    }
    // Stroking can soften the face while held; autonomous movement waits.
    if (!active || held || this.state.beat === 'none') return;
    this.state.age += dt;
    const beat = this.state.beat;
    if (beat === 'soften' && mood > 0.12) {
      if (this.gap > 0.8) this.enter('wait');
      return;
    }
    if (this.state.age + 1e-8 < SOCIAL_SECONDS[beat]) return;
    const next: Record<Exclude<SocialBeat, 'none'>, SocialBeat> = {
      look: 'inflate',
      inflate: 'stamp',
      stamp: 'wait',
      wait: 'none',
      soften: 'nuzzle',
      nuzzle: 'content',
      content: 'none',
    };
    this.enter(next[beat]);
  }

  private enter(beat: SocialBeat) {
    this.state.beat = beat;
    this.state.age = 0;
  }
}
