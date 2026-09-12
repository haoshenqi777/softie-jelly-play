/** Consume the latest input at the start of the next render, before physics.
 * Pointer up flushes it first; cancellation discards it instead. */
export class FramePointerInput<T extends { pointerId: number } = PointerEvent> {
  private pending = new Map<number, T>();
  push(event: T) {
    this.pending.set(event.pointerId, event);
  }
  flush(consume: (event: T) => void) {
    if (!this.pending.size) return;
    const events = [...this.pending.values()];
    this.pending.clear();
    for (const event of events) consume(event);
  }
  clear() {
    this.pending.clear();
  }
  drop(pointerId: number) {
    this.pending.delete(pointerId);
  }
}

/** All canvas touches are tracked so a second finger can take over the camera. */
export class TouchOrbit {
  private points = new Map<number, { x: number; y: number }>();
  get size() {
    return this.points.size;
  }
  get ids() {
    return this.points.keys();
  }
  has(id: number) {
    return this.points.has(id);
  }
  down(id: number, x: number, y: number) {
    this.points.set(id, { x, y });
  }
  up(id: number) {
    this.points.delete(id);
  }
  clear() {
    this.points.clear();
  }
  move(id: number, x: number, y: number) {
    const p = this.points.get(id);
    if (!p) return null;
    const other = [...this.points.entries()].find(([key]) => key !== id)?.[1];
    const before = other ? Math.hypot(p.x - other.x, p.y - other.y) : 0;
    const after = other ? Math.hypot(x - other.x, y - other.y) : 0;
    const delta =
      this.points.size === 2
        ? {
            x: (x - p.x) / 2,
            y: (y - p.y) / 2,
            zoom: before > 8 && after > 8 ? before / after : 1,
          }
        : null;
    this.points.set(id, { x, y });
    return delta;
  }
}
