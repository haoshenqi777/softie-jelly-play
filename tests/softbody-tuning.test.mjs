import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { characterFixture } from './softbody-fixture.mjs';
const bytes = readFileSync(
  new URL('../public/physics/volume.wasm', import.meta.url),
);

test('live stiffness changes mechanical support without replacing the rest mesh', async () => {
  const { cage } = characterFixture();
  const soft = new VolumeSoftBody(cage),
    firm = new VolumeSoftBody(cage);
  for (const s of [soft, firm]) await s.accelerate(bytes);
  soft.setMaterial(96, 12);
  firm.setMaterial(600, 12);
  for (let i = 0; i < 720; i++) for (const s of [soft, firm]) s.step(1 / 240);
  const height = (s) =>
    Math.max(...Array.from({ length: s.nodeCount }, (_, i) => s.x[i * 3 + 1]));
  assert.ok(height(firm) - height(soft) > 0.015);
  assert.deepEqual(soft.rest, firm.rest);
  for (const s of [soft, firm])
    assert.ok(Math.abs(s.stats().volumeRatio - 1) < 0.02);
});

test('higher live damping dissipates deformation velocity faster', async () => {
  const { cage } = characterFixture();
  const low = new VolumeSoftBody(cage, { gravity: 0 }),
    high = new VolumeSoftBody(cage, { gravity: 0 });
  for (const s of [low, high]) {
    await s.accelerate(bytes);
    for (let i = 0; i < s.nodeCount; i++) {
      s.x[i * 3 + 1] += 2;
      // Symmetric extension excites strain rather than rigid-body rotation;
      // physical strain damping intentionally preserves angular momentum.
      s.velocity[i * 3] = 0.4 * s.rest[i * 3];
    }
  }
  low.setMaterial(240, 3);
  high.setMaterial(240, 48);
  let eLow = 0,
    eHigh = 0;
  for (let i = 0; i < 360; i++) {
    low.step(1 / 240);
    high.step(1 / 240);
    if (i > 240) {
      eLow += low.stats().kineticEnergy;
      eHigh += high.stats().kineticEnergy;
    }
  }
  assert.ok(eHigh < eLow * 0.8, `${eHigh} vs ${eLow}`);
});
