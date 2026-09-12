// Original regular-lattice embedding. The visible approved asset is never remeshed.
export type Binding = { ids: number[]; weights: number[] };
export type Cage = {
  positions: number[];
  tets: number[];
  volumes: number[];
  bind(point: ArrayLike<number>): Binding;
};

const permutations = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

export function createCage(
  profile: number[][],
  samples: ArrayLike<number>,
): Cage {
  const height = profile.at(-1)![3];
  const rx = Math.max(...profile.map((p) => p[0])) + 0.11;
  const rz = Math.max(...profile.map((p) => p[4])) + 0.11;
  const origin = [-rx, 0, -rz],
    cells = [9, 7, 8];
  const step = [(2 * rx) / cells[0], height / cells[1], (2 * rz) / cells[2]];
  const cellKey = (p: number[]) => p.join(',');
  const nodeKey = (p: number[]) =>
    p[0] + (cells[0] + 1) * (p[1] + (cells[1] + 1) * p[2]);
  const locate = (point: ArrayLike<number>) => {
    const index: number[] = [],
      fraction: number[] = [];
    for (let a = 0; a < 3; a++) {
      const u = (point[a] - origin[a]) / step[a];
      if (u < -1e-4 || u > cells[a] + 1e-4)
        throw new Error('Point outside soft-body lattice');
      index[a] = Math.min(cells[a] - 1, Math.max(0, Math.floor(u)));
      fraction[a] = Math.min(1, Math.max(0, u - index[a]));
    }
    return { index, fraction };
  };
  const occupied = new Map<string, number[]>();
  for (let i = 0; i < samples.length; i += 3) {
    const { index } = locate([samples[i], samples[i + 1], samples[i + 2]]);
    occupied.set(cellKey(index), index);
  }
  for (let y = 0; y < cells[1]; y++) {
    const h = (y + 0.5) / cells[1],
      p = profile[Math.round(h * (profile.length - 1))];
    for (let z = 0; z < cells[2]; z++)
      for (let x = 0; x < cells[0]; x++) {
        const px = origin[0] + (x + 0.5) * step[0],
          pz = origin[2] + (z + 0.5) * step[2];
        if ((px / p[0]) ** 2 + (pz / p[4]) ** 2 < 1)
          occupied.set(cellKey([x, y, z]), [x, y, z]);
      }
  }
  const positions: number[] = [],
    tets: number[] = [],
    volumes: number[] = [];
  const nodeIds = new Map<number, number>();
  const node = (p: number[]) => {
    const key = nodeKey(p);
    let id = nodeIds.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      nodeIds.set(key, id);
      positions.push(...p.map((v, a) => origin[a] + v * step[a]));
    }
    return id;
  };
  const tetraNodes = (index: number[], order: number[]) => {
    const b = [...index],
      c = [...index];
    b[order[0]]++;
    c[order[0]]++;
    c[order[1]]++;
    return [index, b, c, index.map((v) => v + 1)].map(node);
  };
  for (const index of occupied.values())
    for (const order of permutations) {
      const ids = tetraNodes(index, order);
      const inversions =
        (order[0] > order[1] ? 1 : 0) +
        (order[0] > order[2] ? 1 : 0) +
        (order[1] > order[2] ? 1 : 0);
      if (inversions % 2) [ids[1], ids[2]] = [ids[2], ids[1]];
      tets.push(...ids);
      volumes.push((step[0] * step[1] * step[2]) / 6);
    }
  return {
    positions,
    tets,
    volumes,
    bind(point) {
      const { index, fraction: f } = locate(point);
      if (!occupied.has(cellKey(index)))
        throw new Error('Surface point has no mechanical cell');
      const order = [0, 1, 2].sort((a, b) => f[b] - f[a]);
      return {
        ids: tetraNodes(index, order),
        weights: [
          1 - f[order[0]],
          f[order[0]] - f[order[1]],
          f[order[1]] - f[order[2]],
          f[order[2]],
        ],
      };
    },
  };
}
