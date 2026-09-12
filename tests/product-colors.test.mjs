import test from 'node:test';
import assert from 'node:assert/strict';
import { AbsorptionField } from '../lib/absorption-field.ts';
import { PigmentLayer } from '../lib/studio-pigment.ts';
import { Vector3 } from 'three/webgpu';

test('direct selection survives a canceled dye and restores the exact rose bypass', () => {
  const f = new AbsorptionField();
  assert.equal(typeof f.select, 'function');
  f.select('grape', 70, 8);
  f.setTarget('mint');
  f.released.value = 0.8;
  f.clear();
  assert.equal(f.state.base, 'grape');
  assert.equal(f.appearance.strength, 70);
  f.select('rose', 100, 0);
  assert.equal(f.state.base, 'rose');
  assert.equal(f.released.value, 0);
  assert.equal(f.appearance.hue, 0);
});

test('saved appearance keeps a spatial mixture independently of subsequent digestion', () => {
  const f = new AbsorptionField();
  assert.equal(typeof f.freeze, 'function');
  f.select('peach', 85, 0);
  f.setTarget('mint');
  f.released.value = 0.75;
  f.radius.value = 1.3;
  f.drift.value = 0.8;
  const saved = f.freeze();
  f.commit();
  f.restore(saved);
  assert.equal(f.state.base, 'peach');
  assert.equal(f.state.target, 'mint');
  assert.equal(f.released.value, 0.75);
  assert.equal(f.radius.value, 1.3);
  f.restore({ base: 'bad', strength: NaN, radius: Infinity });
  assert.equal(f.state.base, 'rose');
  assert.ok(Number.isFinite(f.radius.value));
});

test('palette concentration does not travel through a different hue', () => {
  const p = new PigmentLayer();
  assert.equal(typeof p.configureShade, 'function');
  p.configureShade('mint', 20, 0);
  const a = p.shadeAbsorption.value.toArray();
  p.configureShade('mint', 100, 0);
  assert.deepEqual(p.shadeAbsorption.value.toArray(), a);
  assert.equal(p.shadeStrength.value, 1);
  p.configureShade('grape', Infinity, NaN);
  assert.ok(p.shadeAbsorption.value.toArray().every(Number.isFinite));
  p.configureShade('rose', 100, 0);
  assert.equal(p.shadeEnabled.value, 0);
  assert.equal(p.colorWeight.value, 0);
});

test('new dye starts over the saved spatial appearance and commit releases its history', () => {
  const f = new AbsorptionField(2);
  f.restore({
    base: 'rose',
    target: 'mint',
    released: 0.75,
    settled: 0.1,
    radius: 1.6,
    source: [0, 0.7, 0.8],
  });
  const saved = f.freeze();
  f.beginDye('honey', new Vector3(0.2, 0.8, 1));
  assert.deepEqual(f.freeze().underlay, saved);
  assert.equal(f.released.value, 0);
  const mixed = f.freeze();
  f.restore(mixed);
  assert.deepEqual(f.freeze(), mixed);
  f.commit();
  assert.equal(f.state.base, 'honey');
  assert.equal(f.freeze().underlay, null);
});
