import test from 'node:test';
import assert from 'node:assert/strict';
import { PigmentLayer, PIGMENTS } from '../lib/studio-pigment.ts';

test('pigment controls return exactly to the approved uncolored baseline', () => {
  const dye = new PigmentLayer();
  assert.deepEqual(dye.state, { id: 'rose', amount: 0 });
  const mix = dye.amount;
  const absorption = dye.absorption;
  dye.configure('mint', 100);
  assert.equal(dye.amount.value, 1);
  assert.ok(dye.absorption.value.x > dye.absorption.value.y);
  dye.configure('honey', 43);
  assert.equal(dye.amount.value, 0.43);
  assert.ok(dye.absorption.value.z > dye.absorption.value.x);
  dye.configure('rose', 100);
  assert.equal(dye.amount.value, 0);
  assert.equal(dye.amount, mix, 'switching must reuse the compiled uniform');
  assert.equal(dye.absorption, absorption);
});

test('invalid pigment controls cannot send NaN or unbounded strength to the GPU', () => {
  const dye = new PigmentLayer();
  dye.configure('mint', 140);
  assert.equal(dye.amount.value, 1);
  dye.configure('honey', -20);
  assert.equal(dye.amount.value, 0);
  dye.configure('mint', NaN);
  assert.equal(dye.amount.value, 0);
  dye.configure('unknown', 100);
  assert.deepEqual(dye.state, { id: 'rose', amount: 0 });
  for (const value of dye.absorption.value.toArray())
    assert.ok(Number.isFinite(value));
});

test('the middle of the mint transition uses a colored palette, not a grey RGB crossfade', () => {
  const dye = new PigmentLayer();
  dye.configure('mint', 50);
  assert.equal(
    dye.colorWeight.value,
    1,
    'fully use the colored palette at half progress',
  );
  const a = dye.absorption.value;
  assert.ok(
    a.x < 0.01 && a.y < 0.15 && a.z > 0.9,
    'halfway is a warm light gold before mint',
  );
  for (let percent = 0; percent <= 100; percent++) {
    dye.configure('mint', percent);
    const channels = dye.absorption.value.toArray();
    assert.ok(
      Math.min(...channels) < 0.06,
      'retain a transparent light channel',
    );
    assert.ok(
      Math.max(...channels) - Math.min(...channels) > 0.7,
      'retain color separation',
    );
  }
});

test('warm and cool candy colors stay finite, colored and reversible across their complete transitions', () => {
  const dye = new PigmentLayer();
  for (const id of ['strawberry', 'peach', 'lemon', 'sky', 'grape']) {
    assert.ok(
      PIGMENTS.some((p) => p.id === id),
      `${id} must be selectable`,
    );
    for (let percent = 0; percent <= 100; percent++) {
      dye.configure(id, percent);
      assert.equal(dye.state.id, id);
      const a = dye.absorption.value.toArray();
      assert.ok(a.every((v) => Number.isFinite(v) && v >= 0 && v <= 2));
      assert.ok(
        Math.max(...a) - Math.min(...a) > 0.7,
        `${id} retains color at ${percent}%`,
      );
    }
    dye.configure(id, 0);
    assert.equal(dye.colorWeight.value, 0);
    dye.configure('rose', 100);
    assert.deepEqual(dye.state, { id: 'rose', amount: 0 });
  }
  dye.configure('sky', 100);
  assert.ok(
    dye.absorption.value.x > dye.absorption.value.y &&
      dye.absorption.value.y > dye.absorption.value.z,
    'sky retains blue light',
  );
  dye.configure('grape', 100);
  assert.ok(
    dye.absorption.value.y > dye.absorption.value.x &&
      dye.absorption.value.x > dye.absorption.value.z,
    'grape retains red and blue light',
  );
});
