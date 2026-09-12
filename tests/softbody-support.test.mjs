import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import * as tuning from '../lib/softbody/tuning.ts';
import { characterFixture } from './softbody-fixture.mjs';

const bytes = readFileSync(
  new URL('../public/physics/volume.wasm', import.meta.url),
);

test('narrowing the soft crown changes the simulated response and is reversible in WASM', async () => {
  const cage = characterFixture().cage;
  const original = new VolumeSoftBody(cage, { gravity: 0 });
  const narrow = new VolumeSoftBody(cage, { gravity: 0 });
  for (const s of [original, narrow]) await s.accelerate(bytes);
  original.setMaterial(360, 12, 0.55, 0.35);
  narrow.setMaterial(360, 12, 0.55, 0.22);
  const excite = (s) => {
    for (let i = 0; i < s.nodeCount; i++) {
      s.x[i * 3 + 1] += 3;
      s.velocity[i * 3] = Math.max(0, s.rest[i * 3 + 1] - 1.5) * 2;
    }
  };
  for (const s of [original, narrow]) excite(s);
  let difference = 0;
  for (let k = 0; k < 90; k++) {
    for (const s of [original, narrow]) s.step(1 / 240);
    difference = Math.max(
      difference,
      ...original.x.map((v, i) => Math.abs(v - narrow.x[i])),
    );
  }
  assert.ok(difference > 0.002, `crown range must reach solver: ${difference}`);
  assert.deepEqual(original.rest, narrow.rest);
  // Returning to the original material must restore the same physical response.
  for (const s of [original, narrow]) {
    s.reset();
    s.setMaterial(360, 12, 0.55, 0.35);
    excite(s);
  }
  for (let k = 0; k < 90; k++)
    for (const s of [original, narrow]) s.step(1 / 240);
  assert.deepEqual(original.x, narrow.x);
});

test('support comparisons isolate variables and retain a saved decimal baseline', () => {
  assert.equal(typeof tuning.supportVariants, 'function');
  const base = tuning.normalizeFeel({
    stiffness: 32.7,
    damping: 64.2,
    jump: 100,
  });
  const variants = tuning.supportVariants(base);
  assert.deepEqual(variants.original, base);
  assert.ok(variants.support.stiffness > base.stiffness);
  for (const key of Object.keys(base)) {
    if (key !== 'stiffness')
      assert.equal(variants.support[key], base[key], key);
    if (key !== 'crownRange')
      assert.equal(variants.crown[key], variants.support[key], key);
  }
  assert.ok(variants.crown.crownRange < base.crownRange);
  variants.original.jump = 0;
  assert.equal(
    base.jump,
    100,
    'comparison must not mutate original preferences',
  );
  const legacy = tuning.parseSavedFeel(
    JSON.stringify({ version: 1, values: { stiffness: 32.7 } }),
  );
  assert.equal(tuning.physicalFeel(legacy).crownSpan, 0.35);
});

test('support comparison carries more weight without changing rest shape or damping', async () => {
  assert.equal(typeof tuning.supportVariants, 'function');
  const variants = tuning.supportVariants(tuning.DEFAULT_FEEL);
  const cage = characterFixture().cage;
  const heights = [];
  for (const settings of [
    variants.original,
    variants.support,
    variants.crown,
  ]) {
    const s = new VolumeSoftBody(cage);
    await s.accelerate(bytes);
    const p = tuning.physicalFeel(settings);
    s.setMaterial(p.shear, p.damping, p.crownSoftness, p.crownSpan);
    s.setDynamics(p);
    for (let k = 0; k < 720; k++) s.step(1 / 240);
    heights.push(Math.max(...s.x.filter((_, i) => i % 3 === 1)));
    assert.ok(Math.abs(s.stats().volumeRatio - 1) < 0.02);
    assert.ok(s.stats().minJacobian > 0.55);
    assert.deepEqual(s.rest, Float64Array.from(cage.positions));
  }
  assert.ok(heights[1] > heights[0] + 0.002, JSON.stringify(heights));
  assert.ok(heights[2] >= heights[1], JSON.stringify(heights));
  console.log('support comparison settled heights:', heights);
});
