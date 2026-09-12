type KernelExports = {
  memory: WebAssembly.Memory;
  init(nodes: number, tets: number): void;
  pointer(which: number): number;
  resetLambdas(): void;
  project(dt: number, reverse: number, bulk: number): void;
};
export type KernelState = {
  x: Float64Array;
  ids: Int32Array;
  inverseRest: Float64Array;
  volumes: Float64Array;
  invMass: Float64Array;
  mu: Float64Array;
};
export async function createVolumeKernel(
  bytes: BufferSource,
  state: KernelState,
) {
  const compiled = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(compiled, {
    env: {
      abort() {
        throw new Error('Soft-body WASM kernel aborted');
      },
    },
  });
  const api = instance.exports as unknown as KernelExports;
  api.init(state.x.length / 3, state.volumes.length);
  const arrays = [
    state.x,
    state.ids,
    state.inverseRest,
    state.volumes,
    state.invMass,
    state.mu,
  ];
  arrays.forEach((source, i) => {
    const Target = source instanceof Int32Array ? Int32Array : Float64Array;
    new Target(api.memory.buffer, api.pointer(i), source.length).set(source);
  });
  const positions = new Float64Array(
    api.memory.buffer,
    api.pointer(0),
    state.x.length,
  );
  return {
    updateMaterial() {
      new Float64Array(api.memory.buffer, api.pointer(5), state.mu.length).set(
        state.mu,
      );
    },
    reset() {
      api.resetLambdas();
    },
    project(dt: number, reverse: boolean, bulk: number, floorLevel = 0) {
      positions.set(state.x);
      // The kernel's plane is y=0. Translate its working buffer, not the render
      // mesh or rest shape; tetrahedral energies are translation invariant.
      if (floorLevel !== 0)
        for (let i = 1; i < positions.length; i += 3)
          positions[i] -= floorLevel;
      api.project(dt, reverse ? 1 : 0, bulk);
      if (floorLevel !== 0)
        for (let i = 1; i < positions.length; i += 3)
          positions[i] += floorLevel;
      state.x.set(positions);
    },
  };
}
export type VolumeKernel = Awaited<ReturnType<typeof createVolumeKernel>>;
