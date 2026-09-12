import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, PerspectiveCamera } from 'three/webgpu';
import { VolumeInteraction } from '../lib/softbody/interaction.ts';
import { characterFixture } from './softbody-fixture.mjs';

function fixture() {
  const { body, profile, bubbles } = characterFixture();
  const mesh = new Mesh(body);
  mesh.userData.optical_profile = JSON.stringify(profile);
  mesh.updateMatrixWorld();
  const camera = new PerspectiveCamera(30, 1, 0.1, 30);
  camera.position.set(0, 1, 8);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const captures = new Set();
  const canvas = {
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id),
  };
  const interaction = new VolumeInteraction(
    canvas,
    camera,
    mesh,
    [mesh],
    bubbles,
  );
  const down = {
    pointerId: 1,
    button: 0,
    buttons: 1,
    pointerType: 'mouse',
    clientX: 200,
    clientY: 200,
    preventDefault() {},
  };
  return { interaction, down, captures };
}
test('gentle hover over the actual body earns affection without grabbing or moving vertices', () => {
  for (const hz of [30, 60, 120]) {
    const { interaction: v, down } = fixture();
    const before = v.solver.x.slice();
    for (let n = 0; n <= hz * 2; n++)
      v.pointerMove({
        ...down,
        buttons: 0,
        clientX: 200 + 12 * Math.sin((n / hz) * 3),
        timeStamp: (n / hz) * 1000,
      });
    v.update(1 / 120);
    assert.equal(v.characterState().social, 'soften');
    assert.ok(v.characterState().joy > 0.6, String(hz));
    assert.equal(v.held, false);
    assert.equal(v.stats().grabs, 0);
    assert.ok(before.every((x, i) => Math.abs(v.solver.x[i] - x) < 0.01));
  }
});

test('off-body travel, fast sweeps and camera buttons do not count as petting', () => {
  for (const mode of ['miss', 'fast', 'camera']) {
    const { interaction: v, down } = fixture();
    for (let n = 0; n < 180; n++)
      v.pointerMove({
        ...down,
        buttons: mode === 'camera' ? 2 : 0,
        clientX:
          mode === 'miss'
            ? 2 + (n % 2)
            : mode === 'fast'
              ? 150 + (n % 2) * 100
              : 200 + (n % 2),
        timeStamp: n * 16.667,
      });
    v.update(1 / 120);
    assert.equal(v.characterState().social, 'none', mode);
    assert.equal(v.characterState().joy, 0, mode);
  }
});

test('lost mouse release and focus cancellation clear the physical grip', () => {
  const { interaction, down, captures } = fixture();
  assert.equal(interaction.pointerDown(down), true);
  assert.equal(interaction.stats().grabbed, true);
  interaction.pointerMove({ ...down, buttons: 0 });
  assert.equal(interaction.stats().grabbed, false);
  assert.equal(captures.size, 0);
  interaction.pointerDown(down);
  interaction.cancel();
  assert.equal(interaction.stats().grabbed, false);
  assert.equal(captures.size, 0);
  interaction.pointerDown(down);
  interaction.reset();
  assert.equal(interaction.stats().grabbed, false);
  assert.equal(interaction.pointerDown(down), true);
});

test('actual pointer gestures distinguish repeated pokes, gentle strokes and a held stretch', () => {
  const { interaction: v, down } = fixture();
  v.setExpression({ responsive: true, autoBlink: false });
  for (let n = 0; n < 3; n++) {
    v.pointerDown({ ...down, timeStamp: n * 160 });
    v.pointerUp({ ...down, timeStamp: n * 160 + 80 });
  }
  assert.equal(v.stats().expression.active, 'angry');
  v.pointerDown({ ...down, timeStamp: 1000 });
  for (let n = 1; n <= 12; n++)
    v.pointerMove({
      ...down,
      clientX: 200 + (n % 2 ? 3 : 0),
      timeStamp: 1000 + n * 60,
    });
  assert.equal(v.stats().expression.active, 'soothed');
  v.pointerUp({ ...down, timeStamp: 1800 });
  v.reset();
  v.pointerDown({ ...down, timeStamp: 2000 });
  v.pointerMove({ ...down, clientY: 100, timeStamp: 2200 });
  assert.equal(v.stats().expression.active, 'effort');
  v.cancel();
  assert.equal(v.stats().expression.active, 'neutral');
  assert.equal(v.stats().grabbed, false);
});

test('subpixel gentle strokes respond equally at 30, 60 and 120 pointer events per second', () => {
  for (const hz of [30, 60, 120]) {
    const { interaction: v, down } = fixture();
    v.pointerDown({ ...down, timeStamp: 0 });
    for (let n = 1; n <= hz; n++) {
      v.pointerMove({
        ...down,
        clientX: 200 + (20 * n) / hz,
        timeStamp: (1000 * n) / hz,
      });
      v.expression.update(1 / hz);
    }
    assert.equal(v.stats().expression.active, 'happy', String(hz));
  }
});

test('returning a stretch near the starting point permits gentle petting without releasing the pointer', () => {
  const { interaction: v, down } = fixture();
  v.pointerDown({ ...down, timeStamp: 0 });
  v.pointerMove({ ...down, clientY: 100, timeStamp: 200 });
  assert.equal(v.stats().expression.active, 'effort');
  v.pointerMove({ ...down, timeStamp: 400 });
  for (let n = 1; n <= 12; n++)
    v.pointerMove({ ...down, clientX: 200 + n, timeStamp: 400 + n * 80 });
  assert.equal(v.stats().expression.active, 'happy');
  assert.equal(v.held, true);
});

test('a physical jump produces a landing reaction, while ordinary initial settling stays quiet', () => {
  const { interaction: v } = fixture();
  v.setExpression({ responsive: true, autoBlink: false });
  for (let n = 0; n < 100; n++) v.update(1 / 60);
  assert.equal(v.stats().expression.active, 'neutral');
  v.drop();
  const reactions = new Set();
  for (let n = 0; n < 240; n++) {
    v.update(1 / 60);
    reactions.add(v.stats().expression.active);
  }
  assert.ok(reactions.has('surprised') || reactions.has('dizzy'));
  assert.equal(v.stats().grabbed, false);
  assert.ok(Number.isFinite(v.stats().expressionMs));
});
