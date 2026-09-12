import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import {
  DEFAULT_FEEL,
  normalizeFeel,
  physicalFeel,
  parseSavedFeel,
} from '../lib/softbody/tuning.ts';
import { characterFixture } from './softbody-fixture.mjs';
import { Mesh, PerspectiveCamera } from 'three/webgpu';
import { VolumeInteraction } from '../lib/softbody/interaction.ts';
const bytes = readFileSync(
  new URL('../public/physics/volume.wasm', import.meta.url),
);
function interaction() {
  const { body, profile, bubbles } = characterFixture();
  const mesh = new Mesh(body);
  mesh.userData.optical_profile = JSON.stringify(profile);
  return new VolumeInteraction(
    { style: {}, hasPointerCapture: () => false },
    new PerspectiveCamera(),
    mesh,
    [mesh],
    bubbles,
  );
}
test('jump height produces distinct actual flight and compensates different gravity', async () => {
  const peaks = [];
  for (const [jump, gravity] of [
    [10, 50],
    [90, 50],
    [50, 0],
    [50, 100],
  ]) {
    const v = interaction();
    await v.solver.accelerate(bytes);
    v.setTuning({ ...DEFAULT_FEEL, jump, gravity });
    const mean = () => {
      let y = 0;
      for (let i = 1; i < v.solver.x.length; i += 3)
        y += v.solver.x[i] / v.solver.nodeCount;
      return y;
    };
    const start = mean();
    v.drop();
    let peak = 0;
    for (let k = 0; k < 720; k++) {
      v.solver.step(1 / 240);
      peak = Math.max(peak, mean() - start);
    }
    peaks.push(peak);
  }
  assert.ok(peaks[1] > peaks[0] * 2, JSON.stringify(peaks));
  assert.ok(Math.abs(peaks[2] - peaks[3]) < 0.1, JSON.stringify(peaks));
});
test('deeper poke changes deformation, and reset retains the selected feel', async () => {
  const heights = [];
  for (const press of [0, 100]) {
    const v = interaction();
    await v.solver.accelerate(bytes);
    v.setTuning({ ...DEFAULT_FEEL, press, grip: 75 });
    v.poke();
    for (let k = 0; k < 60; k++) v.solver.step(1 / 240);
    const crown = [];
    for (let i = 0; i < v.solver.nodeCount; i++)
      if (
        v.solver.rest[i * 3 + 1] > 1.9 &&
        v.solver.rest[i * 3] ** 2 + v.solver.rest[i * 3 + 2] ** 2 < 0.2
      )
        crown.push(v.solver.x[i * 3 + 1]);
    heights.push(crown.reduce((a, b) => a + b, 0) / crown.length);
    v.reset();
    assert.equal(v.stats().tuning.press, press);
    assert.deepEqual(v.solver.x, v.solver.rest);
  }
  assert.ok(heights[0] - heights[1] > 0.1, JSON.stringify(heights));
});
test('extreme soft crown and strong grip recover after the recorded rapid-grab sequence', async () => {
  const { sequence } = JSON.parse(
    readFileSync(new URL('fixtures/rapid-grab-freeze.json', import.meta.url)),
  );
  for (const settings of [
    {
      stiffness: 0,
      damping: 0,
      crown: 100,
      grip: 100,
      radius: 100,
      gravity: 100,
      bounce: 100,
      friction: 0,
    },
    {
      stiffness: 100,
      damping: 100,
      crown: 0,
      grip: 100,
      radius: 0,
      gravity: 0,
      bounce: 100,
      friction: 100,
    },
  ]) {
    const s = await body(settings),
      p = physicalFeel({ ...DEFAULT_FEEL, ...settings });
    for (const { id, target, steps } of sequence) {
      s.grab(id, s.x.slice(id * 3, id * 3 + 3), p.gripRadius);
      s.moveGrab(target);
      for (let k = 0; k < steps; k++) s.step(1 / 240);
      s.release();
      for (let k = 0; k < 10; k++) s.step(1 / 240);
    }
    for (let k = 0; k < 2880; k++) s.step(1 / 240);
    const result = s.stats();
    assert.ok(s.x.every(Number.isFinite));
    assert.ok(result.minJacobian > 0.55, JSON.stringify({ settings, result }));
    assert.ok(Math.abs(result.volumeRatio - 1) < 0.04);
  }
});
async function body(overrides = {}) {
  const s = new VolumeSoftBody(characterFixture().cage);
  await s.accelerate(bytes);
  const p = physicalFeel({ ...DEFAULT_FEEL, ...overrides });
  s.setMaterial(p.shear, p.damping, p.crownSoftness);
  s.setDynamics(p);
  return s;
}
test('saved decimal tuning is bounded and defaults preserve original mechanics', () => {
  const p = physicalFeel(DEFAULT_FEEL);
  assert.equal(p.shear, 240);
  assert.equal(p.damping, 12);
  assert.equal(p.gravity, 5);
  assert.equal(p.gripStrength, 70000);
  assert.equal(p.restitution, 0);
  assert.equal(p.friction, 10);
  const v = normalizeFeel({
    stiffness: 32.76,
    damping: NaN,
    jump: 120,
    gravity: -1,
  });
  assert.equal(v.stiffness, 32.8);
  assert.equal(v.damping, 50);
  assert.equal(v.jump, 100);
  assert.equal(v.gravity, 0);
  assert.deepEqual(
    parseSavedFeel(JSON.stringify({ version: 1, values: v })),
    v,
  );
  assert.equal(parseSavedFeel('{oops'), null);
  assert.equal(parseSavedFeel('{"version":2,"values":{}}'), null);
});
test('live gravity changes free fall without changing rest geometry', async () => {
  const low = await body({ gravity: 0 }),
    high = await body({ gravity: 100 });
  for (const s of [low, high])
    for (let i = 1; i < s.x.length; i += 3) s.x[i] += 4;
  for (let k = 0; k < 60; k++) for (const s of [low, high]) s.step(1 / 240);
  assert.ok(low.x[1] - high.x[1] > 0.2);
  assert.deepEqual(low.rest, high.rest);
});
test('top softness changes crown response while preserving the rest silhouette', async () => {
  const a = await body({ crown: 0 }),
    b = await body({ crown: 100 });
  for (const s of [a, b]) {
    s.setDynamics({ gravity: 0 });
    for (let i = 0; i < s.nodeCount; i++) {
      s.x[3 * i + 1] += 3;
      s.velocity[3 * i] = Math.max(0, s.rest[3 * i + 1] - 1.5) * 2;
    }
  }
  for (let k = 0; k < 90; k++) for (const s of [a, b]) s.step(1 / 240);
  const delta = Math.max(...a.x.map((v, i) => Math.abs(v - b.x[i])));
  assert.ok(delta > 0.005, `crown displacement difference ${delta}`);
  assert.deepEqual(a.rest, b.rest);
});
test('floor restitution changes whole-body rebound and settles without added resting energy', async () => {
  const peaks = [];
  for (const bounce of [0, 100]) {
    const s = await body({ bounce });
    for (let k = 0; k < 720; k++) s.step(1 / 240);
    for (let i = 1; i < s.x.length; i += 3) s.x[i] += 1.2;
    s.kick(0, 0, 0);
    let impact = false,
      peak = 0;
    for (let k = 0; k < 2400; k++) {
      s.step(1 / 240);
      const floor = Math.min(...s.x.filter((_, i) => i % 3 === 1));
      if (floor < 1e-8) impact = true;
      if (impact) peak = Math.max(peak, floor);
    }
    peaks.push(peak);
    assert.ok(s.stats().minJacobian > 0.55);
    assert.ok(s.stats().kineticEnergy < 0.01, 'no artificial resting energy');
  }
  assert.ok(peaks[1] > peaks[0] + 0.15, JSON.stringify(peaks));
});
test('higher table friction reduces tangential sliding at contact', async () => {
  const speeds = [];
  for (const friction of [0, 100]) {
    const s = await body({ friction });
    s.kick(2, -3, 0);
    s.step(1 / 240);
    let sum = 0,
      n = 0;
    for (let i = 0; i < s.nodeCount; i++)
      if (s.x[i * 3 + 1] < 1e-8) {
        sum += s.velocity[i * 3];
        n++;
      }
    speeds.push(sum / n);
  }
  assert.ok(speeds[1] < speeds[0], JSON.stringify(speeds));
});
