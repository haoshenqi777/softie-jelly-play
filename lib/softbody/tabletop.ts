import type { VolumeSoftBody } from './solver.ts';

/** Ordinary deformation is 1:1 with free play. Only repeated whole-body lifts
 * approach a soft ceiling; downward compression and lateral strain stay intact. */
export function tabletopDrag(
  target: number[],
  origin: number[],
  liftAtGrab = 0,
): number[] {
  const result = [...target];
  const rise = target[1] - origin[1];
  const limit = Math.max(0, 1.7 - liftAtGrab);
  const linear = Math.min(1.2, limit * 0.75);
  if (rise > linear) {
    const tail = limit - linear;
    result[1] =
      origin[1] +
      linear +
      (tail > 0 ? tail * Math.tanh((rise - linear) / tail) : 0);
  }
  return result;
}

/** Room policy changes only uniform velocity, leaving local strain/materials intact.
 * It never writes positions and yields completely to feeding contact/ballistics. */
export class TabletopMotion {
  readonly home = [0, 0, 0];
  private readonly center = [0, 0, 0];
  private readonly velocity = [0, 0, 0];
  private readonly frame = { center: this.center, velocity: this.velocity };
  private releaseAge = 1;
  constructor(private readonly solver: VolumeSoftBody) {
    let total = 0;
    for (let i = 0; i < solver.nodeCount; i++) {
      total += solver.mass[i];
      for (let k = 0; k < 3; k++)
        this.home[k] += solver.rest[i * 3 + k] * solver.mass[i];
    }
    for (let k = 0; k < 3; k++) this.home[k] /= total;
  }
  sample() {
    this.center.fill(0);
    this.velocity.fill(0);
    const s = this.solver;
    let total = 0;
    for (let i = 0; i < s.nodeCount; i++) {
      const m = s.mass[i];
      total += m;
      for (let k = 0; k < 3; k++) {
        this.center[k] += s.x[i * 3 + k] * m;
        this.velocity[k] += s.velocity[i * 3 + k] * m;
      }
    }
    for (let k = 0; k < 3; k++) {
      this.center[k] /= total;
      this.velocity[k] /= total;
    }
    return this.frame;
  }
  release() {
    const v = this.sample().velocity;
    const gain = Math.min(1, 1.1 / (Math.hypot(v[0], v[2]) || 1));
    this.solver.kick(
      v[0] * (gain - 1),
      Math.min(4, v[1]) - v[1],
      v[2] * (gain - 1),
    );
    this.releaseAge = 0;
  }
  reset() {
    this.releaseAge = 1;
  }
  step(dt: number, held: boolean, feeding: boolean) {
    this.releaseAge += dt;
    // A hand can pick up a digesting body too. Input and its brief release
    // guard take precedence; otherwise feeding owns its complete trajectory.
    if ((feeding && !held && this.releaseAge >= 0.8) || this.solver.sleeping)
      return;
    const { center: c, velocity: v } = this.sample();
    const x = c[0] - this.home[0],
      z = c[2] - this.home[2];
    const r = Math.hypot(x, z);
    // A roomy neutral zone permits small hops and weight shifts. Outside it,
    // a bounded soft force opposes travel; the character is never teleported.
    const excess = Math.max(0, r - 0.65);
    const spring = Math.min(45, excess * 65) / (r || 1);
    // No added damping in the neutral zone: squeezing must retain its full feel.
    const damp = Math.min(1, excess / 0.3) * (held ? 14 : 9);
    const drag = 1 - Math.exp(-damp * dt);
    const dx = -x * spring * dt - v[0] * drag;
    const dz = -z * spring * dt - v[2] * drag;
    // Dissipate residual recoil after a hand release, not intentional jump energy.
    let dy =
      !held && this.releaseAge < 0.45 && v[1] > 4
        ? -(v[1] - 4) * (1 - Math.exp(-18 * dt))
        : 0;
    if (held) {
      const lift = Math.max(0, c[1] - this.home[1] - 1.4);
      dy -= Math.min(24, lift * 40) * dt;
      if (lift > 0) dy -= Math.max(0, v[1]) * (1 - Math.exp(-10 * dt));
    }
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-8)
      this.solver.kick(dx, dy, dz);
  }
}
