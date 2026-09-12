import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SlimeAbsorption,
  sampleAbsorption,
  absorptionPosition,
  absorptionCompression,
} from '../lib/slime-absorption.ts';
import { CandyWorld } from '../lib/candy-physics.ts';
import { SlimeDynamics } from '../lib/slime-physics.ts';
import { SlimeContactSurface } from '../lib/slime-contact.ts';

test('capturing a compressed bouncing gummy preserves its shape at the handoff', () => {
  assert.equal(absorptionCompression(0.17136, 0), 0.17136);
  let before = 0.17136;
  for (let i = 0; i < 100; i++) {
    const value = absorptionCompression(0.17136, i / 100);
    assert.ok(Math.abs(value - before) < 0.02);
    before = value;
  }
  assert.ok(Math.abs(absorptionCompression(0.17136, 1.2)) < 0.00001);
});

test('a high contact first enters locally then drifts slowly to the lower belly', () => {
  const origin = { x: 0.8, y: 2, z: 0.7 },
    normal = { x: 0.4, y: 0.6, z: 0.6 };
  assert.deepEqual(absorptionPosition(origin, normal, 0), origin);
  const enclosed = absorptionPosition(origin, normal, 0.9),
    settled = absorptionPosition(origin, normal, 2.4);
  assert.ok(enclosed.y > 1.7, 'local entry precedes descent');
  assert.ok(settled.y < 0.7 && settled.y > 0.3, 'sugar stays below the face');
  let before = origin;
  for (let i = 0; i < 400; i++) {
    const p = absorptionPosition(origin, normal, i / 100);
    assert.ok(
      Math.hypot(p.x - before.x, p.y - before.y, p.z - before.z) < 0.025,
    );
    before = p;
  }
});

test('absorption retains a solid candy after enclosure and melts continuously', () => {
  const start = sampleAbsorption(0),
    enclosed = sampleAbsorption(1.1),
    inner = sampleAbsorption(1.6);
  assert.equal(start.enclosure, 0);
  assert.equal(start.melt, 0);
  assert.equal(enclosed.enclosure, 1);
  assert.ok(inner.melt < 0.12);
  let last = 0;
  for (let i = 0; i < 700; i++) {
    const p = sampleAbsorption(i / 100);
    assert.ok(p.melt >= last);
    assert.ok(p.melt - last < 0.02);
    last = p.melt;
  }
  assert.equal(last, 1);
});
for (const [x, z] of [
  [0, 1.2],
  [2.1, 2.6],
  [-2.1, -0.5],
])
  test(`body reaches and encloses floor candy at ${x},${z} without tossing it to its mouth`, () => {
    const w = new CandyWorld(),
      s = new SlimeDynamics(),
      skin = new SlimeContactSurface(s),
      a = new SlimeAbsorption();
    const c = w.spawn('#6ecfb1', 'gummy', { x, y: 0.085, z });
    let contact = false;
    for (let i = 0; i < 1800; i++) {
      a.update(1 / 120, w.candies, s, true);
      s.advance(1 / 120);
      if (a.contact(w.candies, skin, s) !== null) {
        contact = true;
        break;
      }
      w.advance(1 / 120, {
        x: s.x,
        y: s.y,
        z: s.z,
        mouth: { x: 99, y: 99, z: 99 },
        edibleId: null,
        contact: skin.contact,
      });
    }
    assert.ok(contact, JSON.stringify({ c, body: [s.x, s.y, s.z] }));
    assert.ok(c.y < 0.3, 'the candy stays on the table');
  });
test('held food remains player-owned and fullness disables all capture', () => {
  const w = new CandyWorld(),
    s = new SlimeDynamics(),
    skin = new SlimeContactSurface(s),
    a = new SlimeAbsorption();
  const c = w.spawn('#fff', 'gummy', { x: 0, y: 0.7, z: 1.15 });
  w.grab(c.id);
  for (let i = 0; i < 90; i++) {
    a.update(1 / 120, w.candies, s, true);
    s.advance(1 / 120);
    assert.equal(a.contact(w.candies, skin, s), null);
  }
  w.release();
  a.update(1 / 120, w.candies, s, false);
  assert.equal(a.targetId, null);
  assert.equal(a.contact(w.candies, skin, s), null);
});
