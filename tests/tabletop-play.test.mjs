import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePlayMode } from '../lib/play-mode.ts';
import { TabletopMotion, tabletopDrag } from '../lib/softbody/tabletop.ts';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { characterFixture } from './softbody-fixture.mjs';

test('mode defaults by input and respects a saved choice', () => {
  assert.equal(resolvePlayMode(null, true), 'tabletop');
  assert.equal(resolvePlayMode(null, false), 'free');
  assert.equal(resolvePlayMode('free', true), 'free');
  assert.equal(resolvePlayMode('tabletop', false), 'tabletop');
  assert.equal(resolvePlayMode('invalid', true), 'tabletop');
});

test('ordinary squeezing and head compression retain the full free-mode target response', () => {
  const p = [0, 2, 0];
  const a = tabletopDrag([10, 20, -10], p);
  assert.ok(a[1] > 3.5 && a[1] <= 3.8);
  for (const target of [
    [0.05, 2.05, 0],
    [1.2, 2.9, -0.8],
    [0, 0.65, 0],
  ])
    assert.deepEqual(tabletopDrag(target, p), target);
});

test('release removes throwing energy while preserving local jiggle exactly', () => {
  const { cage } = characterFixture();
  const s = new VolumeSoftBody(cage),
    policy = new TabletopMotion(s);
  for (let i = 0; i < s.velocity.length; i += 3) {
    s.velocity[i] = 8 + Math.sin(i) * 0.2;
    s.velocity[i + 1] = 8;
    s.velocity[i + 2] = -5;
  }
  const relative = s.velocity[0] - s.velocity[3];
  const positions = s.x.slice();
  policy.release();
  const v = policy.sample().velocity;
  assert.ok(Math.hypot(v[0], v[2]) <= 1.11);
  assert.ok(v[1] <= 4.01 && v[1] >= 3.9);
  assert.ok(Math.abs(s.velocity[0] - s.velocity[3] - relative) < 1e-12);
  assert.deepEqual(s.x, positions);
});

test('head compression and rebound match free play inside the neutral zone', async () => {
  const { cage } = characterFixture();
  const free = new VolumeSoftBody(cage),
    fixed = new VolumeSoftBody(cage);
  const wasm = readFileSync(
    new URL('../public/physics/volume.wasm', import.meta.url),
  );
  await Promise.all([free.accelerate(wasm), fixed.accelerate(wasm)]);
  const policy = new TabletopMotion(fixed);
  let node = 0;
  for (let i = 1; i < free.nodeCount; i++)
    if (free.rest[i * 3 + 1] > free.rest[node * 3 + 1]) node = i;
  const origin = Array.from(free.x.slice(node * 3, node * 3 + 3));
  const target = [origin[0], origin[1] - 1.2, origin[2]];
  free.grab(node, origin, 0.58);
  fixed.grab(node, origin, 0.58);
  free.moveGrab(target);
  fixed.moveGrab(tabletopDrag(target, origin));
  let deepest = 0;
  for (let i = 0; i < 150; i++) {
    if (i === 45) {
      free.release();
      fixed.release();
      policy.release();
    }
    free.advance(1 / 120);
    fixed.advance(1 / 120, (dt) => policy.step(dt, i < 45, false));
    deepest = Math.max(deepest, origin[1] - fixed.x[node * 3 + 1]);
    let error = 0;
    for (let k = 0; k < free.x.length; k++)
      error = Math.max(error, Math.abs(free.x[k] - fixed.x[k]));
    assert.ok(
      error < 0.015,
      `compression/rebound error ${error} at frame ${i}`,
    );
  }
  assert.ok(deepest > 0.85, `head still presses deeply: ${deepest}`);
});

test('bounded release settles nearby with real soft-body physics; feeding retains exclusive motion ownership', async () => {
  const { cage } = characterFixture();
  const s = new VolumeSoftBody(cage);
  await s.accelerate(
    readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
  );
  const policy = new TabletopMotion(s);
  s.kick(8, 8, 4);
  policy.release();
  let maxRadius = 0,
    maxHeight = 0;
  for (let i = 0; i < 600; i++) {
    s.advance(1 / 120, (dt) => policy.step(dt, false, false));
    const p = policy.sample();
    maxRadius = Math.max(maxRadius, Math.hypot(p.center[0], p.center[2]));
    maxHeight = Math.max(maxHeight, p.center[1] - policy.home[1]);
  }
  assert.ok(maxRadius < 1.5, `travel ${maxRadius}`);
  assert.ok(maxHeight > 0.65 && maxHeight < 1.8, `height ${maxHeight}`);
  assert.ok(s.x.every(Number.isFinite));
  s.kick(2, 3, 1);
  const before = s.velocity.slice();
  policy.step(1 / 120, false, true);
  assert.deepEqual(
    s.velocity,
    before,
    'no hidden spring or damping fights a food jump or wrapping',
  );
});

for (const feeding of [false, true])
  test(`repeated fast grabs cannot ratchet the body out of reach, feeding=${feeding}`, async (t) => {
    const { cage } = characterFixture();
    const s = new VolumeSoftBody(cage),
      policy = new TabletopMotion(s);
    await s.accelerate(
      readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
    );
    let node = 0;
    for (let i = 1; i < s.nodeCount; i++)
      if (s.rest[i * 3 + 1] > s.rest[node * 3 + 1]) node = i;
    let maxRadius = 0,
      localStretch = 0;
    let maxLift = 0;
    for (let drag = 0; drag < 12; drag++) {
      const origin = Array.from(s.x.slice(node * 3, node * 3 + 3));
      s.grab(node, origin, 0.58);
      s.moveGrab(
        tabletopDrag(
          [origin[0] + 2, origin[1] + 2, origin[2]],
          origin,
          policy.sample().center[1] - policy.home[1],
        ),
      );
      for (let i = 0; i < 25; i++) {
        s.advance(1 / 120, (dt) => policy.step(dt, true, feeding));
        const p = policy.sample();
        maxRadius = Math.max(maxRadius, Math.hypot(p.center[0], p.center[2]));
        maxLift = Math.max(maxLift, p.center[1] - policy.home[1]);
        localStretch = Math.max(
          localStretch,
          s.x[node * 3 + 1] -
            p.center[1] -
            (s.rest[node * 3 + 1] - policy.home[1]),
        );
      }
      s.release();
      policy.release();
      for (let i = 0; i < 25; i++)
        s.advance(1 / 120, (dt) => policy.step(dt, false, feeding));
    }
    assert.ok(maxRadius < 1.6, `repeated travel ${maxRadius}`);
    assert.ok(maxLift > 0.9 && maxLift < 2.1, `repeated lift ${maxLift}`);
    assert.ok(
      localStretch > 0.12,
      `still has visible local stretch: ${localStretch}`,
    );
    assert.ok(s.x.every(Number.isFinite));
    t.diagnostic(JSON.stringify({ maxRadius, maxLift, localStretch }));
  });

test('grabbing during digestion and its release still receive tabletop restraint', () => {
  const { cage } = characterFixture();
  const s = new VolumeSoftBody(cage),
    policy = new TabletopMotion(s);
  s.kick(5, 0, 0);
  for (let i = 0; i < s.x.length; i += 3) s.x[i] += 1.8;
  policy.step(1 / 120, true, true);
  assert.ok(policy.sample().velocity[0] < 5);
  policy.release();
  const before = policy.sample().velocity[0];
  policy.step(1 / 120, false, true);
  assert.ok(policy.sample().velocity[0] < before);
  policy.reset();
  const v = s.velocity.slice();
  policy.step(1 / 120, false, true);
  assert.deepEqual(
    s.velocity,
    v,
    'reset removes old release guard before a new candy hop',
  );
});
