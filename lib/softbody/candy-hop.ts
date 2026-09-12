import { BodyGesture } from './body-gesture.ts';
import type { PostureSample } from './posture.ts';
import type { VolumeSoftBody } from './solver.ts';
import { candyHopPlan } from './candy-hop-plan.ts';

/** One floor impulse, then gravity owns the flight. No pursuit force or pose writes. */
export class CandyHop {
  private phase: 'idle' | 'gather' | 'flight' | 'land' = 'idle';
  private age = 0;
  private launches = 0;
  private kind: 'stride' | 'pounce' = 'pounce';
  private height = 0.95;
  private plan = candyHopPlan();
  private gesture: BodyGesture;
  private axis = [0, 0, 1];
  private destination = [0, 0, 0];
  constructor(private solver: VolumeSoftBody) {
    this.gesture = new BodyGesture(solver);
  }
  get currentPhase() {
    return this.phase;
  }
  stats() {
    return {
      phase: this.phase,
      kind: this.kind,
      motion: this.plan.motion,
      height: this.height,
      age: this.age,
      launches: this.launches,
      destination: this.destination.slice(),
    };
  }
  interrupt() {
    this.phase = 'idle';
    this.age = 0;
    this.gesture.reset();
  }
  step(
    p: PostureSample,
    grounded: boolean,
    food: { destination: ArrayLike<number>; invited?: boolean; id?: number },
    gravity: number,
    dt: number,
  ) {
    if (this.phase === 'idle') {
      if (
        !grounded ||
        Math.abs(p.verticalSpeed) > 0.3 ||
        Math.hypot(...p.omega) > 0.65
      )
        return;
      this.phase = 'gather';
      this.age = 0;
      const distance = Math.hypot(
        food.destination[0] - p.center[0],
        food.destination[2] - p.center[2],
      );
      this.kind = distance > 2.2 ? 'stride' : 'pounce';
      this.plan = candyHopPlan(food.id);
      this.axis = [p.forward[0], 0, p.forward[2]];
      this.height = this.kind === 'stride' ? 0.38 : this.plan.height;
    }
    this.age += dt;
    if (this.phase === 'gather') {
      const u = Math.min(
        1,
        this.age / (this.kind === 'stride' ? 0.22 : this.plan.gather),
      );
      this.gesture.drive(
        p,
        this.axis,
        -(this.kind === 'stride' ? 0.05 : 0.085) * u * u,
        this.kind === 'stride'
          ? 0
          : this.plan.bend * Math.sin(Math.PI * u) ** 2,
        -0.026 * u * u,
        dt,
      );
      if (u < 1 || !grounded) return;
      const g = Math.max(2.5, gravity),
        vy = Math.sqrt(2 * g * this.height);
      // Match the solver's air drag; aim at the descending contact height.
      const drag = 0.35;
      const height = (t: number) =>
        ((vy + g / drag) * (1 - Math.exp(-drag * t))) / drag - (g * t) / drag;
      let lo = Math.log(1 + (drag * vy) / g) / drag,
        hi = (2 * vy) / g + 0.5;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (height(mid) > 0.13) lo = mid;
        else hi = mid;
      }
      const travelTime = (1 - Math.exp(-drag * hi)) / drag;
      let dx = food.destination[0] - p.center[0],
        dz = food.destination[2] - p.center[2];
      const distance = Math.hypot(dx, dz),
        reach =
          this.kind === 'stride'
            ? Math.min(1, Math.min(1.55, distance - 1.75) / (distance || 1))
            : 1;
      dx *= reach;
      dz *= reach;
      this.destination = [p.center[0] + dx, 0, p.center[2] + dz];
      let vx = 0,
        vz = 0,
        total = 0;
      for (let i = 0; i < this.solver.mass.length; i++) {
        const m = this.solver.mass[i];
        total += m;
        vx += m * this.solver.velocity[i * 3];
        vz += m * this.solver.velocity[i * 3 + 2];
      }
      this.solver.kick(
        dx / travelTime - vx / total,
        vy - p.verticalSpeed,
        dz / travelTime - vz / total,
      );
      this.launches++;
      this.phase = 'flight';
      this.age = 0;
    } else if (this.phase === 'flight') {
      this.gesture.drive(
        p,
        this.axis,
        0.035 * Math.exp(-this.age * 7),
        this.kind === 'stride' ? 0 : this.plan.bend * Math.exp(-this.age * 6),
        0.025 * Math.exp(-this.age * 4),
        dt,
      );
      if (grounded && this.age > 0.2 && p.verticalSpeed < 0.2) {
        this.phase = 'land';
        this.age = 0;
      }
    } else {
      this.gesture.drive(
        p,
        this.axis,
        -0.025 * Math.exp(-this.age * 9),
        0,
        0,
        dt,
      );
      // A missed landing gets a quiet interval before another discrete hop.
      if (grounded && this.age > (this.kind === 'stride' ? 0.28 : 0.65))
        this.interrupt();
    }
  }
}
