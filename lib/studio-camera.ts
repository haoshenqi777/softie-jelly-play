export const STUDIO_TARGET_Y = 0.9;
export const STUDIO_VIEW_YAW = {
  front: 0,
  'three-quarter': -0.5,
  side: -Math.PI / 2,
} as const;

// Keep every authored pose visible, with the same visual scale as the concept.
export function studioCameraDistance(aspect: number) {
  const limitingHalfFov = Math.atan(
    Math.tan(Math.PI / 12) * Math.min(1, aspect),
  );
  return Math.max(7.5, 2 / Math.sin(limitingHalfFov)) * 1.06;
}

export const MOBILE_TARGET_Y = 1.14;
type Bounds = {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
};

/** A stationary target and a roomy lens dead zone keep small jiggles off-camera.
 * Large jumps can widen the lens; it settles back only after a quiet interval. */
export class FixedStudioFrame {
  private distance = 0;
  private renderedDistance = 0;
  private quiet = 0;
  reset() {
    this.distance = 0;
    this.renderedDistance = 0;
    this.quiet = 0;
  }
  update(
    dt: number,
    aspect: number,
    yaw: number,
    pitch: number,
    zoom: number,
    box: Bounds,
    held: boolean,
  ) {
    if (held && this.renderedDistance > 0) return this.renderedDistance;
    const base = studioCameraDistance(aspect) * 0.9;
    const tangent = Math.tan(Math.PI / 12);
    const sy = Math.sin(yaw),
      cy = Math.cos(yaw),
      sp = Math.sin(pitch),
      cp = Math.cos(pitch);
    let needed = base;
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const dy = y - MOBILE_TARGET_Y;
          const rx = x * cy - z * sy;
          const ry = -x * sy * sp + dy * cp - z * cy * sp;
          const depth = x * sy * cp + dy * sp + z * cy * cp;
          needed = Math.max(
            needed,
            Math.abs(rx) / (tangent * aspect * 0.93) + depth,
            Math.abs(ry) / (tangent * 0.89) + depth,
          );
        }
    // Deliberate pinch is immediate and independent of the automatic lens.
    // Keep exceptional jumps/travel visible even at the closest manual zoom.
    if (
      box.max.y > 3.25 ||
      Math.hypot((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2) > 1.2
    )
      needed /= Math.min(1, zoom);
    if (!this.distance || needed > this.distance) {
      this.distance = needed + 0.12;
      this.quiet = 0;
    } else if (needed < this.distance * 0.97) {
      this.quiet += dt;
      if (this.quiet > 0.65)
        this.distance +=
          (needed + 0.12 - this.distance) * (1 - Math.exp(-dt * 3));
    } else this.quiet = 0;
    this.renderedDistance = this.distance * zoom;
    return this.renderedDistance;
  }
}
