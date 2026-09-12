import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlimeCharacter } from '../lib/slime-character.ts';
const advance = (c, seconds, action) => {
  for (let t = 0; t < seconds; t += 1 / 120) {
    action?.(1 / 120);
    c.advance(1 / 120);
  }
};
test('gentle moving touch builds affection and a moving, centered happy sway', () => {
  const c = new SlimeCharacter();
  advance(c, 1.2, (dt) => c.stroke(0.5, dt, 1));
  assert.equal(c.mood, 'pleased');
  assert.ok(c.comfort > 0.4);
  const angles = [];
  advance(c, 5, () => angles.push(c.lean));
  assert.ok(Math.min(...angles) < -0.015 && Math.max(...angles) > 0.015);
  assert.ok(Math.abs(angles.reduce((a, b) => a + b, 0) / angles.length) < 0.02);
});
test('a stationary pointer or fast sweep is not a caress', () => {
  for (const speed of [0, 8]) {
    const c = new SlimeCharacter();
    advance(c, 2, (dt) => c.stroke(speed, dt, 1));
    assert.equal(c.mood, 'calm');
  }
});
test('rapid pokes annoy it, isolated pokes do not', () => {
  const fast = new SlimeCharacter(),
    slow = new SlimeCharacter();
  for (let i = 0; i < 4; i++) {
    fast.poke(1);
    advance(fast, 0.16);
    slow.poke(1);
    advance(slow, 5);
  }
  assert.equal(fast.mood, 'grumpy');
  assert.equal(slow.mood, 'calm');
  assert.ok(Math.abs(fast.lean) < 0.015, 'anger stays centered');
});
test('gentle touch comforts an annoyed slime', () => {
  const c = new SlimeCharacter();
  for (let i = 0; i < 4; i++) {
    c.poke(-1);
    advance(c, 0.15);
  }
  advance(c, 1.8, (dt) => c.stroke(0.4, dt, -1));
  assert.equal(c.mood, 'pleased');
  assert.ok(c.grump < 0.1);
});
test('food is caught and chewed before its color spreads', () => {
  const c = new SlimeCharacter();
  assert.ok(c.offerFood());
  c.foodNear = true;
  assert.equal(c.mood, 'curious');
  assert.ok(c.eat());
  assert.equal(c.phase, 'catching');
  assert.equal(c.spread, 0);
  assert.equal(c.eat(), false);
  advance(c, 0.8);
  assert.equal(c.phase, 'chewing');
  assert.equal(c.spread, 0);
  advance(c, 2.7);
  assert.equal(c.phase, 'spreading');
  assert.ok(c.spread > 0 && c.spread < 1);
  advance(c, 3);
  assert.equal(c.busy, false);
  assert.equal(c.spread, 1);
});
test('a meal gives three readable chews, a separate swallow, and a satisfied finish', () => {
  const c = new SlimeCharacter();
  c.eat();
  const durations = {},
    cheeks = [];
  for (let i = 0; i < 8 * 120 && c.busy; i++) {
    durations[c.phase] = (durations[c.phase] || 0) + 1 / 120;
    if (c.phase === 'chewing') cheeks.push(c.chewSide);
    c.advance(1 / 120);
  }
  assert.ok(durations.chewing >= 1.8, 'chewing needs time to be visible');
  assert.ok(durations.swallowing >= 0.6);
  assert.ok(durations.savoring >= 0.6);
  assert.ok(Math.min(...cheeks) < -0.5 && Math.max(...cheeks) > 0.5);
  assert.equal(c.busy, false);
});
test('cancelled offers are not eaten and reset clears ongoing behavior', () => {
  const c = new SlimeCharacter();
  c.offerFood();
  c.foodNear = true;
  c.cancelFood();
  assert.equal(c.mood, 'calm');
  assert.equal(c.busy, false);
  c.eat();
  advance(c, 1);
  c.poke(1);
  c.reset();
  assert.equal(c.phase, 'idle');
  assert.equal(c.mood, 'calm');
  assert.equal(c.spread, 1);
});
test('only swallowing fills the belly, and a satiated slime declines another candy', () => {
  const c = new SlimeCharacter();
  c.eat();
  advance(c, 2.9);
  assert.equal(c.fullness, 0);
  advance(c, 3.3);
  assert.ok(c.fullness > 0.1);
  for (let i = 0; i < 6; i++) {
    assert.ok(c.eat());
    advance(c, 6.2);
  }
  assert.ok(c.isFull);
  assert.equal(c.eat(), false);
  const full = c.fullness;
  advance(c, 10);
  assert.equal(c.fullness, full);
  advance(c, 110);
  assert.ok(!c.isFull);
  assert.ok(c.eat());
});
test('withdrawing an anticipated candy causes a bounded soft puff, throwing does not', () => {
  const c = new SlimeCharacter();
  c.offerFood();
  c.foodNear = true;
  advance(c, 0.7);
  c.withdrawFood();
  advance(c, 1.5);
  assert.ok(c.puff > 0.25);
  for (let i = 0; i < 12; i++) c.withdrawFood();
  advance(c, 0.2);
  assert.ok(c.puff <= 1);
  advance(c, 5, (dt) => c.stroke(0.4, dt, 1));
  assert.ok(c.puff < 0.15);
  const thrown = new SlimeCharacter();
  thrown.offerFood();
  thrown.foodNear = true;
  advance(thrown, 0.7);
  thrown.cancelFood();
  advance(thrown, 1.5);
  assert.equal(thrown.puff, 0);
});

test('anger inflates gradually and soothing deflates more slowly without a snap', () => {
  const c = new SlimeCharacter();
  c.annoyance = 1;
  advance(c, 0.25);
  assert.ok(c.puff < 0.3, 'inflation must not pop instantly into a pose');
  advance(c, 2.75);
  assert.ok(c.puff > 0.9, 'sustained anger reaches the rounded shape');
  const inflated = c.puff;
  c.annoyance = 0;
  advance(c, 0.25);
  assert.ok(c.puff > inflated * 0.7, 'release is visibly slower than a snap');
  const samples = [];
  advance(c, 6, () => samples.push(c.puff));
  assert.ok(samples.every((n, i) => i === 0 || n <= samples[i - 1]));
  assert.ok(c.puff < 0.025);
  assert.ok(Math.abs(c.lean) < 0.01);
});
test('a briefly selected candy and a candy offered when full do not cause withdrawal anger', () => {
  const c = new SlimeCharacter();
  c.offerFood();
  c.withdrawFood();
  advance(c, 1);
  assert.equal(c.puff, 0);
  for (let i = 0; i < 7; i++) {
    c.eat();
    advance(c, 6.2);
  }
  c.offerFood();
  c.foodNear = true;
  advance(c, 1);
  c.withdrawFood();
  advance(c, 1);
  assert.equal(c.puff, 0);
});
test('idle sleep is interrupted by activity and does not accumulate during a meal', () => {
  const c = new SlimeCharacter();
  advance(c, 65);
  assert.ok(c.sleep > 0.9);
  c.wake();
  advance(c, 0.5);
  assert.ok(c.sleep < 0.25);
  assert.ok(c.wakeAge > 0);
  const awake = new SlimeCharacter();
  for (let i = 0; i < 70 * 120; i++) awake.advance(1 / 120, true);
  assert.ok(awake.sleep < 0.01);
});

test('body absorption counts enclosure once and refuses new food while busy or full', () => {
  const c = new SlimeCharacter();
  assert.ok(c.absorb());
  advance(c, 0.8);
  assert.equal(c.fullness, 0);
  assert.equal(c.absorb(), false);
  advance(c, 0.2);
  assert.ok(Math.abs(c.fullness - 1 / 7) < 1e-6);
  advance(c, 5.2);
  assert.ok(Math.abs(c.fullness - 1 / 7) < 1e-6);
  for (let i = 0; i < 6; i++) {
    assert.ok(c.absorb());
    advance(c, 6.2);
  }
  assert.ok(c.isFull);
  assert.equal(c.absorb(), false);
});
