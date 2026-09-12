import type { CandyBody } from './candy-physics.ts';
import type { SlimeDynamics } from './slime-physics.ts';
import type { SlimeContactSurface } from './slime-contact.ts';
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (x: number) => {
  const t = clamp(x);
  return t * t * (3 - 2 * t);
};
export const sampleAbsorption = (age: number) => ({
  enclosure: smooth((age - 0.12) / 0.78),
  melt: smooth((age - 1.55) / 3.25),
  pigment: smooth((age - 1.8) / 4.1),
  squeeze: Math.sin(clamp(age / 0.9) * Math.PI) * 0.085,
});

export function absorptionPosition(
  origin: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  age: number,
) {
  const entry = sampleAbsorption(age).enclosure,
    settle = smooth((age - 0.9) / 1.5);
  const entered = {
    x: origin.x - normal.x * 0.22 * entry,
    y: origin.y - normal.y * 0.22 * entry,
    z: origin.z - normal.z * 0.22 * entry,
  };
  const destination = {
    x: origin.x * 0.55,
    y: 0.38 + Math.min(0.2, origin.y * 0.08),
    z: origin.z * 0.58,
  };
  return {
    x: entered.x + (destination.x - entered.x) * settle,
    y: entered.y + (destination.y - entered.y) * settle,
    z: entered.z + (destination.z - entered.z) * settle,
  };
}

export class SlimeAbsorption {
  targetId: number | null = null;
  distance = Infinity;
  age = 0;
  private gather = 0;
  private cooldown = 0;
  private enabled = false;
  reset() {
    this.targetId = null;
    this.distance = Infinity;
    this.age = this.gather = 0;
    this.enabled = false;
  }
  update(
    dt: number,
    candies: CandyBody[],
    body: SlimeDynamics,
    enabled: boolean,
  ) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.enabled = enabled && !body.held;
    if (!this.enabled) {
      this.reset();
      return;
    }
    const available = candies.filter((c) => c.mode !== 'mouth');
    let target =
      available.find((c) => c.mode === 'held') ||
      available.find((c) => c.id === this.targetId);
    if (!target)
      target = available.sort(
        (a, b) =>
          Math.hypot(a.x - body.x, a.z - body.z) -
          Math.hypot(b.x - body.x, b.z - body.z),
      )[0];
    if (!target) {
      this.reset();
      return;
    }
    if (this.targetId !== target.id) {
      this.targetId = target.id;
      this.age = this.gather = 0;
    }
    this.age += dt;
    this.distance = Math.hypot(
      target.x - body.x,
      target.y - body.y - 0.7,
      target.z - body.z,
    );
    if (this.age < 0.22) return;
    const lead = target.mode === 'free' && target.y > 0.3 ? 0.16 : 0;
    const x = clamp(target.x + target.vx * lead, -2.3, 2.3);
    const z = clamp(target.z + target.vz * lead - 0.22, -2.2, 1.9);
    const dx = x - body.x,
      dz = z - body.z,
      travel = Math.hypot(dx, dz);
    if (travel > 0.38 && body.y < 0.025 && this.cooldown <= 0) {
      this.gather += dt;
      body.pose.squash = -0.13 * smooth(this.gather / 0.24);
      if (this.gather >= 0.24) {
        body.hopTo(x, clamp(0.16 + travel * 0.065, 0.16, 0.31), z);
        this.cooldown = 0.8;
        this.gather = 0;
      }
    } else if (body.y < 0.025) {
      body.drive = clamp(dx * 2, -0.45, 0.45);
      body.driveZ = clamp(dz * 2, -0.45, 0.45);
    }
  }
  contact(
    candies: CandyBody[],
    skin: SlimeContactSurface,
    body: SlimeDynamics,
  ) {
    if (!this.enabled || this.age < 0.3 || body.held) return null;
    const c = candies.find((c) => c.id === this.targetId);
    if (!c || c.mode !== 'free' || Math.hypot(c.vx, c.vy, c.vz) > 5.5)
      return null;
    const hit = skin.contact(c, c.radius + 0.045);
    if (!hit) return null;
    // Capture only the small contacting neighbourhood, not a remote point on
    // the infinite inward half-plane of a silhouette sample.
    return Math.hypot(
      c.x - hit.position.x,
      c.y - hit.position.y,
      c.z - hit.position.z,
    ) < 0.35
      ? c.id
      : null;
  }
}

export function absorptionCompression(captured: number, age: number) {
  const t = smooth(age / 0.4);
  return captured * (1 - t) + sampleAbsorption(age).squeeze * t;
}
