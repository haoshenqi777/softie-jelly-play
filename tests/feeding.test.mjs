import test from 'node:test';
import assert from 'node:assert/strict';
import { CandyWorld } from '../lib/candy-physics.ts';
import { SlimeFeeding } from '../lib/slime-feeding.ts';
const body = {
  x: 0,
  y: 0,
  z: 0,
  mouth: { x: 0, y: 1.025, z: 1.18 },
  held: false,
  bound: 2.3,
};
test('food selection stays locked instead of switching between nearby candies', () => {
  const w = new CandyWorld(),
    f = new SlimeFeeding();
  const a = w.spawn('#6ecfb1', 'gummy', { x: 0.7, y: 0.085, z: 1.5 });
  const b = w.spawn('#ffe18a', 'hard', { x: 0.8, y: 0.085, z: 1.5 });
  f.update(0.1, w.candies, body, true);
  assert.equal(f.targetId, a.id);
  b.x = 0.1;
  f.update(0.1, w.candies, body, true);
  assert.equal(f.targetId, a.id);
  w.remove(a.id);
  f.update(0.1, w.candies, body, true);
  assert.equal(f.targetId, b.id);
});
test('a full or manually held slime never pursues or swallows available food', () => {
  const w = new CandyWorld(),
    f = new SlimeFeeding();
  w.spawn('#6ecfb1', 'gummy', { x: 0, y: 1.025, z: 1.18 });
  let action = f.update(0.1, w.candies, body, false);
  assert.equal(f.targetId, null);
  assert.equal(action.hop, null);
  action = f.update(0.1, w.candies, { ...body, held: true }, true);
  assert.equal(action.hop, null);
  assert.equal(f.contact(w.candies, body.mouth), null);
});
test('a matching screen position is insufficient when the candy is behind the face', () => {
  const w = new CandyWorld(),
    f = new SlimeFeeding();
  const c = w.spawn('#6ecfb1', 'gummy', { x: 0, y: 1.025, z: -0.9 });
  for (let i = 0; i < 5; i++) f.update(0.1, w.candies, body, true);
  assert.equal(f.contact(w.candies, body.mouth), null);
  c.z = 1.18;
  f.update(0.1, w.candies, body, true);
  assert.equal(f.contact(w.candies, body.mouth), c.id);
});
test('swept contact catches a fast candy crossing the mouth between frames', () => {
  const w = new CandyWorld(),
    f = new SlimeFeeding();
  const c = w.spawn('#6ecfb1', 'gummy', { x: -0.25, y: 1.025, z: 1.18 });
  for (let i = 0; i < 4; i++) f.update(0.1, w.candies, body, true);
  c.x = 0.25;
  assert.equal(f.contact(w.candies, body.mouth), c.id);
});
test('ground pickup needs nearby contact and emits only one lifting impulse', () => {
  const w = new CandyWorld(),
    f = new SlimeFeeding();
  const c = w.spawn('#6ecfb1', 'gummy', { x: 0, y: 0.085, z: 1.5 });
  let lifts = 0;
  for (let i = 0; i < 90; i++) {
    const a = f.update(1 / 120, w.candies, body, true);
    if (a.scoopId === c.id) lifts++;
  }
  assert.equal(lifts, 1);
  c.x = 2;
  for (let i = 0; i < 90; i++)
    assert.equal(f.update(1 / 120, w.candies, body, true).scoopId, null);
});
