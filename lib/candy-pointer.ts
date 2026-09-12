type Drag = {
  id: number;
  index: number;
  x: number;
  y: number;
  dragging: boolean;
};
export class CandyPointer {
  active: Drag | null = null;
  private ignoredClicks = new Set<number>();
  begin(id: number, index: number, x: number, y: number) {
    this.ignoredClicks.delete(id);
    if (this.active) {
      this.ignoredClicks.add(id);
      return false;
    }
    this.active = { id, index, x, y, dragging: false };
    return true;
  }
  end(id: number) {
    if (this.active?.id !== id) return null;
    const drag = this.active;
    this.active = null;
    if (drag.dragging) this.ignoredClicks.add(id);
    return drag;
  }
  cancel(id: number) {
    if (this.active?.id !== id) return null;
    this.ignoredClicks.add(id);
    const drag = this.active;
    this.active = null;
    return drag;
  }
  reset(cancelOwned?: () => void) {
    const drag = this.active ? this.cancel(this.active.id) : null;
    if (drag?.dragging) cancelOwned?.();
    return drag;
  }
  allowClick(id: number | undefined, keyboard: boolean) {
    if (keyboard) return this.active === null;
    if (id !== undefined && this.ignoredClicks.delete(id)) return false;
    return this.active === null;
  }
}
