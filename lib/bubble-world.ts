import type { Point3 } from './candy-physics';
export type BubbleKind = 'heart' | 'star';
export type ThoughtBubble = Point3 & {
  id: number;
  kind: BubbleKind;
  age: number;
  lifetime: number;
  popping: boolean;
  popAge: number;
};
export class BubbleWorld {
  bubbles: ThoughtBubble[] = [];
  private nextId = 1;
  emit(kind: BubbleKind, p: Point3): ThoughtBubble | null {
    if (this.bubbles.filter((b) => !b.popping).length >= 2) return null;
    const b = {
      ...p,
      id: this.nextId++,
      kind,
      age: 0,
      lifetime: kind === 'star' ? 1.5 : 3.2,
      popping: false,
      popAge: 0,
    };
    this.bubbles.push(b);
    return b;
  }
  pop(id: number) {
    const b = this.bubbles.find((b) => b.id === id);
    if (!b || b.popping) return false;
    b.popping = true;
    b.popAge = 0;
    return true;
  }
  advance(dt: number) {
    const t = Math.max(0, Math.min(0.1, dt));
    for (const b of this.bubbles) {
      b.age += t;
      b.y += t * 0.2;
      b.x += Math.sin(b.age * 3 + b.id) * t * 0.04;
      if (b.popping) b.popAge += t;
    }
    this.bubbles = this.bubbles.filter(
      (b) => b.age < b.lifetime && (!b.popping || b.popAge < 0.22),
    );
  }
  reset() {
    this.bubbles = [];
  }
}
