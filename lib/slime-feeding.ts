import type { CandyBody, CandyWorld, Point3 } from './candy-physics';
import type { SlimeDynamics } from './slime-physics';
type Body = Point3 & { mouth: Point3; held: boolean; bound: number };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
export type FeedingAction = {
  driveX: number | null;
  driveZ: number | null;
  hop: { x: number; z: number; height: number } | null;
  scoopId: number | null;
  lean: number;
  squash: number;
  reachX: number;
  reachY: number;
};
const idle = (): FeedingAction => ({
  driveX: null,
  driveZ: null,
  hop: null,
  scoopId: null,
  lean: 0,
  squash: 0,
  reachX: 0,
  reachY: 0,
});
export class SlimeFeeding {
  targetId: number | null = null;
  age = 0;
  distance = Infinity;
  miss = 0;
  private gather = 0;
  private hopCooldown = 0;
  private scoopCooldown = 0;
  private previous: Point3 | null = null;
  private previousMouth: Point3 | null = null;
  private canCatch = false;
  reset() {
    this.targetId = null;
    this.age = this.gather = this.miss = 0;
    this.previous = this.previousMouth = null;
    this.canCatch = false;
  }
  update(
    dt: number,
    candies: CandyBody[],
    body: Body,
    hungry: boolean,
  ): FeedingAction {
    this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.scoopCooldown = Math.max(0, this.scoopCooldown - dt);
    this.miss = Math.max(0, this.miss - dt * 1.5);
    this.canCatch = hungry && !body.held;
    if (!this.canCatch) {
      this.reset();
      return idle();
    }
    let target = candies.find(
      (c) => c.id === this.targetId && c.mode !== 'mouth',
    );
    const hand = candies.find((c) => c.mode === 'held');
    if (hand && hand.id !== target?.id) target = hand;
    if (!target)
      target = candies
        .filter((c) => c.mode !== 'mouth')
        .sort(
          (a, b) =>
            Math.hypot(a.x - body.x, a.z - body.z - 1.18) -
            Math.hypot(b.x - body.x, b.z - body.z - 1.18),
        )[0];
    if (!target) {
      this.reset();
      return idle();
    }
    if (target.id !== this.targetId) {
      this.targetId = target.id;
      this.age = 0;
      this.gather = 0;
    }
    this.age += dt;
    this.previous = { x: target.x, y: target.y, z: target.z };
    this.previousMouth = { ...body.mouth };
    this.distance = Math.hypot(
      target.x - body.mouth.x,
      target.y - body.mouth.y,
      target.z - body.mouth.z,
    );
    const action = idle();
    if (this.age < 0.2) return action;
    const flight = target.mode === 'free' && target.y > 0.35;
    const lead = flight ? 0.12 : 0;
    const x = clamp(target.x + target.vx * lead, -body.bound, body.bound);
    const ground =
      target.mode === 'free' && target.y < 0.24 && Math.abs(target.vy) < 0.4;
    const z = clamp(
      target.z + target.vz * lead - (ground ? 1.5 : 1.18),
      -2.2,
      1.9,
    );
    const dx = x - body.x,
      dz = z - body.z,
      travel = Math.hypot(dx, dz);
    const high = target.y - body.y > 1.38;
    if ((travel > 0.29 || high) && body.y < 0.025 && this.hopCooldown <= 0) {
      this.gather += dt;
      action.squash =
        -0.11 * Math.sin(clamp(this.gather / 0.2, 0, 1) * Math.PI * 0.5);
      if (this.gather >= 0.2) {
        action.hop = { x, z, height: clamp(target.y - 1.08, 0.16, 0.43) };
        this.hopCooldown = 0.8;
        this.gather = 0;
      }
    } else {
      this.gather = 0;
      if (body.y < 0.025) {
        action.driveX = clamp(dx * 3, -0.5, 0.5);
        action.driveZ = clamp(dz * 3, -0.5, 0.5);
      }
    }
    const closeFloor =
      Math.hypot(target.x - body.x, target.z - body.z - 1.5) < 0.14;
    if (ground && closeFloor && body.y < 0.035) {
      action.squash = -0.12;
      action.reachY = -0.12;
      if (this.age > 0.4 && this.scoopCooldown <= 0) {
        action.scoopId = target.id;
        this.scoopCooldown = 1.1;
      }
    } else {
      action.reachX =
        clamp(target.x - body.mouth.x, -0.1, 0.1) * clamp(1 - travel, 0, 1);
      action.reachY =
        clamp(target.y - body.y - 1.025, -0.16, 0.2) * clamp(1 - travel, 0, 1);
    }
    action.lean = clamp(dx * 0.035, -0.035, 0.035);
    return action;
  }
  contact(candies: CandyBody[], mouth: Point3): number | null {
    if (!this.canCatch || this.age < 0.2) return null;
    const c = candies.find((c) => c.id === this.targetId && c.mode !== 'mouth');
    if (!c || !this.previous || !this.previousMouth) return null;
    const a = {
      x: this.previous.x - this.previousMouth.x,
      y: this.previous.y - this.previousMouth.y,
      z: this.previous.z - this.previousMouth.z,
    };
    const b = { x: c.x - mouth.x, y: c.y - mouth.y, z: c.z - mouth.z };
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z,
      l2 = dx * dx + dy * dy + dz * dz;
    const t =
      l2 > 0.000001 ? clamp(-(a.x * dx + a.y * dy + a.z * dz) / l2, 0, 1) : 0;
    const distance = Math.hypot(a.x + dx * t, a.y + dy * t, a.z + dz * t);
    this.distance = Math.hypot(b.x, b.y, b.z);
    return distance < 0.145 ? c.id : null;
  }
  apply(
    action: FeedingAction,
    physics: SlimeDynamics,
    world: CandyWorld,
    mouth: Point3,
  ) {
    physics.drive = action.driveX;
    physics.driveZ = action.driveZ;
    physics.pose.lean = action.lean;
    physics.pose.squash = action.squash;
    physics.pose.reachX = action.reachX;
    physics.pose.reachY = action.reachY;
    if (action.hop)
      physics.hopTo(action.hop.x, action.hop.height, action.hop.z);
    if (action.scoopId !== null) {
      const c = world.get(action.scoopId);
      if (!c) return;
      const rise = Math.max(0.25, mouth.y - c.y);
      c.vy = Math.sqrt(2 * 6.8 * (rise + 0.08));
      const t =
        (c.vy - Math.sqrt(Math.max(0, c.vy * c.vy - 2 * 6.8 * rise))) / 6.8;
      c.vx = (mouth.x - c.x) / Math.max(0.22, t);
      c.vz = (mouth.z - c.z) / Math.max(0.22, t);
      c.sleeping = false;
      c.still = 0;
      c.compressionV += 1;
    }
  }
}
