import type { Cage } from './cage.ts';

/** Correct the enclosing lattice's support plane to the embedded visible skin.
 * Spatial sampling leaves a conservative 8 mm margin. It does not move vertices. */
export class FloorSurface {
  private readonly ids: Uint16Array;
  private readonly weights: Float64Array;
  constructor(cage: Cage, positions: ArrayLike<number>) {
    const cells = new Set<string>(),
      ids: number[] = [],
      weights: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      const p = [positions[i], positions[i + 1], positions[i + 2]];
      const key = p.map((v) => Math.round(v / 0.08)).join(',');
      if (cells.has(key)) continue;
      cells.add(key);
      const b = cage.bind(p);
      ids.push(...b.ids);
      weights.push(...b.weights);
    }
    this.ids = Uint16Array.from(ids);
    this.weights = Float64Array.from(weights);
  }
  level(nodes: Float64Array): number {
    let cageMin = Infinity,
      skinMin = Infinity;
    for (let i = 1; i < nodes.length; i += 3)
      cageMin = Math.min(cageMin, nodes[i]);
    for (let i = 0; i < this.ids.length; i += 4) {
      let y = 0;
      for (let j = 0; j < 4; j++)
        y += nodes[this.ids[i + j] * 3 + 1] * this.weights[i + j];
      skinMin = Math.min(skinMin, y);
    }
    return Math.max(-0.75, Math.min(0, cageMin - skinMin + 0.008));
  }
}
