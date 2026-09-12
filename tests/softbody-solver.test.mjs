import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { characterFixture } from './softbody-fixture.mjs';

function grid(n = 3) {
  const positions = [],
    tets = [];
  const id = (x, y, z) => x + (n + 1) * (y + (n + 1) * z);
  for (let z = 0; z <= n; z++)
    for (let y = 0; y <= n; y++)
      for (let x = 0; x <= n; x++)
        positions.push(x / n - 0.5, y / n, z / n - 0.5);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        for (const p of [
          [0, 1, 2],
          [0, 2, 1],
          [1, 0, 2],
          [1, 2, 0],
          [2, 0, 1],
          [2, 1, 0],
        ]) {
          const q = [x, y, z];
          const ids = [id(...q)];
          for (const a of p) {
            q[a]++;
            ids.push(id(...q));
          }
          tets.push(...ids);
        }
      }
  return { positions, tets };
}
function finiteFloor(s) {
  assert.ok(s.x.every(Number.isFinite));
  for (let i = 1; i < s.x.length; i += 3) assert.ok(s.x[i] >= -1e-9);
  assert.ok(s.stats().minJacobian > 0.05, JSON.stringify(s.stats()));
}
function run(s, seconds) {
  for (let i = 0; i < Math.round(seconds * 240); i++) s.step(1 / 240);
}
test('zero gravity preserves rest equilibrium and identity deformation gradients', () => {
  const s = new VolumeSoftBody(grid(), { gravity: 0 });
  run(s, 1);
  assert.ok(Math.max(...s.x.map((v, i) => Math.abs(v - s.rest[i]))) < 1e-10);
  const f = s.nodalTransforms();
  for (let i = 0; i < f.length; i++)
    assert.ok(Math.abs(f[i] - ((i % 9) % 4 === 0 ? 1 : 0)) < 1e-10);
});
test('elastic energy is unchanged by rigid rotation, and nodal F maps rest tangents correctly', () => {
  const s = new VolumeSoftBody(grid(), { gravity: 0 }),
    c = Math.cos(0.65),
    v = Math.sin(0.65);
  for (let i = 0; i < s.nodeCount; i++) {
    const x = s.rest[i * 3],
      z = s.rest[i * 3 + 2];
    s.x[i * 3] = c * x + v * z + 0.2;
    s.x[i * 3 + 2] = -v * x + c * z - 0.4;
  }
  const rotated = s.x.slice();
  run(s, 0.25);
  assert.ok(Math.max(...s.x.map((x, i) => Math.abs(x - rotated[i]))) < 1e-10);
  const f = s.nodalTransforms(),
    rotation = [c, 0, v, 0, 1, 0, -v, 0, c];
  for (let i = 0; i < f.length; i++)
    assert.ok(Math.abs(f[i] - rotation[i % 9]) < 1e-10);
});
test('gravity and energetic drop preserve finite noninverted volume above the floor', () => {
  const s = new VolumeSoftBody(grid());
  for (let i = 1; i < s.x.length; i += 3) s.x[i] += 1.8;
  s.kick(0, -3, 0);
  run(s, 3);
  finiteFloor(s);
  assert.ok(
    Math.abs(s.stats().volumeRatio - 1) < 0.06,
    JSON.stringify(s.stats()),
  );
  assert.ok(s.stats().kineticEnergy < 0.05);
});
test('localized crown press deforms its neighborhood and elastic strain recovers after release', () => {
  const s = new VolumeSoftBody(grid(), { gravity: 0 });
  const i = 61;
  const target = Array.from(s.rest.slice(i * 3, i * 3 + 3));
  target[1] -= 0.28;
  s.grab(i, target, 0.44);
  run(s, 0.16);
  const local = Math.abs(s.x[i * 3 + 1] - s.rest[i * 3 + 1]);
  assert.ok(local > 0.06, `local=${local}`);
  assert.ok(Math.abs(s.x[1] - s.rest[1]) < local * 0.65);
  const before = Math.abs(s.stats().minJacobian - 1);
  s.release();
  run(s, 3);
  finiteFloor(s);
  assert.ok(
    Math.abs(s.stats().minJacobian - 1) < before * 0.6,
    JSON.stringify(s.stats()),
  );
});
test('distributed crown grab lifts the whole mass and release remains stable', () => {
  const s = new VolumeSoftBody(grid());
  const i = 61;
  const target = Array.from(s.rest.slice(i * 3, i * 3 + 3));
  s.grab(i, target, 0.48);
  for (let k = 0; k < 240; k++) {
    target[1] = 1 + (k / 240) * 1.8;
    s.moveGrab(target);
    s.step(1 / 240);
  }
  assert.ok(
    Math.min(...Array.from({ length: s.nodeCount }, (_, j) => s.x[j * 3 + 1])) >
      0.6,
  );
  finiteFloor(s);
  assert.ok(Math.abs(s.stats().volumeRatio - 1) < 0.12);
  s.release();
  run(s, 3);
  finiteFloor(s);
  assert.ok(Math.abs(s.stats().volumeRatio - 1) < 0.06);
  s.reset();
  assert.deepEqual(s.x, s.rest);
  assert.equal(s.stats().steps, 0);
});
test('bounded fixed accumulator is invariant to render cadence and ignores invalid elapsed time', () => {
  const a = new VolumeSoftBody(grid(), { gravity: 0 }),
    b = new VolumeSoftBody(grid(), { gravity: 0 });
  for (let i = 1; i < a.x.length; i += 3) {
    a.x[i] += 2;
    b.x[i] += 2;
  }
  a.kick(0.4, 1, 0);
  b.kick(0.4, 1, 0);
  for (let i = 0; i < 120; i++) a.advance(1 / 60);
  for (let i = 0; i < 288; i++) b.advance(1 / 144);
  assert.equal(a.stats().steps, 480);
  assert.equal(b.stats().steps, 480);
  assert.deepEqual(a.x, b.x);
  const steps = a.stats().steps;
  a.advance(NaN);
  a.advance(-1);
  assert.equal(a.stats().steps, steps);
  a.advance(10);
  assert.ok(a.stats().steps - steps <= 24);
  finiteFloor(a);
});

test('grounded settled cage sleeps without further solves and all interaction entry points wake it', () => {
  const s = new VolumeSoftBody(characterFixture().cage);
  for (let i = 0; i < 360; i++) s.advance(1 / 60);
  assert.equal(s.sleeping, true);
  const pose = s.x.slice(),
    steps = s.stats().steps;
  assert.ok(steps < 1440);
  assert.equal(s.stats().kineticEnergy, 0);
  for (let i = 0; i < 144; i++) s.advance(1 / 144);
  assert.equal(s.stats().steps, steps);
  assert.deepEqual(s.x, pose);
  const top = crown(s);
  assert.ok(s.x[top * 3 + 1] > s.rest[top * 3 + 1] * 0.99);
  s.release();
  assert.equal(s.sleeping, false);
  s.advance(1 / 240);
  assert.equal(s.stats().steps, steps + 1);
  run(s, 3);
  assert.equal(s.sleeping, true);
  s.kick(0, 1, 0);
  assert.equal(s.sleeping, false);
  run(s, 0.1);
  assert.ok(s.stats().kineticEnergy > 0.01);
  run(s, 6);
  assert.equal(s.sleeping, true);
  const target = Array.from(s.x.slice(top * 3, top * 3 + 3));
  target[1] -= 0.25;
  s.grab(top, target, 0.65);
  assert.equal(s.sleeping, false);
  run(s, 1);
  assert.equal(s.sleeping, false);
  s.release();
  run(s, 8);
  assert.equal(s.sleeping, true);
  s.reset();
  assert.equal(s.sleeping, false);
  assert.equal(s.stats().steps, 0);
  assert.deepEqual(s.x, s.rest);
});

test('airborne stationary bodies remain awake and sleeping does not change wake-up frame cadence', () => {
  const floating = new VolumeSoftBody(grid(), { gravity: 0 });
  for (let i = 1; i < floating.x.length; i += 3) floating.x[i] += 2;
  run(floating, 2);
  assert.equal(floating.sleeping, false);
  assert.equal(floating.stats().steps, 480);
  const a = new VolumeSoftBody(grid()),
    b = new VolumeSoftBody(grid());
  for (let i = 0; i < 360; i++) a.advance(1 / 60);
  for (let i = 0; i < 864; i++) b.advance(1 / 144);
  assert.equal(a.sleeping, true);
  assert.equal(b.sleeping, true);
  assert.deepEqual(a.x, b.x);
  assert.equal(a.stats().steps, b.stats().steps);
  a.kick(0.2, 1, 0);
  b.kick(0.2, 1, 0);
  for (let i = 0; i < 60; i++) a.advance(1 / 60);
  for (let i = 0; i < 144; i++) b.advance(1 / 144);
  assert.deepEqual(a.x, b.x);
  assert.equal(a.stats().steps, b.stats().steps);
});

function crown(s) {
  let top = 0;
  for (let i = 0; i < s.nodeCount; i++)
    if (
      s.rest[i * 3 + 1] > s.rest[top * 3 + 1] + 1e-8 ||
      (Math.abs(s.rest[i * 3 + 1] - s.rest[top * 3 + 1]) < 1e-8 &&
        Math.hypot(s.rest[i * 3], s.rest[i * 3 + 2]) <
          Math.hypot(s.rest[top * 3], s.rest[top * 3 + 2]))
    )
      top = i;
  return top;
}
test('approved full cage retains its silhouette under gravity and survives lifted release', () => {
  const s = new VolumeSoftBody(characterFixture().cage),
    top = crown(s);
  run(s, 2);
  assert.ok(s.x[top * 3 + 1] > s.rest[top * 3 + 1] * 0.95);
  assert.ok(Math.abs(s.stats().volumeRatio - 1) < 0.015);
  const target = Array.from(s.x.slice(top * 3, top * 3 + 3));
  s.grab(top, target, 0.65);
  for (let i = 0; i < 240; i++) {
    target[1] = s.rest[top * 3 + 1] + (i / 240) * 2;
    s.moveGrab(target);
    s.step(1 / 240);
  }
  assert.ok(
    Math.min(...Array.from({ length: s.nodeCount }, (_, i) => s.x[i * 3 + 1])) >
      1,
  );
  assert.ok(Math.abs(s.stats().volumeRatio - 1) < 0.025);
  s.release();
  for (let i = 0; i < 720; i++) {
    s.step(1 / 240);
    if (i % 12 === 0) finiteFloor(s);
  }
  assert.ok(Math.abs(s.stats().volumeRatio - 1) < 0.025);
});
test('impossible floor-crush grab cannot turn any approved-cage tetrahedron inside out', () => {
  const s = new VolumeSoftBody(characterFixture().cage),
    top = crown(s),
    target = Array.from(s.x.slice(top * 3, top * 3 + 3));
  s.grab(top, target, 0.65);
  for (let i = 0; i < 420; i++) {
    target[1] = s.rest[top * 3 + 1] - Math.min(i / 180, 1) * 2.27;
    s.moveGrab(target);
    s.step(1 / 240);
    if (i % 4 === 0) finiteFloor(s);
  }
  s.release();
  run(s, 2);
  finiteFloor(s);
  assert.ok(
    s.stats().minJacobian > 0.6,
    'release must recover, not freeze at the inversion threshold',
  );
});
