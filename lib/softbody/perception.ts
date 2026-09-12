import type { VolumeSoftBody } from './solver.ts';
import type { CharacterEvent, V3 } from './behavior-types.ts';

/** Release provenance and physical center velocity; no screen-speed guesses. */
export class MotionPerception {
  private pending: { kind: 'down' | 'up' | 'cancel'; time: number } | null =
    null;
  private held = false;
  private origin: V3 = [0, 0, 0];
  observePointer(kind: 'down' | 'up' | 'cancel', time: number) {
    this.pending = { kind, time };
  }
  reset() {
    this.pending = null;
    this.held = false;
  }
  sample(s: VolumeSoftBody, _dt: number): CharacterEvent[] {
    const event = this.pending;
    this.pending = null;
    if (!event) return [];
    const center: V3 = [0, 0, 0],
      velocity: V3 = [0, 0, 0];
    let total = 0;
    for (let i = 0; i < s.nodeCount; i++) {
      const m = s.mass[i];
      total += m;
      for (let k = 0; k < 3; k++) {
        center[k] += s.x[i * 3 + k] * m;
        velocity[k] += s.velocity[i * 3 + k] * m;
      }
    }
    for (let k = 0; k < 3; k++) {
      center[k] /= total;
      velocity[k] /= total;
    }
    if (event.kind === 'down') {
      this.held = true;
      this.origin = center;
      return [{ kind: 'grab', time: event.time }];
    }
    if (event.kind === 'cancel') {
      this.held = false;
      return [{ kind: 'cancel', time: event.time }];
    }
    if (!this.held) return [];
    this.held = false;
    return [
      {
        kind: 'release',
        time: event.time,
        velocity,
        carriedDistance: Math.hypot(
          ...center.map((v, k) => v - this.origin[k]),
        ),
        valid: true,
      },
    ];
  }
}
