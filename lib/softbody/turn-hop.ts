import { BodyGesture } from './body-gesture.ts';
import type { PostureSample } from './posture.ts';
import type { VolumeSoftBody } from './solver.ts';

/** Gather on the floor, then turn with bounded torque during one higher hop. */
export class TurnHop {
  private phase: 'idle' | 'gather' | 'flight' | 'land' | 'done' = 'idle';
  private age = 0;
  private gesture: BodyGesture;
  private axis = [0, 0, 1];
  private target = [0, 0, 1];
  constructor(private solver: VolumeSoftBody) {
    this.gesture = new BodyGesture(solver);
  }
  stats() {
    return { phase: this.phase, age: this.age };
  }
  get active() {
    return this.phase !== 'idle' && this.phase !== 'done';
  }
  interrupt() {
    this.phase = 'idle';
    this.age = 0;
    this.gesture.reset();
  }
  step(
    p: PostureSample,
    grounded: boolean,
    facing: ArrayLike<number>,
    dt: number,
  ) {
    if (this.phase === 'idle') {
      this.target[0] = facing[0];
      this.target[2] = facing[2];
    }
    const f = p.forward;
    const heading = Math.atan2(
      f[2] * this.target[0] - f[0] * this.target[2],
      f[0] * this.target[0] + f[2] * this.target[2],
    );
    if (this.phase === 'done') return false;
    if (this.phase === 'idle') {
      if (
        !grounded ||
        Math.abs(p.verticalSpeed) > 0.25 ||
        Math.hypot(...p.omega) > 0.7
      )
        return true;
      if (Math.abs(heading) < 0.22) {
        this.phase = 'done';
        return false;
      }
      this.phase = 'gather';
      this.age = 0;
    }
    this.age += dt;
    if (this.phase === 'gather') {
      const u = Math.min(1, this.age / 0.16);
      this.gesture.drive(p, this.axis, -0.085 * u * u, 0, -0.02 * u, dt);
      if (u === 1) {
        this.solver.kick(0, Math.max(0, 3.15 - p.verticalSpeed), 0);
        this.phase = 'flight';
        this.age = 0;
      }
    } else if (this.phase === 'flight') {
      const torque = Math.max(-36, Math.min(36, heading * 38 - p.omega[1] * 8));
      this.solver.actuate(
        [-p.up[2] * 10 - p.omega[0] * 5, torque, p.up[0] * 10 - p.omega[2] * 5],
        p.up,
        0,
        dt,
      );
      this.gesture.drive(
        p,
        this.axis,
        0.05 * Math.exp(-this.age * 7),
        0,
        0.045 * Math.exp(-this.age * 4),
        dt,
      );
      if (grounded && this.age > 0.16 && p.verticalSpeed < 0.25) {
        this.phase = 'land';
        this.age = 0;
      }
    } else {
      this.gesture.drive(
        p,
        this.axis,
        -0.03 * Math.exp(-this.age * 10),
        0,
        0,
        dt,
      );
      if (grounded && this.age > 0.12) {
        this.phase = 'done';
        this.gesture.reset();
      }
    }
    return this.phase !== 'done';
  }
}
