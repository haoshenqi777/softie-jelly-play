import { BodyPosture } from './posture.ts';
import { BodyGesture } from './body-gesture.ts';
import type { VolumeSoftBody } from './solver.ts';

export type RecoveryPhase =
  | 'idle'
  | 'notice'
  | 'brace'
  | 'roll'
  | 'settle'
  | 'celebrate'
  | 'rest';
export type RecoveryEvent =
  | 'stumble'
  | 'righting'
  | 'recovered'
  | 'recovery-cancel';

/** Fixed-step, contact-dependent self-righting. It never writes positions. */
export class SelfRighting {
  private readonly solver: VolumeSoftBody;
  private readonly sensor: BodyPosture;
  private readonly notify: (event: RecoveryEvent, strength?: number) => void;
  private phase: RecoveryPhase = 'idle';
  private age = 0;
  private tiltedTime = 0;
  private stableTime = 0;
  private cooldown = 0;
  private attempt = 0;
  private enabled = true;
  private rollAxis = [0, 0, 1];
  private acceleration = [0, 0, 0];
  private upY = 1;
  private readonly gesture: BodyGesture;

  constructor(
    solver: VolumeSoftBody,
    notify: (event: RecoveryEvent, strength?: number) => void,
  ) {
    this.solver = solver;
    this.sensor = new BodyPosture(solver.rest, solver.mass);
    this.gesture = new BodyGesture(solver);
    this.notify = notify;
  }
  setEnabled(value: boolean) {
    this.enabled = value;
    if (!value) this.interrupt();
  }
  reset() {
    this.interrupt();
    this.cooldown = 0;
    this.upY = 1;
  }
  interrupt() {
    if (this.phase !== 'idle') this.notify('recovery-cancel');
    this.phase = 'idle';
    this.age = 0;
    this.tiltedTime = 0;
    this.stableTime = 0;
    this.attempt = 0;
    this.cooldown = 0.4;
    this.gesture.reset();
  }
  stats() {
    return {
      phase: this.phase,
      age: this.age,
      upY: this.upY,
      attempt: this.attempt,
      enabled: this.enabled,
    };
  }
  private enter(phase: RecoveryPhase) {
    this.phase = phase;
    this.age = 0;
    this.stableTime = 0;
  }

  step(dt: number, held: boolean) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 1 / 120);
    const pose = this.sensor.sample(this.solver.x, this.solver.velocity);
    this.upY = Math.max(-1, Math.min(1, pose.up[1]));
    if (held || !this.enabled) {
      if (this.phase !== 'idle') this.interrupt();
      this.tiltedTime = 0;
      this.cooldown = 0.4;
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    const grounded =
      pose.minY - this.solver.floorLevel < 0.04 &&
      Math.abs(pose.verticalSpeed) < 1;
    const omega = Math.hypot(...pose.omega);
    if (!grounded) {
      this.tiltedTime = 0;
      return;
    }
    this.age += dt;
    if (this.phase === 'idle') {
      if (this.upY < 0.82 && omega < 4 && this.cooldown === 0)
        this.tiltedTime += dt;
      else this.tiltedTime = 0;
      if (this.tiltedTime >= 0.14) {
        this.enter('notice');
        this.notify('stumble', this.upY < -0.35 ? 1 : 0);
        const length = Math.hypot(pose.up[0], pose.up[2]);
        this.rollAxis =
          length > 0.15
            ? [-pose.up[2] / length, 0, pose.up[0] / length]
            : [0, 0, 1];
      }
      return;
    }
    if (this.phase === 'celebrate') {
      // Exhale, then a small proud stretch; the crown catches up after the belly.
      const exhale = this.pulse(this.age, 0, 0.42),
        proud = this.pulse(this.age, 0.35, 1.15);
      this.gesture.drive(
        pose,
        this.rollAxis,
        -0.035 * exhale + 0.12 * proud,
        0,
        0.065 * proud,
        dt,
      );
      if (this.upY < 0.75) this.interrupt();
      else if (this.age > 2.3) {
        this.enter('idle');
        this.attempt = 0;
        this.gesture.reset();
      }
      return;
    }
    if (this.upY > 0.96 && omega < 0.6) this.stableTime += dt;
    else this.stableTime = 0;
    if (this.phase === 'settle' && this.stableTime > 0.2 && this.age > 0.25) {
      this.enter('celebrate');
      this.notify('recovered');
      return;
    }
    if (this.phase === 'notice') {
      const peek = this.pulse(this.age, 0.025, 0.295);
      this.gesture.drive(pose, this.rollAxis, 0, 0.045 * peek, 0.1 * peek, dt);
      if (this.age >= 0.32) {
        this.enter('brace');
        this.notify('righting', 0.45);
      }
      return;
    }
    if (this.phase === 'rest') {
      if (this.age > 2) {
        this.enter('notice');
        this.attempt = 0;
        this.notify('stumble', 0.4);
      }
      return;
    }
    if (this.phase === 'brace') {
      // Gather into the roll, retaining the loaded pose until effort starts.
      const u = Math.min(1, this.age / 0.26);
      const gather = u * u * (3 - 2 * u);
      this.gesture.drive(
        pose,
        this.rollAxis,
        -0.14 * gather,
        -0.065 * gather,
        -0.025 * gather,
        dt,
      );
      this.notify('righting', 0.45 + 0.3 * gather);
      if (this.age >= 0.26) {
        this.enter('roll');
        this.attempt++;
      }
      return;
    }
    const angle = Math.acos(this.upY),
      length = Math.hypot(pose.up[0], pose.up[2]);
    const axis = this.rollAxis;
    if (length > 0.15) {
      axis[0] = -pose.up[2] / length;
      axis[2] = pose.up[0] / length;
    }
    const gain = this.phase === 'settle' ? 7 : 10;
    const unfurl = this.phase === 'roll' ? this.pulse(this.age, 0, 0.75) : 0;
    const land = this.phase === 'settle' ? this.pulse(this.age, 0, 0.45) : 0;
    this.gesture.drive(
      pose,
      this.rollAxis,
      0.07 * unfurl - 0.07 * land,
      0.065 * unfurl,
      0.025 * unfurl,
      dt,
    );
    for (let k = 0; k < 3; k++)
      this.acceleration[k] =
        gain * angle * axis[k] * Math.min(1, this.age / 0.28) -
        4.5 * pose.omega[k];
    this.solver.actuate(this.acceleration, pose.up, 0, dt);
    this.notify(
      'righting',
      this.phase === 'settle' ? 0.35 : Math.min(1, 0.55 + angle * 0.15),
    );
    if (this.phase === 'roll' && this.upY > 0.9) this.enter('settle');
    if (this.phase === 'settle' && this.upY < 0.75) this.enter('roll');
    if (this.age > 4) {
      this.notify('recovery-cancel');
      this.enter(this.attempt >= 3 ? 'rest' : 'brace');
    }
  }
  private pulse(time: number, start: number, duration: number) {
    if (time <= start || time >= start + duration) return 0;
    return Math.sin((Math.PI * (time - start)) / duration) ** 2;
  }
}
