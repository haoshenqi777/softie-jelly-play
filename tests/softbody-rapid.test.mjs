import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { characterFixture } from './softbody-fixture.mjs';
const bytes = readFileSync(
  new URL('../public/physics/volume.wasm', import.meta.url),
);
test('recorded rapid-grab freeze escapes the 12 percent barrier and recovers', async () => {
  const { sequence } = JSON.parse(
    readFileSync(new URL('fixtures/rapid-grab-freeze.json', import.meta.url)),
  );
  const s = new VolumeSoftBody(characterFixture().cage);
  await s.accelerate(bytes);
  for (const { id, target, steps } of sequence) {
    s.grab(id, s.x.slice(id * 3, id * 3 + 3), 0.58);
    s.moveGrab(target);
    for (let i = 0; i < steps; i++) s.step(1 / 240);
    s.release();
    for (let i = 0; i < 10; i++) s.step(1 / 240);
  }
  for (let i = 0; i < 1440; i++) s.step(1 / 240);
  assert.ok(s.stats().minJacobian > 0.6, JSON.stringify(s.stats()));
});

test('rapid alternating grabs recover after release instead of sleeping at the barrier', async () => {
  for (const seed of [1, 7, 19, 42]) {
    const s = new VolumeSoftBody(characterFixture().cage);
    await s.accelerate(bytes);
    let randomState = seed;
    const random = () =>
      (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) /
      4294967296;
    for (let grab = 0; grab < 30; grab++) {
      const id = Math.floor(random() * s.nodeCount);
      s.grab(id, s.x.slice(id * 3, id * 3 + 3), 0.58);
      s.moveGrab([
        random() * 4 - 2,
        0.1 + random() * 3.15,
        random() * 3.6 - 1.8,
      ]);
      for (let step = 0; step < 18; step++) s.step(1 / 240);
      s.release();
      for (let step = 0; step < 4; step++) s.step(1 / 240);
    }
    for (let step = 0; step < 1920; step++) s.step(1 / 240);
    const stats = s.stats();
    assert.ok(
      stats.minJacobian > 0.6,
      `seed ${seed}: ${JSON.stringify(stats)}, sleeping=${s.sleeping}`,
    );
    assert.ok(Math.abs(stats.volumeRatio - 1) < 0.03);
  }
});
