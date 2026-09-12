import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { BodyPosture } from '../lib/softbody/posture.ts';
import { SelfRighting } from '../lib/softbody/recovery.ts';
import { characterFixture } from './softbody-fixture.mjs';
import { Mesh, PerspectiveCamera } from 'three/webgpu';
import { VolumeInteraction } from '../lib/softbody/interaction.ts';
import { FloorSurface } from '../lib/softbody/floor-surface.ts';
import { BodyGesture } from '../lib/softbody/body-gesture.ts';

const bytes = readFileSync(
  new URL('../public/physics/volume.wasm', import.meta.url),
);
function rotate(s, axis, angle) {
  const c = Math.cos(angle),
    n = Math.sin(angle);
  const a = axis === 'x' ? 1 : 0,
    b = axis === 'x' ? 2 : 1;
  for (let i = 0; i < s.nodeCount; i++) {
    const va = s.rest[i * 3 + a],
      vb = s.rest[i * 3 + b];
    s.x[i * 3 + a] = c * va - n * vb;
    s.x[i * 3 + b] = n * va + c * vb;
  }
  const low = Math.min(...s.x.filter((_, i) => i % 3 === 1));
  for (let i = 1; i < s.x.length; i += 3) s.x[i] -= low;
}

test('whole-body posture distinguishes upside down from a squashed or locally bent crown', () => {
  const s = new VolumeSoftBody(characterFixture().cage);
  const sensor = new BodyPosture(s.rest, s.mass);
  assert.ok(sensor.sample(s.x, s.velocity).up[1] > 0.999);
  for (let i = 0; i < s.nodeCount; i++) {
    s.x[i * 3 + 1] *= 0.65;
    if (s.rest[i * 3 + 1] > 1.8) s.x[i * 3] += 0.3;
  }
  assert.ok(
    sensor.sample(s.x, s.velocity).up[1] > 0.95,
    'local crown bend is not a fallen body',
  );
  s.reset();
  rotate(s, 'z', Math.PI);
  assert.ok(sensor.sample(s.x, s.velocity).up[1] < -0.999);
  s.reset();
  rotate(s, 'x', Math.PI / 2);
  assert.ok(Math.abs(sensor.sample(s.x, s.velocity).up[1]) < 1e-5);
});

test('regional body gestures cannot teleport the skin or add net translation, and release leaves no motor force', () => {
  const s = new VolumeSoftBody(characterFixture().cage),
    gesture = new BodyGesture(s);
  const pose = new BodyPosture(s.rest, s.mass).sample(s.x, s.velocity),
    before = s.x.slice();
  for (let k = 0; k < 100; k++)
    gesture.drive(pose, [0, 0, 1], -0.1, 0.06, 0.1, 1 / 240);
  assert.deepEqual(s.x, before);
  assert.ok(s.velocity.some((v) => Math.abs(v) > 0.1));
  for (let c = 0; c < 3; c++)
    assert.ok(
      Math.abs(s.mass.reduce((a, m, i) => a + m * s.velocity[i * 3 + c], 0)) <
        1e-9,
    );
  gesture.reset();
  const velocity = s.velocity.slice();
  gesture.drive(pose, [0, 0, 1], 0, 0, 0, 1 / 240);
  assert.deepEqual(s.velocity, velocity);
});

test('angular effort adds no net linear momentum and never changes rest geometry', () => {
  const s = new VolumeSoftBody(characterFixture().cage);
  const rest = s.rest.slice();
  s.actuate([2, 0, -3], [0, 1, 0], 8, 1 / 240);
  for (let k = 0; k < 3; k++) {
    const momentum = s.mass.reduce(
      (sum, m, i) => sum + m * s.velocity[i * 3 + k],
      0,
    );
    assert.ok(Math.abs(momentum) < 1e-9, `${k}: ${momentum}`);
  }
  assert.ok(s.velocity.some((v) => Math.abs(v) > 0.001));
  assert.deepEqual(s.rest, rest);
});

test('physical self-righting recovers left, right, front, back and exact inversion', async () => {
  const { cage, body } = characterFixture();
  const contact = new FloorSurface(cage, body.getAttribute('position').array);
  const timings = [];
  for (const [axis, angle] of [
    ['z', Math.PI / 2],
    ['z', -Math.PI / 2],
    ['x', Math.PI / 2],
    ['x', -Math.PI / 2],
    ['z', Math.PI],
  ]) {
    const s = new VolumeSoftBody(cage);
    await s.accelerate(bytes);
    rotate(s, axis, angle);
    const original = s.rest.slice();
    const events = [];
    let elapsed = 0,
      rollAt = null,
      recoveredAt = null;
    const transitions = [];
    const controller = new SelfRighting(s, (event) => {
      events.push(event);
      if (event === 'recovered' && recoveredAt === null) recoveredAt = elapsed;
    });
    for (let k = 0; k < 2880; k++) {
      elapsed = (k + 1) / 240;
      s.advance(1 / 240, (dt) => {
        s.setFloorLevel(contact.level(s.x));
        controller.step(dt, false);
      });
      if (controller.stats().phase === 'roll' && rollAt === null)
        rollAt = elapsed;
      const state = controller.stats();
      if (transitions.at(-1)?.phase !== state.phase)
        transitions.push({ phase: state.phase, at: elapsed, up: state.upY });
    }
    timings.push({ axis, angle, rollAt, recoveredAt, transitions });
    const state = controller.stats();
    assert.ok(state.upY > 0.96, JSON.stringify({ axis, angle, state }));
    assert.ok(s.stats().minJacobian > 0.5, JSON.stringify(s.stats()));
    assert.ok(Math.abs(s.stats().volumeRatio - 1) < 0.03);
    assert.ok(
      events.includes('recovered'),
      JSON.stringify({ axis, angle, events, state }),
    );
    assert.deepEqual(s.rest, original);
    console.log('recovered', axis, angle.toFixed(2), state);
  }
  console.log('self-righting timing', timings);
  assert.ok(
    timings.every((t) => t.rollAt !== null && t.rollAt < 1.3),
    'begin rolling promptly after a settled topple: ' + JSON.stringify(timings),
  );
  assert.ok(
    timings.every((t) => t.recoveredAt !== null && t.recoveredAt < 4.2),
    'recover without prolonged scripted waiting: ' + JSON.stringify(timings),
  );
});

test('holding or disabling immediately cancels effort; ordinary upright idle stays asleep', async () => {
  const s = new VolumeSoftBody(characterFixture().cage);
  await s.accelerate(bytes);
  rotate(s, 'z', Math.PI);
  const events = [];
  const controller = new SelfRighting(s, (event) => events.push(event));
  for (let k = 0; k < 250; k++)
    s.advance(1 / 240, (dt) => controller.step(dt, false));
  const before = s.velocity.slice();
  controller.step(1 / 240, true);
  assert.deepEqual(s.velocity, before);
  assert.equal(controller.stats().phase, 'idle');
  assert.ok(events.includes('recovery-cancel'));
  controller.setEnabled(false);
  controller.step(1 / 240, false);
  assert.deepEqual(s.velocity, before);
  s.reset();
  controller.reset();
  controller.setEnabled(true);
  for (let k = 0; k < 2880; k++)
    s.advance(1 / 240, (dt) => controller.step(dt, false));
  assert.equal(s.sleeping, true);
  assert.equal(controller.stats().phase, 'idle');
});

test('the gentle preview nudge produces a bounded side tilt, linked effort and recovery without teleporting', async () => {
  const { body, profile, bubbles } = characterFixture();
  const mesh = new Mesh(body);
  mesh.userData.optical_profile = JSON.stringify(profile);
  const v = new VolumeInteraction(
    { style: {}, hasPointerCapture: () => false },
    new PerspectiveCamera(),
    mesh,
    [mesh],
    bubbles,
  );
  await v.solver.accelerate(bytes);
  v.setExpression({ responsive: true });
  const before = v.solver.x.slice();
  v.tip();
  assert.deepEqual(v.solver.x, before);
  const velocity = v.solver.velocity.slice();
  v.tip();
  assert.deepEqual(
    v.solver.velocity,
    velocity,
    'repeated clicks cannot stack impulses',
  );
  let minimumUp = 1;
  let maxSide = 0;
  let groundedGap = 0;
  const phases = new Set(),
    faces = new Set();
  for (let k = 0; k < 300; k++) {
    v.update(1 / 30);
    const state = v.stats();
    minimumUp = Math.min(minimumUp, state.recovery.upY);
    for (let i = 0; i < v.solver.nodeCount; i++)
      maxSide = Math.max(maxSide, Math.abs(v.solver.x[i * 3]));
    phases.add(state.recovery.phase);
    const cageLow = Math.min(...v.solver.x.filter((_, i) => i % 3 === 1));
    if (
      state.recovery.phase === 'notice' &&
      cageLow - v.solver.floorLevel < 0.005
    )
      groundedGap = Math.max(groundedGap, body.boundingBox.min.y);
    faces.add(state.expression.active);
  }
  console.log('preview nudge', {
    minimumUp,
    phases: [...phases],
    faces: [...faces],
  });
  assert.ok(
    minimumUp < 0.82,
    'nudge must actually topple enough to be noticed',
  );
  // A gentle lean can reach upright before a whole rendered rolling frame;
  // complete inverted starts are covered separately above.
  assert.ok(
    phases.has('brace') && phases.has('settle') && phases.has('celebrate'),
  );
  assert.ok(
    maxSide < 2.25,
    `gentle demo should stay near its original footprint: ${maxSide}`,
  );
  assert.ok(
    groundedGap < 0.035,
    `a grounded reaction must use the visible contact: ${groundedGap}`,
  );
  assert.ok(faces.has('effort') && faces.has('soothed') && faces.has('proud'));
  assert.ok(v.recovery.stats().upY > 0.96);
});

test('the rendered underside, rather than an empty lattice corner, contacts the table when inverted', async () => {
  const { body, profile, bubbles } = characterFixture();
  const mesh = new Mesh(body);
  mesh.userData.optical_profile = JSON.stringify(profile);
  const v = new VolumeInteraction(
    { style: {}, hasPointerCapture: () => false },
    new PerspectiveCamera(),
    mesh,
    [mesh],
    bubbles,
  );
  await v.solver.accelerate(bytes);
  v.setRecoveryEnabled(false);
  rotate(v.solver, 'z', Math.PI);
  for (let k = 0; k < 120; k++) v.update(1 / 60);
  const floor = body.boundingBox.min.y;
  assert.ok(
    floor >= -0.015 && floor < 0.025,
    `visible floor clearance ${floor}`,
  );
  assert.ok(v.solver.stats().minJacobian > 0.5);
});

test('recovery includes visible local body acting before and after rolling, retaining the approved rest shape', async () => {
  const { cage, body } = characterFixture();
  const s = new VolumeSoftBody(cage);
  await s.accelerate(bytes);
  const skin = new FloorSurface(cage, body.getAttribute('position').array);
  const sensor = new BodyPosture(s.rest, s.mass);
  const rest = s.rest.slice();
  rotate(s, 'z', Math.PI);
  const controller = new SelfRighting(s, () => {});
  const heights = { notice: [], celebrate: [] };
  for (let k = 0; k < 3600; k++) {
    s.advance(1 / 240, (dt) => {
      s.setFloorLevel(skin.level(s.x));
      controller.step(dt, false);
    });
    const pose = sensor.sample(s.x, s.velocity),
      phase = controller.stats().phase;
    if (phase in heights) {
      let lo = Infinity,
        hi = -Infinity;
      for (let i = 0; i < s.nodeCount; i++) {
        let h = 0;
        for (let c = 0; c < 3; c++)
          h += (s.x[i * 3 + c] - pose.center[c]) * pose.up[c];
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      heights[phase].push(hi - lo);
    }
  }
  const range = (a) => Math.max(...a) - Math.min(...a);
  console.log(
    'body acting excursions',
    Object.fromEntries(Object.entries(heights).map(([k, v]) => [k, range(v)])),
  );
  assert.ok(
    range(heights.celebrate) > 0.06,
    'pride must visibly stretch and relax the body, not only change its face',
  );
  assert.ok(
    range(heights.notice) > 0.035,
    'the body should tentatively reach before committing to roll',
  );
  assert.ok(controller.stats().upY > 0.96);
  assert.deepEqual(s.rest, rest);
});
