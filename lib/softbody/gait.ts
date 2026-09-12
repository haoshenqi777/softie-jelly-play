import { BodyGesture } from './body-gesture.ts';
import type { PostureSample } from './posture.ts';
import type { VolumeSoftBody } from './solver.ts';
import { ACTIONS } from './action-presets.ts';

/** Contact-conditioned low steps. Propulsion is a single physical impulse after
 * gathering, never a per-frame translation. The soft body supplies landing. */
export class GaitMotor {
  private readonly solver: VolumeSoftBody;
  private readonly gesture: BodyGesture;
  private phase: 'idle' | 'gather' | 'flight' | 'land' = 'idle';
  private age = 0;
  private steps = 0;
  private gatherLoad = 0;
  private axis = [0, 0, 1];
  constructor(solver: VolumeSoftBody) {
    this.solver = solver;
    this.gesture = new BodyGesture(solver);
  }
  interrupt() {
    this.phase = 'idle';
    this.age = 0;
    this.gatherLoad = 0;
    this.gesture.reset();
  }
  stats() {
    return { phase: this.phase, steps: this.steps };
  }
  step(
    pose: PostureSample,
    grounded: boolean,
    direction: ArrayLike<number>,
    speed: number,
    dt: number,
    mode: 'scoot' | 'hop' = 'scoot',
    mood = 0,
    joy = 0,
  ) {
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(speed)) return;
    dt = Math.min(dt, 1 / 120);
    speed = Math.max(0, Math.min(2, speed));
    let vx = 0,
      vz = 0,
      m = 0;
    for (let i = 0; i < this.solver.nodeCount; i++) {
      const w = this.solver.mass[i];
      m += w;
      vx += this.solver.velocity[i * 3] * w;
      vz += this.solver.velocity[i * 3 + 2] * w;
    }
    vx /= m;
    vz /= m;
    if (speed < 0.04) {
      this.interrupt();
      if (grounded && Math.hypot(vx, vz) > 0.015) {
        const brake = 1 - Math.exp(-12 * dt);
        this.solver.kick(-vx * brake, 0, -vz * brake);
      }
      return;
    }
    const n = Math.hypot(direction[0], direction[2]);
    if (n < 1e-6 || !Number.isFinite(n)) return;
    const dx = direction[0] / n,
      dz = direction[2] / n;
    const puff = Math.max(0, Math.min(1, mood));
    const happy = Math.max(0, Math.min(1, joy)) * (1 - puff);
    const tempo = 1 + 0.1 * puff - 0.18 * happy;
    const compression = ACTIONS.compress * (1 + 0.12 * puff - 0.08 * happy);
    const swell = ACTIONS.puffStretch * puff,
      crown = ACTIONS.puffReach * puff;
    this.axis[0] = dz;
    this.axis[2] = -dx;
    if (this.phase === 'idle') {
      if (!grounded) return;
      this.phase = 'gather';
      this.age = 0;
    }
    this.age += dt;
    if (this.phase === 'gather') {
      if (!grounded) {
        this.phase = 'flight';
        this.age = 0;
        return;
      }
      const u = Math.min(
          1,
          this.age /
            ((mode === 'hop'
              ? ACTIONS.hopGatherSeconds
              : ACTIONS.gatherSeconds) *
              tempo),
        ),
        // Stay loaded at takeoff. A completed landing already supplies part
        // of the next crouch, so successive hops do not stand up twice.
        pulse = this.gatherLoad + (1 - this.gatherLoad) * u * u * (3 - 2 * u);
      this.gesture.drive(
        pose,
        this.axis,
        swell + compression * pulse,
        0.018 * pulse,
        crown - 0.025 * pulse,
        dt,
      );
      if (u >= 1) {
        // Step length tapers with the requested speed near the destination.
        const desired = speed * 1.3,
          cap = 2.6;
        const lift =
          (mode === 'hop' ? ACTIONS.hopLiftSpeed : ACTIONS.liftSpeed) *
          (1 + 0.08 * happy);
        this.solver.kick(
          Math.max(-cap, Math.min(cap, dx * desired - vx)),
          Math.max(0, lift - pose.verticalSpeed),
          Math.max(-cap, Math.min(cap, dz * desired - vz)),
        );
        this.phase = 'flight';
        this.age = 0;
        this.steps++;
      }
    } else if (this.phase === 'flight') {
      this.gesture.drive(
        pose,
        this.axis,
        swell + ACTIONS.extend * Math.exp(-this.age * 6),
        0,
        crown + ACTIONS.crownLag * (1 + 0.25 * happy) * Math.exp(-this.age * 4),
        dt,
      );
      if (grounded && this.age > 0.12 && pose.verticalSpeed < 0.3) {
        this.phase = 'land';
        this.age = 0;
      }
    } else {
      const landSeconds = ACTIONS.landSeconds * tempo;
      const u = Math.min(1, this.age / landSeconds);
      const pulse = 0.55 * u * u * (3 - 2 * u);
      this.gesture.drive(
        pose,
        this.axis,
        swell + compression * pulse,
        0.018 * pulse,
        crown - 0.025 * pulse,
        dt,
      );
      if (this.age >= landSeconds) {
        this.phase = 'gather';
        this.age = 0;
        this.gatherLoad = 0.55;
      }
    }
  }
}
