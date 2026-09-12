import type { V3 } from './behavior-types.ts';
import { candyHopPlan, type CandyHopMotion } from './candy-hop-plan.ts';
export type CandyObservation = {
  pointerPending?: boolean;
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  mode: string;
};
export type CandyAttention = {
  motion: CandyHopMotion;
  invited?: boolean;
  id: number;
  stage: 'noticing' | 'seeking' | 'inspecting' | 'collecting';
  age: number;
  point: V3;
  destination: V3;
  facing: V3;
  speed: number;
  nearby: boolean;
  pressDirection: V3;
};
type Observer = {
  center: V3;
  forward: V3;
  velocity: V3;
  width: number;
  grounded: boolean;
  stable: boolean;
  canAbsorb?: boolean;
};
const floorReady = (c: CandyObservation) =>
  !c.pointerPending &&
  c.mode === 'free' &&
  c.radius > 0 &&
  [c.x, c.y, c.z, c.vx, c.vy, c.vz, c.radius].every(Number.isFinite) &&
  c.y >= 0 &&
  c.y <= c.radius + 0.09 &&
  Math.hypot(c.vx, c.vy, c.vz) < 0.6;

/** Observe in place, then request a jump. Only real collision starts absorption. */
export class CandyInterest {
  private attention: CandyAttention | null = null;
  private settled = new Map<number, number>();
  private cooldown = 0;
  private invitation: number | null = null;
  invite(id: number) {
    if (this.attention?.id === id) {
      this.attention.invited = true;
      return;
    }
    this.invitation = id;
    this.cooldown = 0;
  }
  get invited() {
    return this.invitation !== null || !!this.attention?.invited;
  }
  get active() {
    return this.attention !== null;
  }
  reset(cooldown = 0) {
    this.invitation = null;
    this.attention = null;
    this.settled.clear();
    this.cooldown = cooldown;
  }
  step(
    candies: readonly CandyObservation[],
    o: Observer,
    dt: number,
  ): CandyAttention | null {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const ids = new Set<number>();
    for (const c of candies) {
      ids.add(c.id);
      this.settled.set(
        c.id,
        floorReady(c) ? (this.settled.get(c.id) ?? 0) + dt : 0,
      );
    }
    for (const id of this.settled.keys())
      if (!ids.has(id)) this.settled.delete(id);
    if (
      this.invitation !== null &&
      !candies.some((c) => c.id === this.invitation && floorReady(c))
    )
      this.invitation = null;
    if (this.attention) {
      const a = this.attention,
        c = candies.find((c) => c.id === a.id);
      // A short tap does not restart an already launched jump. Crossing the
      // drag threshold changes mode to held and cancels the target below.
      if (c?.pointerPending && c.mode === 'free') return a;
      if (
        !c ||
        !floorReady(c) ||
        Math.hypot(c.x - a.point[0], c.z - a.point[2]) > 0.35
      ) {
        this.reset(0.35);
        return null;
      }
      a.point = [c.x, c.y, c.z];
      this.destination(a, o.width, c.radius);
    }
    if (!this.attention && this.cooldown === 0 && o.grounded && o.stable) {
      let nearest: CandyObservation | null = null,
        distance = Infinity;
      for (const c of candies) {
        const d = Math.hypot(c.x - o.center[0], c.z - o.center[2]);
        if (
          floorReady(c) &&
          (c.id === this.invitation || (this.settled.get(c.id) ?? 0) >= 1.2) &&
          d < distance &&
          d < o.width * 4
        ) {
          nearest = c;
          distance = d;
        }
      }
      if (nearest) {
        const dx = nearest.x - o.center[0],
          dz = nearest.z - o.center[2];
        const n = Math.hypot(dx, dz),
          fn = Math.hypot(o.forward[0], o.forward[2]) || 1;
        const plan = candyHopPlan(nearest.id);
        const ax = n > 0.001 ? dx / n : o.forward[0] / fn;
        const az = n > 0.001 ? dz / n : o.forward[2] / fn;
        this.attention = {
          motion: plan.motion,
          invited: nearest.id === this.invitation,
          id: nearest.id,
          stage: 'noticing',
          age: 0,
          point: [nearest.x, nearest.y, nearest.z],
          destination: [...o.center],
          facing: [o.forward[0] / fn, 0, o.forward[2] / fn],
          speed: 0,
          nearby: distance < o.width * 0.72 + nearest.radius,
          pressDirection: [
            ax * Math.cos(plan.angle) + az * Math.sin(plan.angle),
            0,
            az * Math.cos(plan.angle) - ax * Math.sin(plan.angle),
          ],
        };
        this.destination(this.attention, o.width, nearest.radius);
        this.invitation = null;
      }
    }
    const a = this.attention;
    if (!a) return null;
    a.age += dt;
    if (a.stage === 'noticing' && a.age >= (a.invited ? 0.32 : 0.55)) {
      a.stage = 'inspecting';
      a.age = 0;
    }
    if (
      a.stage === 'inspecting' &&
      a.age >= (a.invited ? 0.45 : 0.8) &&
      o.canAbsorb
    ) {
      a.stage = 'collecting';
      a.age = 0;
    }
    a.speed = a.stage === 'collecting' ? 1 : 0;
    return a;
  }
  private destination(a: CandyAttention, width: number, _radius: number) {
    // Different real candy directions select different underbelly quadrants.
    // The rounded shoulder has a resolved contact patch; the flat base is a
    // sparse triangle fan and cannot represent a tiny sugar dent at its center.
    const offset = width * 0.42;
    a.destination = [
      a.point[0] - a.pressDirection[0] * offset,
      0,
      a.point[2] - a.pressDirection[2] * offset,
    ];
  }
}
