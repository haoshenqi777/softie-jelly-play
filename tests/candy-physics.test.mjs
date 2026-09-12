import test from 'node:test';
import assert from 'node:assert/strict';
import { SlimeDynamics } from '../lib/slime-physics.ts';
import { SlimeContactSurface } from '../lib/slime-contact.ts';
import { heightAt } from '../lib/slime-shape.ts';
import { CandyWorld } from '../lib/candy-physics.ts';
test('a candy lands on the rendered head, including an inflated body', () => {
  for (const puff of [0, 1]) {
    const s = new SlimeDynamics();
    s.puff = puff;
    const skin = new SlimeContactSurface(s),
      w = new CandyWorld();
    const c = w.spawn('#ffe18a', 'hard', { x: 0, y: 3.8, z: 0 });
    const tip = s.deform(0, heightAt(1), 0).y;
    for (let i = 0; i < 360; i++) {
      w.advance(1 / 120, {
        x: 0,
        y: 0,
        z: 0,
        mouth: { x: 0, y: 1, z: 1 },
        edibleId: null,
        contact: skin.contact,
      });
      if (Math.hypot(c.x, c.z) < 0.04)
        assert.ok(c.y >= tip + c.radius - 0.025, `${puff}: ${c.y} vs ${tip}`);
    }
  }
});
const tick = (w, seconds) => {
  for (let i = 0; i < seconds * 120; i++) w.advance(1 / 120);
};

test('a candy held toward any room edge releases continuously without teleporting', () => {
  for (const target of [
    { x: 0, y: 1, z: -2 },
    { x: 0, y: 1, z: 4 },
    { x: -5, y: 1, z: 1 },
    { x: 5, y: 1, z: 1 },
  ]) {
    const world = new CandyWorld();
    const candy = world.spawn('#f17fa9', 'gummy', { x: 0, y: 1, z: 1 });
    world.grab(candy.id);
    world.moveHeld(target, 0.1);
    tick(world, 0.5);
    assert.ok(candy.z >= world.bounds.zMin + candy.radius - 1e-6);
    assert.ok(candy.z <= world.bounds.zMax - candy.radius + 1e-6);
    assert.ok(Math.abs(candy.x) <= world.bounds.x - candy.radius + 1e-6);
    const before = { x: candy.x, y: candy.y, z: candy.z };
    world.release();
    world.advance(1 / 120);
    assert.ok(
      Math.hypot(candy.x - before.x, candy.y - before.y, candy.z - before.z) <
        0.07,
    );
  }
});

test('released candy follows gravity rather than remaining at its offering position', () => {
  const w = new CandyWorld();
  const c = w.spawn(
    '#6ecfb1',
    'gummy',
    { x: 0, y: 2, z: 1 },
    { x: 1, y: 0, z: 0 },
  );
  tick(w, 0.25);
  assert.ok(c.x > 0.2 && c.y < 1.85 && c.y > 1.6);
  assert.ok(c.vy < -1);
});
test('candy lands without crossing the table, settles and remains available', () => {
  const w = new CandyWorld();
  const c = w.spawn('#6ecfb1', 'gummy', { x: 0, y: 2, z: 1 });
  for (let i = 0; i < 1200; i++) {
    w.advance(1 / 120);
    assert.ok(c.y >= c.radius - 0.002);
  }
  assert.equal(w.candies.length, 1);
  assert.ok(c.sleeping);
});
test('hard candy rebounds higher while gummy visibly compresses on impact', () => {
  const a = new CandyWorld(),
    b = new CandyWorld();
  const soft = a.spawn('#6ecfb1', 'gummy', { x: 0, y: 1, z: 1 });
  const hard = b.spawn('#ffe18a', 'hard', { x: 0, y: 1, z: 1 });
  let softPeak = 0,
    hardPeak = 0,
    compression = 0,
    softHit = false,
    hardHit = false;
  for (let i = 0; i < 170; i++) {
    a.advance(1 / 120);
    b.advance(1 / 120);
    softHit ||= soft.vy > 0;
    hardHit ||= hard.vy > 0;
    if (softHit) softPeak = Math.max(softPeak, soft.y);
    if (hardHit) hardPeak = Math.max(hardPeak, hard.y);
    compression = Math.max(compression, soft.compression);
  }
  assert.ok(hardPeak > softPeak + 0.15);
  assert.ok(compression > 0.08);
});
test('a collision transfers momentum and wakes resting candy', () => {
  const w = new CandyWorld();
  const resting = w.spawn('#ffe18a', 'hard', { x: 0, y: 0.08, z: 1 });
  tick(w, 3);
  assert.ok(resting.sleeping);
  w.spawn('#6ecfb1', 'gummy', { x: -0.6, y: 0.09, z: 1 }, { x: 3, y: 0, z: 0 });
  tick(w, 0.25);
  assert.ok(resting.x > 0.02);
  assert.ok(!resting.sleeping);
});
test('a held candy retains identity and recent throw velocity on release', () => {
  const w = new CandyWorld();
  const c = w.spawn('#6ecfb1', 'gummy', { x: 0, y: 1, z: 1 });
  w.grab(c.id);
  for (let i = 1; i <= 8; i++)
    w.moveHeld({ x: i * 0.04, y: 1 + i * 0.02, z: 1 }, 1 / 60);
  w.release();
  const x = c.x;
  tick(w, 0.08);
  assert.equal(w.candies[0].id, c.id);
  assert.ok(c.x > x + 0.07);
  assert.equal(w.heldId, null);
});
test('thirty thrown candies remain finite, bounded, and are not silently deleted', () => {
  const w = new CandyWorld();
  for (let i = 0; i < 30; i++)
    w.spawn(
      '#c2a2ea',
      i % 2 ? 'hard' : 'gummy',
      {
        x: (i % 6) * 0.22 - 0.55,
        y: 1 + Math.floor(i / 6) * 0.3,
        z: 0.4 + (i % 4) * 0.25,
      },
      { x: (i % 3) - 1, y: i % 2, z: (i % 5) * 0.3 - 0.6 },
    );
  tick(w, 12);
  assert.equal(w.candies.length, 30);
  for (const c of w.candies) {
    assert.ok(
      [c.x, c.y, c.z, c.vx, c.vy, c.vz, c.compression].every(Number.isFinite),
    );
    assert.ok(
      c.y >= c.radius - 0.002 && Math.abs(c.x) < 4 && c.z < 4 && c.z > -2,
    );
  }
});
