import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Matrix4 } from 'three/webgpu';
import { characterFixture } from './softbody-fixture.mjs';
import { ExpressionRig, EXPRESSIONS } from '../lib/softbody/expression.ts';
import { FeedingReaction } from '../lib/softbody/feeding-reaction.ts';
function fixture() {
  const f = characterFixture();
  const parts = ['Eye.L', 'Eye.R', 'Smile'].map((name) => {
    const m = new Mesh(f.geometry(name));
    m.name = name;
    return m;
  });
  const original = parts.map((p) =>
    p.geometry.attributes.position.array.slice(),
  );
  return { ...f, parts, original, rig: new ExpressionRig(f.body, parts) };
}

const characterIntent = (phase, mood) => ({
  phase,
  mood,
  destination: null,
  facing: [0, 0, 1],
  gait: 'scoot',
  desiredSpeed: 0,
  body: 'quiet',
});

test('an attentive meal does not accumulate sleep and leaves a relaxed awake face', () => {
  const { rig } = fixture(),
    meal = new FeedingReaction();
  rig.configure({ responsive: true, autoBlink: false });
  for (let i = 0; i < 33 * 60; i++) rig.update(1 / 60);
  assert.equal(
    rig.stats().active,
    'sleepy',
    'the meal begins after natural sleep',
  );
  for (let i = 0; i < 40 * 60; i++) {
    rig.setMealContext(
      meal.step(1 / 60, {
        id: 1,
        stage: 'settling',
        held: false,
        pressure: 0,
        withdrawing: false,
        wrap: 1,
        diffusionAge: 9,
      }),
    );
    rig.update(1 / 60);
  }
  rig.setMealContext(null);
  rig.update(1 / 60);
  assert.equal(
    rig.stats().active,
    'neutral',
    'feeding is active attention, not forty seconds of abandonment',
  );
});

test('new meal performance yields to recovery, direct stretching and manual expressions', () => {
  const { rig } = fixture(),
    meal = new FeedingReaction();
  rig.configure({ responsive: true });
  rig.setMealContext(
    meal.step(1 / 60, {
      id: 1,
      stage: 'dissolving',
      held: false,
      pressure: 0,
      withdrawing: false,
      wrap: 1,
      diffusionAge: 1.25,
    }),
  );
  rig.setCharacterContext(characterIntent('absorbing', 0));
  assert.equal(rig.stats().active, 'content');
  rig.setCharacterContext(characterIntent('righting', 0));
  rig.notify('stumble', 1);
  assert.equal(rig.stats().active, 'dizzy');
  rig.notify('righting', 1);
  assert.equal(rig.stats().active, 'effort');
  rig.notify('recovered');
  rig.setCharacterContext(characterIntent('absorbing', 0));
  assert.equal(rig.stats().active, 'soothed');
  for (let i = 0; i < 140; i++) rig.update(1 / 60);
  assert.equal(rig.stats().active, 'content');
  rig.notify('stretch', 0.8);
  assert.equal(rig.stats().active, 'effort');
  rig.configure({ expression: 'sad' });
  assert.equal(rig.stats().active, 'sad');
});

test('feeding yields to stumble and the full recovery reaction before resuming', () => {
  const { rig } = fixture();
  rig.configure({ responsive: true });
  rig.setFeedingContext('dissolving');
  rig.setCharacterContext(characterIntent('absorbing', 0));
  assert.equal(rig.stats().active, 'happy');
  rig.setCharacterContext(characterIntent('righting', 0));
  rig.notify('stumble', 1);
  assert.equal(rig.stats().active, 'dizzy');
  rig.notify('recovered');
  rig.setCharacterContext(characterIntent('absorbing', 0));
  assert.equal(rig.stats().active, 'soothed');
  for (let i = 0; i < 50; i++) rig.update(1 / 60);
  assert.equal(rig.stats().active, 'proud');
  for (let i = 0; i < 70; i++) rig.update(1 / 60);
  assert.equal(rig.stats().active, 'happy');
});

test('persistent irritation survives a fleeting touch while physical effort retains priority', () => {
  const { rig } = fixture();
  rig.configure({ responsive: true, autoBlink: false, gaze: false });
  for (const phase of ['arrived', 'idle', 'righting']) {
    rig.setCharacterContext(characterIntent(phase, 0.23));
    assert.equal(rig.stats().active, 'angry', phase);
  }
  rig.notify('righting', 0.8);
  assert.equal(rig.stats().active, 'effort');
  rig.notify('recovery-cancel');
  assert.equal(rig.stats().active, 'angry');
  rig.notify('touch');
  assert.equal(rig.stats().active, 'angry');
  for (let i = 0; i < 90; i++) rig.update(1 / 60);
  assert.equal(rig.stats().active, 'angry');
  rig.configure({ expression: 'content' });
  assert.equal(rig.stats().active, 'content', 'manual auditions remain final');
});

test('shared social intent carries the face through gradual comfort, even during a gentle hold', () => {
  const { rig } = fixture();
  rig.configure({ responsive: true });
  for (const [social, mood, expected] of [
    ['look', 0.6, 'sad'],
    ['inflate', 0.6, 'angry'],
    ['stamp', 0.6, 'angry'],
    ['wait', 0.5, 'angry'],
    ['soften', 0.25, 'soothed'],
    ['nuzzle', 0.08, 'content'],
    ['content', 0, 'happy'],
  ]) {
    rig.setCharacterContext({
      ...characterIntent('arrived', mood),
      social,
      socialAge: 0.1,
      comfort: 0.7,
      joy: 0.8,
    });
    rig.notify('stroke', 0.1);
    assert.equal(rig.stats().active, expected, social);
  }
  rig.setCharacterContext({ ...characterIntent('held', 0.5), social: 'none' });
  rig.notify('touch');
  assert.equal(rig.stats().active, 'angry');
  rig.setCharacterContext({
    ...characterIntent('held', 0.2),
    social: 'soften',
  });
  assert.equal(rig.stats().active, 'soothed');
  rig.notify('stretch', 0.8);
  assert.equal(rig.stats().active, 'effort');
});

test('irritation visibly eases toward neutral instead of dropping a minimum-strength face', () => {
  const { rig, parts, original } = fixture();
  rig.configure({
    responsive: true,
    autoBlink: false,
    gaze: false,
    microMotion: false,
  });
  const deformation = [];
  for (const mood of [0.5, 0.23, 0.01, 0]) {
    rig.setCharacterContext(characterIntent('idle', mood));
    for (let i = 0; i < 90; i++) rig.update(1 / 60);
    deformation.push(
      Math.sqrt(
        parts.reduce(
          (sum, part, p) =>
            sum +
            part.geometry.attributes.position.array.reduce(
              (s, value, i) => s + (value - original[p][i]) ** 2,
              0,
            ),
          0,
        ),
      ),
    );
  }
  assert.ok(deformation[0] > 0.01, JSON.stringify(deformation));
  assert.ok(
    deformation[1] < deformation[0] * 0.85,
    JSON.stringify(deformation),
  );
  assert.ok(deformation[2] < deformation[1] * 0.1, JSON.stringify(deformation));
  assert.ok(deformation[3] < 0.001, JSON.stringify(deformation));
});
test('responsive expression reacts without body movement and slider changes keep the current emotion', () => {
  const { rig, parts } = fixture();
  rig.configure({ responsive: true, autoBlink: false, gaze: false });
  rig.notify('sleep');
  for (let i = 0; i < 90; i++) rig.update(1 / 60);
  assert.equal(rig.stats().active, 'sleepy');
  const asleep = parts[0].geometry.attributes.position.array.slice();
  rig.configure({ intensity: 90 });
  assert.equal(rig.stats().active, 'sleepy');
  rig.notify('touch');
  for (let i = 0; i < 20; i++) rig.update(1 / 60);
  assert.equal(rig.stats().active, 'waking');
  assert.ok(
    asleep.some(
      (v, i) =>
        Math.abs(v - parts[0].geometry.attributes.position.array[i]) > 0.02,
    ),
  );
  rig.configure({ expression: 'content' });
  rig.notify('poke');
  rig.update(0.1);
  assert.equal(rig.stats().active, 'content');
  rig.configure({ responsive: true });
  assert.equal(rig.stats().active, 'neutral');
});
test('neutral expression exactly preserves approved face and follows rigid body transforms', () => {
  const { body, parts, original, rig } = fixture();
  rig.configure({ autoBlink: false, gaze: false });
  rig.update(0);
  for (let p = 0; p < parts.length; p++)
    assert.ok(
      original[p].every(
        (v, i) =>
          Math.abs(v - parts[p].geometry.attributes.position.array[i]) < 2e-6,
      ),
    );
  const transform = new Matrix4().makeRotationY(0.8);
  transform.setPosition(0.3, 0.7, -0.2);
  body.applyMatrix4(transform);
  rig.update(0);
  for (let p = 0; p < parts.length; p++) {
    const expected = parts[p].geometry.clone();
    expected.attributes.position.array.set(original[p]);
    expected.applyMatrix4(transform);
    assert.ok(
      expected.attributes.position.array.every(
        (v, i) =>
          Math.abs(v - parts[p].geometry.attributes.position.array[i]) < 3e-6,
      ),
    );
  }
});
test('all expressive poses remain finite and small, with continuous transitions', () => {
  const { parts, rig } = fixture();
  rig.configure({ autoBlink: false, gaze: false });
  for (const { id } of EXPRESSIONS) {
    const before = parts[0].geometry.attributes.position.array.slice();
    rig.configure({ expression: id, intensity: 100 });
    rig.update(1 / 240);
    assert.ok(
      before.every(
        (v, i) =>
          Math.abs(v - parts[0].geometry.attributes.position.array[i]) < 0.025,
      ),
      'no abrupt pose switch',
    );
    for (let i = 0; i < 120; i++) rig.update(1 / 60);
    for (const p of parts) {
      p.geometry.computeBoundingBox();
      const b = p.geometry.boundingBox;
      assert.ok(p.geometry.attributes.position.array.every(Number.isFinite));
      assert.ok(b.max.x - b.min.x < 0.34);
      assert.ok(b.max.y - b.min.y < 0.36);
    }
  }
});
test('blink closes and reopens the eyes even without any body updates', () => {
  const { parts, rig } = fixture();
  rig.configure({ autoBlink: false, gaze: false });
  const height = () => {
    parts[0].geometry.computeBoundingBox();
    return (
      parts[0].geometry.boundingBox.max.y - parts[0].geometry.boundingBox.min.y
    );
  };
  rig.update(0);
  const open = height();
  rig.blink();
  for (let i = 0; i < 6; i++) rig.update(1 / 60);
  assert.ok(height() < open * 0.35);
  for (let i = 0; i < 30; i++) rig.update(1 / 60);
  assert.ok(Math.abs(height() - open) < 1e-5);
});

test('repeated blink while the eyelid is closing cannot snap it open', () => {
  const { rig, parts } = fixture();
  rig.configure({ autoBlink: false, gaze: false });
  rig.blink();
  for (let i = 0; i < 8; i++) rig.update(1 / 60);
  const before = parts[0].geometry.attributes.position.array.slice();
  rig.blink();
  rig.update(1 / 60);
  const after = parts[0].geometry.attributes.position.array;
  assert.ok(before.every((v, i) => Math.abs(v - after[i]) < 0.04));
});

test('small open mouths stay symmetric and close into an o instead of a spiral', () => {
  const { parts, rig } = fixture();
  rig.configure({ autoBlink: false, gaze: false });
  for (const expression of ['curious', 'surprised', 'sleepy']) {
    rig.configure({ expression, intensity: 80 });
    for (let i = 0; i < 120; i++) rig.update(1 / 60);
    const a = parts[2].geometry.attributes.position.array;
    const center = (r) =>
      [0, 1].map((k) => {
        let sum = 0;
        for (let v = 0; v < 10; v++) sum += a[(r * 10 + v) * 3 + k] / 10;
        return sum;
      });
    for (let r = 0; r <= 40; r++) {
      const left = center(r),
        right = center(40 - r);
      assert.ok(
        Math.abs(left[0] + right[0]) < 0.002,
        'symmetric mouth centerline',
      );
      assert.ok(
        Math.abs(left[1] - right[1]) < 0.002,
        'level paired curve samples',
      );
    }
    assert.ok(
      Math.hypot(...center(0).map((v, k) => v - center(40)[k])) < 0.002,
      'closed small o',
    );
  }
});

test('giggle lifts the lower right lid while retaining its round upper edge, and soothed keeps one open bean', () => {
  const { parts, original, rig } = fixture();
  rig.configure({
    expression: 'giggle',
    autoBlink: false,
    gaze: false,
    microMotion: false,
  });
  for (let i = 0; i < 180; i++) rig.update(1 / 60);
  parts[1].geometry.computeBoundingBox();
  const ys = Array.from(original[1]).filter((_, i) => i % 3 === 1);
  assert.ok(
    Math.abs(parts[1].geometry.boundingBox.max.y - Math.max(...ys)) < 0.004,
  );
  assert.ok(parts[1].geometry.boundingBox.min.y > Math.min(...ys) + 0.07);
  rig.configure({ expression: 'soothed' });
  for (let i = 0; i < 180; i++) rig.update(1 / 60);
  assert.ok(
    original[0].every(
      (v, i) =>
        Math.abs(v - parts[0].geometry.attributes.position.array[i]) < 3e-6,
    ),
  );
});

test('sixteen designed faces are distinct, bounded and keep the original black-eye materials', () => {
  assert.equal(EXPRESSIONS.length, 16);
  const { rig, parts, original } = fixture();
  const materials = parts.map((p) => p.material);
  const shapes = [];
  for (const { id } of EXPRESSIONS) {
    rig.configure({
      expression: id,
      intensity: 100,
      autoBlink: false,
      gaze: false,
      microMotion: false,
    });
    for (let i = 0; i < 180; i++) rig.update(1 / 60);
    const shape = parts.flatMap((p) =>
      Array.from(p.geometry.attributes.position.array),
    );
    assert.ok(shape.every(Number.isFinite), id);
    assert.ok(
      shapes.every((other) =>
        shape.some((v, i) => Math.abs(v - other[i]) > 0.004),
      ),
      id + ' has its own contour',
    );
    shapes.push(shape);
    parts.forEach((p, i) =>
      assert.equal(p.material, materials[i], 'no white-eye material'),
    );
  }
  rig.configure({ intensity: 0 });
  for (let i = 0; i < 180; i++) rig.update(1 / 60);
  parts.forEach((p, k) =>
    assert.ok(
      original[k].every(
        (v, i) => Math.abs(v - p.geometry.attributes.position.array[i]) < 3e-6,
      ),
    ),
  );
});

test('sad and angry upper lids leave the rounded lower eye in place', () => {
  const { rig, parts, original } = fixture();
  const eye = parts[0].geometry.attributes.position;
  const bottom = Math.min(
    ...Array.from(original[0]).filter((_, i) => i % 3 === 1),
  );
  for (const expression of ['sad', 'angry']) {
    rig.configure({
      expression,
      intensity: 100,
      autoBlink: false,
      gaze: false,
      microMotion: false,
    });
    for (let i = 0; i < 180; i++) rig.update(1 / 60);
    const ys = Array.from(eye.array).filter((_, i) => i % 3 === 1);
    assert.ok(
      Math.abs(Math.min(...ys) - bottom) < 0.008,
      'keep round lower boundary instead of rotating/squashing the bean',
    );
    assert.ok(
      Math.max(...ys) - bottom > 0.14,
      'eyelid must retain a full rounded eye bottom',
    );
  }
});
