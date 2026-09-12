import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlimeDynamics } from '../lib/slime-physics.ts';
const simulate = (s, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 120) s.advance(1 / 120);
};

test('a hop can travel to food at another depth and retains a grounded body', () => {
  const s = new SlimeDynamics();
  s.hopTo(0.4, 0.2, 0.8);
  simulate(s, 1.2);
  assert.ok(s.z > 0.2);
  assert.ok(s.y >= 0 && s.y < 0.02);
});
test('puff increases volume and pressure while fullness changes the lower belly', () => {
  const base = new SlimeDynamics(),
    puffed = new SlimeDynamics(),
    full = new SlimeDynamics();
  puffed.pose.puff = 1;
  full.pose.fullness = 1;
  simulate(puffed, 2);
  simulate(full, 2);
  assert.ok(puffed.deform(1, 1.4, 0.6).z > base.deform(1, 1.4, 0.6).z + 0.15);
  assert.ok(full.deform(1, 0.55, 0.6).x > base.deform(1, 0.55, 0.6).x + 0.03);
  base.grab(0, 0, { x: 0, y: 1.4, z: 1 });
  puffed.grab(0, 0, { x: 0, y: 1.4, z: 1 });
  simulate(base, 0.6);
  simulate(puffed, 0.6);
  assert.ok(puffed.press < base.press * 0.85);
  const before = puffed.deform(0, 1.4, 1);
  puffed.release();
  const after = puffed.deform(0, 1.4, 1);
  assert.ok(
    Math.hypot(before.x - after.x, before.y - after.y, before.z - after.z) <
      1e-8,
  );
});
test('a second touch indents its own skin patch and releases without snapping', () => {
  const s = new SlimeDynamics();
  s.pose.puff = 1;
  simulate(s, 1);
  const right = { x: 1, y: 1.2, z: 0.6 };
  const before = s.deform(right.x, right.y, right.z);
  s.grab(0, 0, { x: -1, y: 1.2, z: 0.6 });
  s.grabSecond(right);
  s.pinchTo(0.7);
  simulate(s, 0.3);
  const squeezed = s.deform(right.x, right.y, right.z);
  assert.ok(squeezed.x < before.x - 0.03);
  s.releaseSecond();
  const released = s.deform(right.x, right.y, right.z);
  assert.ok(
    Math.hypot(
      released.x - squeezed.x,
      released.y - squeezed.y,
      released.z - squeezed.z,
    ) < 1e-8,
  );
  s.release();
  simulate(s, 2);
  assert.ok(Math.abs(s.deform(right.x, right.y, right.z).x - before.x) < 0.03);
});
test('letting go preserves the grabbed surface continuously and it recoils', () => {
  const s = new SlimeDynamics();
  s.grab(0, 0, { x: 0.5, y: 1.4, z: 0.9 });
  s.dragTo(1, 1.1);
  simulate(s, 0.12);
  const before = s.deform(0.5, 1.4, 0.9);
  s.release();
  const after = s.deform(0.5, 1.4, 0.9);
  assert.ok(
    Math.hypot(before.x - after.x, before.y - after.y, before.z - after.z) <
      1e-8,
    'release must never snap geometry',
  );
  simulate(s, 0.08);
  const later = s.deform(0.5, 1.4, 0.9);
  assert.ok(
    Math.hypot(later.x - after.x, later.y - after.y, later.z - after.z) > 0.01,
  );
});
test('slime settles where it was dropped instead of sliding home', () => {
  const s = new SlimeDynamics();
  s.x = 1;
  s.y = 0.8;
  simulate(s, 10);
  assert.ok(Math.abs(s.x - 1) < 0.01);
});
test('grabbing a second patch preserves the first patch recoil', () => {
  const s = new SlimeDynamics();
  s.grab(0, 0, { x: 0.7, y: 1.4, z: 0.8 });
  s.dragTo(1, 1);
  simulate(s, 0.12);
  s.release();
  simulate(s, 0.025);
  const points = [
    [0.7, 1.4, 0.8],
    [-0.7, 1.3, 0.8],
  ];
  const before = points.map((p) => s.deform(...p));
  s.grab(s.x, s.y, { x: -0.7, y: 1.3, z: 0.8 });
  points.forEach((p, i) => {
    const after = s.deform(...p);
    assert.ok(
      Math.hypot(
        after.x - before[i].x,
        after.y - before[i].y,
        after.z - before[i].z,
      ) < 1e-8,
    );
  });
});
test('poke creates squash and lift, then returns to rest', () => {
  const s = new SlimeDynamics();
  s.poke();
  simulate(s, 0.1);
  assert.ok(Math.abs(s.squash) > 0.01, 'poke must deform the body');
  simulate(s, 12);
  assert.ok(Math.abs(s.squash) < 0.002);
  assert.ok(s.y < 0.002);
});
test('drop cannot cross the table and produces an impact deformation', () => {
  const s = new SlimeDynamics();
  s.y = 1.2;
  let max = 0;
  for (let i = 0; i < 700; i++) {
    s.advance(1 / 120);
    assert.ok(s.y >= 0);
    max = Math.max(max, Math.abs(s.squash));
  }
  assert.ok(max > 0.04, 'collision must transfer energy into soft deformation');
  assert.ok(s.y < 0.005);
});
test('greater damping dissipates oscillation faster', () => {
  const low = new SlimeDynamics(),
    high = new SlimeDynamics();
  low.damping = 0;
  high.damping = 100;
  low.poke();
  high.poke();
  simulate(low, 2);
  simulate(high, 2);
  const energy = (s) =>
    s.squash * s.squash + (s.squashVelocity * s.squashVelocity) / 100;
  assert.ok(energy(high) < energy(low) * 0.3);
});
test('press is local, not a uniform scaling of a hard ball', () => {
  const s = new SlimeDynamics();
  s.grab(0, 0, { x: 0, y: 1, z: 1 });
  simulate(s, 0.25);
  const near = s.deform(0, 1, 1),
    far = s.deform(1.5, 1, 0);
  assert.ok(Math.abs(near.z - 1) > Math.abs(far.x - 1.5) * 2);
  s.release();
  simulate(s, 10);
  assert.ok(Math.abs(s.press) < 0.002);
});
test('drag follows with inertia and long frame gaps stay finite', () => {
  const s = new SlimeDynamics();
  s.grab(0, 0, { x: 0, y: 1.5, z: 0.6 });
  s.dragTo(0.8, 1);
  simulate(s, 0.6);
  assert.ok(s.y > 0.4);
  assert.ok(s.x > 0.3);
  s.release();
  s.advance(20);
  for (const n of [s.x, s.y, s.vx, s.vy, s.squash])
    assert.ok(Number.isFinite(n));
  simulate(s, 10);
  assert.ok(s.y < 0.01);
});

test('dragging from a side view stretches the grabbed skin in depth before the body follows', () => {
  const s = new SlimeDynamics();
  s.grab(0, 0, { x: 1.55, y: 1.2, z: 0.1 }, { x: 1, y: 0, z: 0 });
  s.dragTo(0, 0.6, 0.9);
  simulate(s, 0.12);
  assert.ok(
    s.patch.z > 0.15,
    'screen-horizontal motion from a side view must stretch flesh in world Z',
  );
  assert.ok(s.z > 0 && s.z < 0.9);
  const before = s.deform(1.55, 1.2, 0.1);
  s.release();
  assert.deepEqual(s.deform(1.55, 1.2, 0.1), before);
  simulate(s, 4);
  assert.ok(Math.abs(s.patch.z) < 0.002);
});
test('reaching moves the mouth while the foot stays planted, then recoils smoothly', () => {
  const s = new SlimeDynamics();
  s.pose.reachX = 0.55;
  s.pose.reachY = 0.5;
  simulate(s, 0.6);
  const mouth = s.deform(0, 1.025, 1.18);
  const foot = s.deform(0, 0.025, 0.1);
  assert.ok(mouth.x > 0.35 && mouth.y > 1.35);
  assert.ok(Math.abs(foot.x) < 0.02 && foot.y < 0.05);
  s.pose.reachX = s.pose.reachY = 0;
  assert.deepEqual(s.deform(0, 1.025, 1.18), mouth);
  simulate(s, 4);
  assert.ok(Math.abs(s.deform(0, 1.025, 1.18).x) < 0.002);
});
