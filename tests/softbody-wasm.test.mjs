import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { characterFixture } from './softbody-fixture.mjs';

test('WASM hot loops match the original solver through floor impact and dragging', async () => {
  const { cage } = characterFixture();
  const js = new VolumeSoftBody(cage),
    wasm = new VolumeSoftBody(cage);
  const bytes = readFileSync(
    new URL('../public/physics/volume.wasm', import.meta.url),
  );
  await wasm.accelerate(bytes);
  for (const body of [js, wasm]) body.kick(0.2, 2.7, -0.1);
  for (let frame = 0; frame < 180; frame++) {
    if (frame === 20) for (const body of [js, wasm]) body.setMaterial(96, 3);
    if (frame === 70) for (const body of [js, wasm]) body.setMaterial(600, 48);
    if (frame === 95)
      for (const body of [js, wasm]) {
        body.grab(20, body.x.slice(60, 63), 0.6);
        body.moveGrab([0.3, 2.3, 0.2]);
      }
    if (frame === 125) for (const body of [js, wasm]) body.release();
    // A rotated visible skin needs a lower lattice support plane. Both backends
    // must resolve identical contacts, including a changing plane during roll.
    for (const body of [js, wasm]) body.setFloorLevel(frame > 135 ? -0.2 : 0);
    js.advance(1 / 60);
    wasm.advance(1 / 60);
    const error = Math.max(
      ...js.x.map((value, i) => Math.abs(value - wasm.x[i])),
    );
    assert.ok(error < 1e-9, `frame ${frame} maximum positional error ${error}`);
  }
  assert.ok(wasm.stats().minJacobian > 0.12);
});
