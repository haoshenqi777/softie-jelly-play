// Product shapes are both rigid. Legacy study kinds remain readable.
export type CandyKind = 'cube' | 'round' | 'gummy' | 'hard';
export const BASE_CANDY_RADIUS = 0.085;
export const HARD_CUBE_BEVEL = 0.014;
export const roundCandy = (kind: CandyKind) =>
  kind === 'round' || kind === 'hard';
export const candyBevel = (kind: CandyKind, half: number) =>
  roundCandy(kind)
    ? half
    : half * ((kind === 'cube' ? HARD_CUBE_BEVEL : 0.045) / BASE_CANDY_RADIUS);
export type Point3 = { x: number; y: number; z: number };
export type CandyCollision = {
  position: Point3;
  normal: Point3;
  surface?: Point3;
  surfaceNormal?: Point3;
};
export type CandyBody = Point3 & {
  pointerPending?: boolean;
  contactHeld?: boolean;
  captureCooldown?: number;
  pigment?: import('./studio-pigment.ts').PigmentId;
  id: number;
  hex: string;
  kind: CandyKind;
  radius: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  compression: number;
  compressionV: number;
  contactCompression?: number;
  compressionAxis?: [number, number, number];
  sleeping: boolean;
  still: number;
  mode: 'free' | 'held' | 'mouth' | 'merging';
  age: number;
  melt?: number;
};
export type CandyCollider = Point3 & {
  mouth: Point3;
  edibleId: number | null;
  capture?: (candy: CandyBody, point: Point3, normal: Point3) => boolean;
  width?: number;
  height?: number;
  contact?: (p: Point3, radius: number) => CandyCollision | null;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const restitution = (c: CandyBody) =>
  c.kind === 'gummy' ? 0.24 : c.kind === 'cube' ? 0.42 : 0.61;
/** Analytic support of the rotated rounded cube. No visual scale correction. */
export function candySupport(c: CandyBody, n: Point3): number {
  if (c.kind !== 'cube') return c.radius;
  const a = Math.cos(c.rx),
    b = Math.sin(c.rx),
    d = Math.cos(c.ry),
    e = Math.sin(c.ry),
    f = Math.cos(c.rz),
    g = Math.sin(c.rz);
  const x = n.x * d * f + n.y * (a * g + b * f * e) + n.z * (b * g - a * f * e);
  const y =
    -n.x * d * g + n.y * (a * f - b * g * e) + n.z * (b * f + a * g * e);
  const z = n.x * e - n.y * b * d + n.z * a * d;
  const bevel = candyBevel(c.kind, c.radius);
  return (c.radius - bevel) * (Math.abs(x) + Math.abs(y) + Math.abs(z)) + bevel;
}
const up = { x: 0, y: 1, z: 0 };

// Fixed-step contact impulses, friction and sleep are independent of rendering.
// Small convex candies use a rounded contact proxy; gummy shape modes preserve
// volume while dissipating more impact energy than the rigid candy does.
export class CandyWorld {
  candies: CandyBody[] = [];
  heldId: number | null = null;
  bounds = { x: 3.3, zMin: -0.7, zMax: 2.8 };
  impacts: {
    position: Point3;
    strength: number;
    kind: CandyKind;
    body: boolean;
  }[] = [];
  private nextId = 1;
  private time = 0;
  private accumulator = 0;
  private lastMove = 0;
  private target: Point3 = { x: 0, y: 1, z: 1 };
  private handVelocity: Point3 = { x: 0, y: 0, z: 0 };
  private confined(p: Point3, radius: number): Point3 {
    return {
      x: clamp(p.x, -this.bounds.x + radius, this.bounds.x - radius),
      y: Math.max(radius, p.y),
      z: clamp(p.z, this.bounds.zMin + radius, this.bounds.zMax - radius),
    };
  }
  spawn(
    hex: string,
    kind: CandyKind,
    position: Point3,
    velocity: Point3 = { x: 0, y: 0, z: 0 },
    radius = BASE_CANDY_RADIUS,
  ): CandyBody {
    radius = Number.isFinite(radius)
      ? clamp(radius, 0.04, 0.3)
      : BASE_CANDY_RADIUS;
    const id = this.nextId++;
    const c: CandyBody = {
      ...this.confined(position, radius),
      id,
      hex,
      kind,
      radius,
      vx: velocity.x,
      vy: velocity.y,
      vz: velocity.z,
      rx: id * 0.81,
      ry: id * 1.71,
      rz: id * 0.37,
      wx: velocity.z * 3,
      wy: ((id % 3) - 1) * 2,
      wz: -velocity.x * 3,
      compression: 0,
      compressionV: 0,
      sleeping: false,
      still: 0,
      mode: 'free',
      age: 0,
    };
    c.y = Math.max(candySupport(c, up), c.y);
    this.candies.push(c);
    return c;
  }
  get(id: number | null) {
    return this.candies.find((c) => c.id === id);
  }
  grab(id: number) {
    const c = this.get(id);
    if (
      !c ||
      c.mode === 'mouth' ||
      c.mode === 'merging' ||
      this.heldId !== null
    )
      return false;
    this.heldId = id;
    c.mode = 'held';
    c.sleeping = false;
    c.still = 0;
    this.target = { x: c.x, y: c.y, z: c.z };
    this.handVelocity = { x: 0, y: 0, z: 0 };
    this.lastMove = this.time;
    return true;
  }
  moveHeld(p: Point3, dt: number) {
    if (this.heldId === null) return;
    const bounded = this.confined(p, this.get(this.heldId)!.radius);
    const elapsed = clamp(dt, 0.008, 0.1);
    for (const key of ['x', 'y', 'z'] as const) {
      const velocity = clamp(
        (bounded[key] - this.target[key]) / elapsed,
        -7,
        7,
      );
      this.handVelocity[key] += (velocity - this.handVelocity[key]) * 0.68;
    }
    this.target = bounded;
    this.lastMove = this.time;
  }
  release() {
    const c = this.get(this.heldId);
    this.heldId = null;
    if (!c) return;
    if (c.mode === 'merging') return;
    const fresh = this.time - this.lastMove < 0.14;
    c.mode = 'free';
    c.sleeping = false;
    c.still = 0;
    c.vx = fresh ? this.handVelocity.x : 0;
    c.vy = fresh ? this.handVelocity.y : 0;
    c.vz = fresh ? this.handVelocity.z : 0;
    c.wx = c.vz * 3 + 0.4;
    c.wy = c.vx * 1.3;
    c.wz = -c.vx * 3;
  }
  take(id: number) {
    const c = this.get(id);
    if (!c || c.mode === 'mouth') return false;
    if (this.heldId === id) this.heldId = null;
    c.mode = 'mouth';
    c.vx = c.vy = c.vz = 0;
    return true;
  }
  remove(id: number) {
    if (this.heldId === id) this.heldId = null;
    this.candies = this.candies.filter((c) => c.id !== id);
  }
  reset() {
    this.candies = [];
    this.heldId = null;
    this.accumulator = 0;
    this.impacts = [];
  }
  advance(dt: number, body?: CandyCollider) {
    this.impacts = [];
    this.accumulator += clamp(dt, 0, 0.1);
    while (this.accumulator >= 1 / 120) {
      this.step(1 / 120, body);
      this.accumulator -= 1 / 120;
    }
  }
  private impact(c: CandyBody, strength: number, body = false) {
    if (!body) c.compressionAxis = undefined;
    if (c.kind === 'gummy') c.compressionV += Math.min(7, strength * 1.9);
    if (strength > 0.45)
      this.impacts.push({
        position: { x: c.x, y: c.y, z: c.z },
        strength,
        kind: c.kind,
        body,
      });
  }
  private step(dt: number, body?: CandyCollider) {
    this.time += dt;
    for (const c of this.candies) {
      c.age += dt;
      c.captureCooldown = Math.max(0, (c.captureCooldown ?? 0) - dt);
      const compressionTarget =
        c.kind === 'gummy' && (c.mode === 'merging' || c.contactHeld)
          ? clamp(c.contactCompression ?? 0, 0, 0.22)
          : 0;
      if (c.kind === 'gummy') {
        c.compressionV +=
          (230 * (compressionTarget - c.compression) - 14 * c.compressionV) *
          dt;
        c.compression = clamp(c.compression + c.compressionV * dt, -0.14, 0.38);
      } else c.compression = c.compressionV = 0;
      if (c.mode === 'mouth' || c.mode === 'merging' || c.contactHeld) continue;
      if (c.mode === 'held') {
        for (const key of ['x', 'y', 'z'] as const) {
          const vk = `v${key}` as 'vx' | 'vy' | 'vz';
          c[vk] += ((this.target[key] - c[key]) * 900 - c[vk] * 45) * dt;
          c[key] += c[vk] * dt;
        }
        const bounded = this.confined(c, c.radius);
        for (const key of ['x', 'y', 'z'] as const) {
          if (c[key] !== bounded[key]) {
            c[key] = bounded[key];
            c[`v${key}`] = 0;
          }
        }
        if (body?.contact) this.collideBody(c, body);
        c.ry += c.vx * dt * 0.55;
        c.rz -= c.vx * dt * 0.5;
        c.y = Math.max(candySupport(c, up), c.y);
        continue;
      }
      if (!c.sleeping) {
        c.vy -= 6.8 * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
        c.rx += c.wx * dt;
        c.ry += c.wy * dt;
        c.rz += c.wz * dt;
        const floor = candySupport(c, up);
        if (c.y <= floor) {
          const hit = Math.max(0, -c.vy);
          c.y = floor;
          c.vy = hit > 0.24 ? hit * restitution(c) : 0;
          if (hit > 0.24) this.impact(c, hit);
          const friction = Math.exp(-dt * (roundCandy(c.kind) ? 3.2 : 7));
          c.vx *= friction;
          c.vz *= friction;
          const roll = roundCandy(c.kind) ? 0.4 : 0.12;
          c.wx += ((c.vz / c.radius) * roll - c.wx) * dt * 12;
          c.wz += ((-c.vx / c.radius) * roll - c.wz) * dt * 12;
          c.wy *= Math.exp(-dt * 5);
          if (c.kind === 'cube' && hit < 0.8) {
            // Face-down settling is angular motion, never a squashed mesh.
            for (const key of ['rx', 'rz'] as const) {
              const angle = c[key],
                target = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
              c[key] += (target - angle) * (1 - Math.exp(-dt * 12));
            }
            c.wx *= Math.exp(-dt * 12);
            c.wz *= Math.exp(-dt * 12);
            c.y = candySupport(c, up);
          }
        }
        for (const [key, vk, lo, hi] of [
          ['x', 'vx', -this.bounds.x + c.radius, this.bounds.x - c.radius],
          ['z', 'vz', this.bounds.zMin + c.radius, this.bounds.zMax - c.radius],
        ] as const) {
          if (c[key] < lo || c[key] > hi) {
            c[key] = clamp(c[key], lo, hi);
            c[vk] *= -0.46;
          }
        }
      }
      if (body) this.collideBody(c, body);
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.candies.length; i++)
        for (let j = i + 1; j < this.candies.length; j++) {
          const a = this.candies[i],
            b = this.candies[j];
          if (
            a.mode !== 'free' ||
            b.mode !== 'free' ||
            a.contactHeld ||
            b.contactHeld ||
            (a.sleeping && b.sleeping)
          )
            continue;
          const dx = b.x - a.x,
            dy = b.y - a.y,
            dz = b.z - a.z;
          const r = a.radius + b.radius,
            d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= r * r) continue;
          const distance = Math.sqrt(d2),
            d = Math.max(0.0001, distance);
          const nx = distance > 0.0001 ? dx / d : 1,
            ny = distance > 0.0001 ? dy / d : 0,
            nz = distance > 0.0001 ? dz / d : 0;
          const overlap = (r - distance) * 0.51;
          a.x -= nx * overlap;
          a.y = Math.max(a.radius, a.y - ny * overlap);
          a.z -= nz * overlap;
          b.x += nx * overlap;
          b.y = Math.max(b.radius, b.y + ny * overlap);
          b.z += nz * overlap;
          const closing =
            (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
          if (closing < -0.015) {
            const impulse =
              -(1 + Math.min(restitution(a), restitution(b))) * closing * 0.5;
            a.vx -= nx * impulse;
            a.vy -= ny * impulse;
            a.vz -= nz * impulse;
            b.vx += nx * impulse;
            b.vy += ny * impulse;
            b.vz += nz * impulse;
            a.sleeping = b.sleeping = false;
            a.still = b.still = 0;
            a.wy += impulse * nz * 3;
            b.wy -= impulse * nx * 3;
            this.impact(a, impulse);
            this.impact(b, impulse);
          }
        }
    }
    for (const c of this.candies)
      if (c.mode === 'free' && !c.sleeping) {
        const still =
          c.y < candySupport(c, up) + 0.012 &&
          Math.hypot(c.vx, c.vy, c.vz) < 0.055;
        c.still = still ? c.still + dt : 0;
        if (c.still > 0.65) {
          c.sleeping = true;
          c.vx = c.vy = c.vz = c.wx = c.wy = c.wz = 0;
        }
      }
  }
  private collideBody(c: CandyBody, b: CandyCollider) {
    // Leave an actual mouth-sized contact opening for the selected treat.
    if (
      c.id === b.edibleId &&
      Math.hypot(c.x - b.mouth.x, c.y - b.mouth.y, c.z - b.mouth.z) < 0.32
    )
      return;
    if (b.contact) {
      const hit = b.contact(c, c.radius);
      if (!hit) return;
      if (
        c.mode === 'free' &&
        !c.contactHeld &&
        !c.pointerPending &&
        !c.captureCooldown &&
        b.capture?.(
          c,
          hit.surface ?? {
            x: hit.position.x - hit.normal.x * (c.radius + 0.025),
            y: hit.position.y - hit.normal.y * (c.radius + 0.025),
            z: hit.position.z - hit.normal.z * (c.radius + 0.025),
          },
          hit.surfaceNormal ?? hit.normal,
        )
      )
        return;
      c.x = hit.position.x;
      c.y = Math.max(c.radius, hit.position.y);
      c.z = hit.position.z;
      this.resolveBodyImpulse(c, hit.normal);
      return;
    }
    const sx = (b.width ?? 1.46) + c.radius,
      sy = (b.height ?? 1.18) + c.radius,
      sz = 1.02 + c.radius;
    const dx = c.x - b.x,
      dy = c.y - (b.y + 1.14),
      dz = c.z - b.z;
    const q = Math.sqrt((dx / sx) ** 2 + (dy / sy) ** 2 + (dz / sz) ** 2);
    if (q >= 1 || q < 0.001) return;
    const nx = dx / (sx * sx),
      ny = dy / (sy * sy),
      nz = dz / (sz * sz),
      length = Math.hypot(nx, ny, nz) || 1;
    const normal = { x: nx / length, y: ny / length, z: nz / length };
    c.x = b.x + dx / q;
    c.y = Math.max(c.radius, b.y + 1.14 + dy / q);
    c.z = b.z + dz / q;
    this.resolveBodyImpulse(c, normal);
  }
  private resolveBodyImpulse(c: CandyBody, normal: Point3) {
    const closing = c.vx * normal.x + c.vy * normal.y + c.vz * normal.z;
    if (closing < 0) {
      const j = -closing * 1.2;
      c.vx += normal.x * j;
      c.vy += normal.y * j;
      c.vz += normal.z * j;
      this.impact(c, -closing, true);
    }
    c.sleeping = false;
    c.still = 0;
  }
}
