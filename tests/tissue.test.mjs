import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlimeTissue } from '../lib/slime-tissue.ts';

test('a contact impulse reaches upper flesh later and settles instead of scaling the whole body', () => {
  const t = new SlimeTissue();
  t.impulse(0.3, 1);
  let earlyLow = 0,
    earlyTop = 0,
    lateTop = 0;
  for (let i = 0; i < 120; i++) {
    t.advance(1 / 120, 35, 45);
    if (i < 8) {
      earlyLow = Math.max(earlyLow, Math.abs(t.sample(0.3).radial));
      earlyTop = Math.max(earlyTop, Math.abs(t.sample(2.4).radial));
    } else lateTop = Math.max(lateTop, Math.abs(t.sample(2.4).radial));
  }
  assert.ok(earlyLow > 0.005);
  assert.ok(earlyTop < earlyLow * 0.02);
  assert.ok(lateTop > earlyTop + 0.00005);
  for (let i = 0; i < 1200; i++) t.advance(1 / 120, 35, 45);
  assert.ok(Math.abs(t.sample(0.3).radial) < 0.0001);
});
test('repeated impulses at both ends stay bounded and damping removes motion', () => {
  const soft = new SlimeTissue(),
    damped = new SlimeTissue();
  for (let i = 0; i < 360; i++) {
    if (i % 20 === 0) {
      soft.impulse(i % 40 ? 0.2 : 2.4, 2);
      damped.impulse(i % 40 ? 0.2 : 2.4, 2);
    }
    soft.advance(1 / 120, 10, 5);
    damped.advance(1 / 120, 10, 95);
    for (const y of [0, 0.5, 1, 2, 2.75])
      assert.ok(Math.abs(soft.sample(y).radial) < 0.15);
  }
  let a = 0,
    b = 0;
  for (let i = 0; i < 240; i++) {
    soft.advance(1 / 120, 10, 5);
    damped.advance(1 / 120, 10, 95);
    a += Math.abs(soft.sample(0.5).radial);
    b += Math.abs(damped.sample(0.5).radial);
  }
  assert.ok(b < a * 0.6);
  soft.reset();
  assert.equal(soft.sample(1).radial, 0);
});
