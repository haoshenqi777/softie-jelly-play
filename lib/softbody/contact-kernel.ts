export type SkinEdge = {
  a: number;
  b: number;
  c: number;
  d: number;
  angle: number;
  cosine: number;
  length: number;
};
type API = {
  memory: WebAssembly.Memory;
  init(n: number, indices: number, edges: number): void;
  pointer(k: number): number;
  bind(n: number, e: number, t: number): void;
  prepare(): void;
  prepareFrame(): void;
  project(): void;
  collisionPointer(k: number): number;
  bindCollision(n: number, t: number): void;
  regularize(passes: number, colliding: number, bound: number): void;
  wetting(nx: number, ny: number, nz: number, bound: number): number;
};
export async function createContactKernel(
  bytes: BufferSource,
  nodes: number,
  index: ArrayLike<number>,
  maxEdges: number,
) {
  const module = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(module, {
    env: {
      abort() {
        throw new Error('Contact kernel aborted');
      },
    },
  });
  const api = instance.exports as unknown as API;
  api.init(nodes, index.length, maxEdges);
  // All storage is allocated at init. Binding a different contact never grows memory.
  const f = (k: number, n: number) =>
    new Float64Array(api.memory.buffer, api.pointer(k), n);
  const base = f(0, nodes * 3),
    offset = f(1, nodes * 3),
    frames = f(6, (index.length / 3) * 4),
    degrees = f(7, nodes),
    edges = f(8, maxEdges * 7);
  const movable = new Uint8Array(api.memory.buffer, api.pointer(2), nodes),
    ids = new Int32Array(api.memory.buffer, api.pointer(3), nodes),
    triangles = new Int32Array(
      api.memory.buffer,
      api.pointer(5),
      index.length / 3,
    );
  new Uint32Array(api.memory.buffer, api.pointer(4), index.length).set(index);
  const candidates = new Int32Array(
      api.memory.buffer,
      api.collisionPointer(0),
      nodes,
    ),
    contactTriangles = new Int32Array(
      api.memory.buffer,
      api.collisionPointer(1),
      index.length / 3,
    ),
    shape = new Float64Array(api.memory.buffer, api.collisionPointer(2), 14),
    touched = new Uint8Array(api.memory.buffer, api.collisionPointer(3), nodes);
  return {
    bind(
      mask: Uint8Array,
      points: number[],
      selected: SkinEdge[],
      tris: number[],
    ) {
      movable.set(mask);
      ids.set(points);
      triangles.set(tris);
      for (let i = 0; i < selected.length; i++) {
        const e = selected[i],
          j = i * 7;
        edges[j] = e.a;
        edges[j + 1] = e.b;
        edges[j + 2] = e.c;
        edges[j + 3] = e.d;
        edges[j + 4] = e.angle;
        edges[j + 5] = e.cosine;
      }
      api.bind(points.length, selected.length, tris.length);
    },
    prepare(
      b: Float64Array,
      d: Float64Array,
      t: Float64Array,
      selected: SkinEdge[],
    ) {
      base.set(b);
      degrees.set(d);
      frames.set(t);
      for (let i = 0; i < selected.length; i++)
        edges[i * 7 + 6] = selected[i].length;
      api.prepare();
    },
    solve(value: Float64Array) {
      offset.set(value);
      api.project();
      value.set(offset);
    },
    prepareBase(value: Float64Array) {
      base.set(value);
      api.prepareFrame();
    },
    wetting(normal: Float64Array, bound: number) {
      return api.wetting(normal[0], normal[1], normal[2], bound);
    },
    regularize(
      value: Float64Array,
      points: number[],
      tris: number[],
      position: Float64Array,
      transform: Float64Array,
      half: number,
      radius: number,
      passes: number,
      colliding: boolean,
      bound: number,
    ) {
      candidates.set(points);
      contactTriangles.set(tris);
      api.bindCollision(points.length, tris.length);
      shape.set(position);
      shape.set(transform, 3);
      shape[12] = half;
      shape[13] = radius;
      offset.set(value);
      api.regularize(passes, colliding ? 1 : 0, bound);
      value.set(offset);
      return touched;
    },
  };
}
