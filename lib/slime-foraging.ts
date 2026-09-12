const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
type BodyState = {
  x: number;
  y: number;
  mouthX: number;
  mouthY: number;
  bound: number;
};

// Find the treat, crouch and hop. The silhouette stays round; the mouth only
// reaches the last little distance. A bite always depends on actual contact.
export class SlimeForaging {
  active = false;
  ready = false;
  age = 0;
  distance = Infinity;
  miss = 0;
  drive: number | null = null;
  hop: { x: number; height: number } | null = null;
  target = { x: 0, y: 1.025 };
  pose = { lean: 0, squash: 0, oval: 0, reachX: 0, reachY: 0 };
  private contact = 0;
  private wasClose = false;
  private lastHop = -1;
  private gather = 0;
  offer(x: number, y: number) {
    this.cancel();
    this.active = true;
    this.target = { x, y };
  }
  move(x: number, y: number) {
    this.target = { x, y };
  }
  cancel() {
    this.active = this.ready = this.wasClose = false;
    this.age = this.contact = this.miss = this.gather = 0;
    this.lastHop = -1;
    this.distance = Infinity;
    this.drive = null;
    this.hop = null;
    this.pose = { lean: 0, squash: 0, oval: 0, reachX: 0, reachY: 0 };
  }
  advance(dt: number, body: BodyState) {
    this.hop = null;
    if (!this.active) return;
    const time = clamp(dt, 0, 0.1);
    this.age += time;
    this.miss = Math.max(0, this.miss - time * 1.3);
    this.distance = Math.hypot(
      this.target.x - body.mouthX,
      this.target.y - body.mouthY,
    );
    if (this.wasClose && this.distance > 0.55) this.miss = 1;
    this.wasClose = this.distance < 0.25;
    const dx = this.target.x - body.x;
    const destination = clamp(
      this.target.x - clamp(dx, -0.1, 0.1),
      -Math.min(body.bound, 2.3),
      Math.min(body.bound, 2.3),
    );
    const travel = destination - body.x;
    const wake = clamp((this.age - 0.22) / 0.3, 0, 1);
    const needsHop =
      Math.abs(travel) > 0.24 ||
      (this.target.y - body.y > 1.34 && this.distance > 0.14);
    if (
      needsHop &&
      body.y < 0.015 &&
      this.age - this.lastHop > 0.85 &&
      this.age > 0.4
    ) {
      this.gather += time;
      if (this.gather >= 0.2) {
        this.hop = {
          x: destination,
          height: clamp(this.target.y - 1.16, 0.17, 0.45),
        };
        this.lastHop = this.age;
        this.gather = 0;
      }
    } else this.gather = Math.max(0, this.gather - time * 3);
    // A tiny landing adjustment can cover the last pixels without another jump.
    this.drive = needsHop ? 0 : clamp(travel * 2.5, -0.4, 0.4) * wake;
    this.pose = {
      lean: clamp(dx * 0.05, -0.055, 0.055) * wake,
      squash: -0.11 * Math.sin((clamp(this.gather / 0.2, 0, 1) * Math.PI) / 2),
      oval: 0,
      reachX: clamp(dx * 0.7, -0.16, 0.16) * wake,
      reachY: clamp(this.target.y - body.y - 1.025, -0.23, 0.24) * wake,
    };
    this.contact =
      this.distance < 0.16 && this.age > 0.55 ? this.contact + time : 0;
    this.ready = this.contact >= 0.1;
  }
}
