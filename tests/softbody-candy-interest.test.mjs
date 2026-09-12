import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterBehavior } from '../lib/softbody/behavior.ts';
const candy = (id, x, z = 0) => ({
  id,
  x,
  y: 0.18,
  z,
  vx: 0,
  vy: 0,
  vz: 0,
  radius: 0.18,
  mode: 'free',
});
const observation = (changes = {}) => ({
  time: 0,
  center: [0, 1, 0],
  velocity: [0, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, 1],
  grounded: true,
  held: false,
  stable: true,
  width: 3.2,
  height: 2.4,
  impactSpeed: 0,
  rendezvous: [0, 0, 0],
  viewerDirection: [0, 0, 1],
  cameraMoving: false,
  candies: [],
  ...changes,
});
function run(b, o, seconds) {
  let f;
  for (let i = 0; i < seconds * 120; i++) {
    o.time += 1 / 120;
    f = b.step(o, 1 / 120);
  }
  return f;
}
test('left, right and rear candy select distinct underbelly landing points without turning every contact to the front', () => {
  for (const [x, z] of [
    [2, 0],
    [-2, 0],
    [0, -2],
  ]) {
    const b = new CharacterBehavior(1),
      c = candy(1, x, z),
      o = observation({ candies: [c], canAbsorb: true });
    const f = run(b, o, 3);
    assert.equal(f.phase, 'collecting');
    assert.ok(f.facing[2] > 0.99);
    assert.ok(Math.abs(f.facing[0]) < 0.01);
    const offset = Math.hypot(f.destination[0] - x, f.destination[2] - z);
    assert.ok(
      offset > 1.2 && offset < 1.4,
      'candy lands under the rounded shoulder instead of the sparse flat base',
    );
    const before = f.destination[2];
    c.z += 0.12;
    assert.ok(Math.abs(run(b, o, 0.02).destination[2] - before - 0.12) < 1e-6);
  }
});
test('discovery and inspection stay in place, and lack of intake prevents a jump', () => {
  const b = new CharacterBehavior(1),
    o = observation({ candies: [candy(1, 4)] });
  let f = run(b, o, 1.5);
  assert.equal(f.phase, 'noticing');
  assert.equal(f.desiredSpeed, 0);
  f = run(b, o, 2);
  assert.equal(f.phase, 'inspecting');
  assert.equal(f.desiredSpeed, 0);
  o.canAbsorb = true;
  f = run(b, o, 0.05);
  assert.equal(f.phase, 'collecting');
  assert.equal(o.candies[0].mode, 'free');
});
test('only settled free candy qualifies and a hand takeover removes the target', () => {
  const b = new CharacterBehavior(2),
    held = candy(1, 2),
    air = candy(2, -2);
  held.mode = 'held';
  air.y = 1.2;
  const o = observation({ candies: [held, air] });
  assert.equal(run(b, o, 1).candy, null);
  const c = candy(3, 4);
  o.candies.push(c);
  assert.equal(run(b, o, 1.5).candy.id, 3);
  o.candies.push(candy(4, 2));
  assert.equal(run(b, o, 1).candy.id, 3);
  c.mode = 'held';
  const f = run(b, o, 0.02);
  assert.notEqual(f.candy?.id, 3);
  assert.equal(f.desiredSpeed, 0);
});
test('voluntary flight keeps food intent; grabbing the body cancels it immediately', () => {
  const b = new CharacterBehavior(3),
    o = observation({ candies: [candy(1, 5)], canAbsorb: true });
  run(b, o, 3);
  o.center = [2.1, 1, 0];
  o.grounded = false;
  o.velocity = [2, -1, 0];
  assert.equal(run(b, o, 1).phase, 'collecting');
  b.observe({ kind: 'grab', time: o.time });
  o.held = true;
  const f = run(b, o, 0.02);
  assert.equal(f.phase, 'held');
  assert.equal(f.candy, null);
  assert.equal(f.desiredSpeed, 0);
});
test('angry return and self-righting still outrank food', () => {
  const b = new CharacterBehavior(4),
    o = observation({ center: [4, 1, 0], candies: [candy(1, 5)] });
  b.observe({ kind: 'grab', time: 0 });
  b.observe({
    kind: 'release',
    time: 0.1,
    velocity: [4, 2, 0],
    carriedDistance: 2,
    valid: true,
  });
  let f = run(b, o, 1);
  assert.equal(f.candy, null);
  assert.ok(f.mood > 0.2);
  assert.equal(f.phase, 'returning');
  o.up = [1, 0, 0];
  f = run(b, o, 0.1);
  assert.equal(f.phase, 'righting');
  assert.equal(f.candy, null);
});
