import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Mesh, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { VolumeInteraction } from '../lib/softbody/interaction.ts';
import { characterFixture } from './softbody-fixture.mjs';
import { BodyPosture } from '../lib/softbody/posture.ts';
import { cameraFacing } from '../lib/softbody/rendezvous.ts';
const bytes = readFileSync(
  new URL('../public/physics/volume.wasm', import.meta.url),
);

test('a grab interrupts a real walk immediately and a second throw returns from the new landing', async () => {
  const { v, event, body, camera } = fixture();
  await v.solver.accelerate(bytes);
  v.setTuning({ stiffness: 32.7, damping: 64.2 });
  for (let i = 0; i < v.solver.x.length; i += 3) v.solver.x[i] += 4;
  for (let k = 0; k < 900; k++) {
    v.update(1 / 60);
    if (v.motor.gait.stats().steps >= 2) break;
  }
  assert.equal(v.characterState().phase, 'returning');
  const p = body.boundingBox.getCenter(new Vector3()).project(camera),
    e = {
      ...event,
      clientX: (p.x + 1) * 200,
      clientY: (1 - p.y) * 200,
      timeStamp: 5000,
    };
  assert.equal(v.pointerDown(e), true);
  assert.equal(v.motor.gait.stats().phase, 'idle');
  v.update(1 / 60);
  assert.equal(v.characterState().phase, 'held');
  for (let k = 1; k <= 18; k++) {
    v.pointerMove({
      ...e,
      clientX: e.clientX - k * 7,
      clientY: e.clientY - k * 5,
      timeStamp: 5000 + k * 16.67,
    });
    v.update(1 / 60);
    assert.equal(v.motor.gait.stats().phase, 'idle');
  }
  v.pointerUp({ ...e, timeStamp: 5320, type: 'pointerup' });
  let arrived = false,
    anger = 0;
  for (let k = 0; k < 1500; k++) {
    v.update(1 / 60);
    anger = Math.max(anger, v.characterState().mood);
    if (v.characterState().phase === 'arrived') {
      arrived = true;
      break;
    }
  }
  assert.ok(arrived);
  assert.ok(anger > 0.25);
  assert.ok(v.solver.stats().minJacobian > 0.5);
  v.reset();
  v.update(1 / 60);
  assert.equal(v.characterState().destination, null);
  assert.equal(v.characterState().mood, 0);
});
function fixture() {
  const { body, profile, bubbles } = characterFixture(),
    mesh = new Mesh(body);
  mesh.userData.optical_profile = JSON.stringify(profile);
  mesh.updateMatrixWorld();
  const camera = new PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, 1, 8);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const captures = new Set(),
    canvas = {
      style: {},
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      }),
      setPointerCapture: (id) => captures.add(id),
      hasPointerCapture: (id) => captures.has(id),
      releasePointerCapture: (id) => captures.delete(id),
    };
  const v = new VolumeInteraction(canvas, camera, mesh, [mesh], bubbles);
  v.setExpression({ responsive: true });
  const event = {
    pointerId: 1,
    button: 0,
    buttons: 1,
    pointerType: 'mouse',
    clientX: 200,
    clientY: 200,
    timeStamp: 0,
    preventDefault() {},
  };
  return { v, event, body, camera };
}

test('a real throw, supported complaint and gentle hover form one bounded affectionate return', async () => {
  const { v, event, body, camera } = fixture();
  await v.solver.accelerate(bytes);
  v.setTuning({ stiffness: 32.7, damping: 64.2 });
  v.pointerDown(event);
  for (let n = 1; n <= 15; n++) {
    v.pointerMove({
      ...event,
      clientX: 200 + n * 6,
      clientY: 200 - n * 4,
      timeStamp: n * 16.667,
    });
    v.update(1 / 60);
  }
  v.pointerUp({ ...event, timeStamp: 260, type: 'pointerup' });
  for (let n = 0; n < 900 && v.characterState()?.phase !== 'arrived'; n++)
    v.update(1 / 60);
  assert.equal(v.characterState().phase, 'arrived');
  assert.ok(v.characterState().mood > 0.2);
  const beats = [];
  for (let n = 0; n < 180; n++) {
    const s = v.characterState();
    if (beats.at(-1) !== s.social) beats.push(s.social);
    assert.equal(
      s.phase,
      'arrived',
      'a planted complaint must not trigger another fall',
    );
    v.update(1 / 60);
  }
  assert.deepEqual(beats, ['look', 'inflate', 'stamp', 'wait']);
  const angry = v.characterState().mood;
  const sensor = new BodyPosture(v.solver.rest, v.solver.mass);
  const start = sensor.sample(v.solver.x, v.solver.velocity).center.slice();
  const affection = new Set();
  for (let n = 0; n <= 180; n++) {
    const p = body.boundingBox.getCenter(new Vector3()).project(camera);
    v.pointerMove({
      ...event,
      buttons: 0,
      clientX: (p.x + 1) * 200 + 12 * Math.sin((n / 60) * 3),
      clientY: (1 - p.y) * 200,
      timeStamp: 20000 + (n / 60) * 1000,
    });
    v.update(1 / 60);
    affection.add(v.characterState().social);
    if (n === 10) assert.ok(v.characterState().mood > angry - 0.03);
  }
  assert.ok(v.characterState().mood < 0.1);
  assert.equal(v.held, false);
  assert.equal(v.stats().grabs, 1, 'hover petting never grabs the body');
  for (let n = 0; n < 240; n++) {
    v.update(1 / 60);
    affection.add(v.characterState().social);
    assert.ok(['arrived', 'idle'].includes(v.characterState().phase));
  }
  const pose = sensor.sample(v.solver.x, v.solver.velocity);
  const approach = pose.center[2] - start[2];
  assert.ok(
    affection.has('nuzzle') && affection.has('content'),
    [...affection].join(','),
  );
  assert.ok(
    approach > 0.015 && approach < 0.3,
    `physical nuzzle distance ${approach}`,
  );
  assert.ok(pose.up[1] > 0.96);
  assert.ok(v.solver.stats().minJacobian > 0.5);
  console.log('complaint and comfort', {
    beats,
    affection: [...affection],
    approach,
    mood: v.characterState().mood,
  });
});

test('physical preview actions and focus cancellation discard an unfinished nuzzle', async () => {
  for (const action of ['poke', 'drop', 'tip', 'cancel']) {
    const { v } = fixture();
    await v.solver.accelerate(bytes);
    v.setTuning({ stiffness: 32.7, damping: 64.2 });
    v.stroke(0.6);
    for (let n = 0; n < 120 && v.characterState()?.social !== 'nuzzle'; n++)
      v.update(1 / 60);
    assert.equal(v.characterState().social, 'nuzzle');
    v[action]();
    for (let n = 0; n < 240; n++) {
      v.update(1 / 60);
      assert.equal(v.characterState().social, 'none', `${action}, frame ${n}`);
    }
  }
});

test('every social beat yields immediately to a grab and never writes body positions', () => {
  const { v } = fixture();
  const pose = new BodyPosture(v.solver.rest, v.solver.mass).sample(
    v.solver.x,
    v.solver.velocity,
  );
  const observation = {
    center: [...pose.center],
    velocity: [0, 0, 0],
    up: [...pose.up],
    forward: [...pose.forward],
    grounded: true,
    held: false,
  };
  for (const social of [
    'look',
    'inflate',
    'stamp',
    'wait',
    'soften',
    'nuzzle',
    'content',
  ]) {
    const intent = {
      phase: 'arrived',
      body: 'complain',
      destination: null,
      facing: [0, 0, 1],
      mood: 0.5,
      social,
      socialAge: 0.2,
      comfort: 0.8,
      joy: 0.8,
    };
    const positions = v.solver.x.slice();
    v.motor.step(observation, intent, 1 / 240);
    assert.deepEqual(v.solver.x, positions, social);
    const velocity = v.solver.velocity.slice();
    v.motor.step({ ...observation, held: true }, intent, 1 / 240);
    assert.deepEqual(v.solver.x, positions, `held ${social}`);
    assert.deepEqual(v.solver.velocity, velocity, `held ${social}`);
    assert.equal(v.motor.gait.stats().phase, 'idle');
    assert.equal(v.motor.recovery.stats().phase, 'idle');
  }
});

test('a distant return finishes promptly and still brakes facing the camera with saved feel', async () => {
  const results = [];
  for (const x of [-8, 8]) {
    const { v, camera } = fixture();
    await v.solver.accelerate(bytes);
    v.setTuning({ stiffness: 32.7, damping: 64.2 });
    for (let i = 0; i < v.solver.x.length; i += 3) v.solver.x[i] += x;
    let time = 0,
      arrived = false;
    for (let k = 0; k < 1500; k++) {
      v.update(1 / 60);
      time = (k + 1) / 60;
      if (v.characterState()?.phase === 'arrived') {
        arrived = true;
        break;
      }
    }
    const sensor = new BodyPosture(v.solver.rest, v.solver.mass),
      pose = sensor.sample(v.solver.x, v.solver.velocity),
      c = v.characterState(),
      look = cameraFacing(camera.position.toArray(), pose.center, [0, 0, 1]);
    assert.ok(arrived);
    assert.ok(
      Math.hypot(
        pose.center[0] - c.destination[0],
        pose.center[2] - c.destination[2],
      ) <
        3.2325 * 0.12,
    );
    assert.ok(pose.forward[0] * look[0] + pose.forward[2] * look[2] > 0.95);
    assert.ok(pose.up[1] > 0.96);
    assert.ok(v.solver.stats().minJacobian > 0.5);
    results.push({ x, time, steps: v.motor.gait.stats().steps });
  }
  console.log('far return timing', results);
  assert.ok(
    results.every((r) => r.time < 8),
    JSON.stringify(results),
  );
});

test('grabbing a distant returning body does not clamp its target back to the old center', async () => {
  const { v, event, body, camera } = fixture();
  await v.solver.accelerate(bytes);
  for (let i = 0; i < v.solver.x.length; i += 3) v.solver.x[i] += 5;
  v.update(1 / 60);
  const p = body.boundingBox.getCenter(new Vector3()).project(camera);
  const e = { ...event, clientX: (p.x + 1) * 200, clientY: (1 - p.y) * 200 };
  assert.equal(v.pointerDown(e), true);
  const target = v.solver.grabState.goal.slice();
  v.pointerMove({ ...e, clientX: e.clientX + 1, timeStamp: 17 });
  assert.ok(
    Math.abs(v.solver.grabState.goal[0] - target[0]) < 0.1,
    'a tiny drag must remain local to the selected body',
  );
  v.update(1 / 60);
  assert.equal(v.characterState().phase, 'held');
  assert.equal(v.motor.gait.stats().phase, 'idle');
  v.cancel();
  assert.equal(v.held, false);
});

test('four room regions, inversion and saved feel retain continuous return and facing', async () => {
  const timings = [];
  for (const [x, z, inverted, saved] of [
    [-3.5, 0, false, false],
    [3.5, 0, true, true],
    [0, -3.5, true, false],
    [0, 3.5, false, true],
  ]) {
    const { v, camera } = fixture();
    await v.solver.accelerate(bytes);
    if (saved) v.setTuning({ stiffness: 32.7, damping: 64.2 });
    const sensor = new BodyPosture(v.solver.rest, v.solver.mass),
      c = sensor.sample(v.solver.x, v.solver.velocity).center.slice();
    for (let i = 0; i < v.solver.x.length; i += 3) {
      if (inverted) {
        v.solver.x[i] = 2 * c[0] - v.solver.x[i];
        v.solver.x[i + 1] = 2 * c[1] - v.solver.x[i + 1];
      }
      v.solver.x[i] += x;
      v.solver.x[i + 2] += z;
    }
    const floor = sensor.sample(v.solver.x, v.solver.velocity).minY;
    for (let i = 1; i < v.solver.x.length; i += 3) v.solver.x[i] -= floor;
    let arrived = false,
      elapsed = 0,
      firstLaunchFacing = null,
      travelFacing = 1;
    const phaseTimes = {};
    for (let k = 0; k < 1500; k++) {
      v.update(1 / 60);
      elapsed = (k + 1) / 60;
      const stage = v.characterState()?.phase;
      phaseTimes[stage] = (phaseTimes[stage] ?? 0) + 1 / 60;
      if (v.motor.gait.stats().steps > 0) {
        const pose = sensor.sample(v.solver.x, v.solver.velocity),
          look = cameraFacing(
            camera.position.toArray(),
            pose.center,
            [0, 0, 1],
          );
        const dot =
          (pose.forward[0] * look[0] + pose.forward[2] * look[2]) /
          Math.hypot(pose.forward[0], pose.forward[2]);
        if (firstLaunchFacing === null) firstLaunchFacing = dot;
        if (v.characterState()?.phase === 'returning')
          travelFacing = Math.min(travelFacing, dot);
      }
      if (v.characterState()?.phase === 'arrived') {
        arrived = true;
        break;
      }
    }
    const p = sensor.sample(v.solver.x, v.solver.velocity),
      intent = v.characterState();
    assert.ok(arrived, JSON.stringify({ x, z, inverted, saved, end: intent }));
    assert.ok(
      firstLaunchFacing > 0.94,
      `must face actual camera before first bounce: ${firstLaunchFacing}`,
    );
    assert.ok(
      travelFacing > 0.9,
      `maintain face toward camera throughout travel: ${travelFacing}`,
    );
    assert.ok(
      Math.hypot(
        p.center[0] - intent.destination[0],
        p.center[2] - intent.destination[2],
      ) <
        3.2325 * 0.12,
    );
    assert.ok(p.forward[2] > 0.95 && p.up[1] > 0.96);
    assert.equal(
      intent.mood,
      0,
      'placement without a user throw must not invent irritation',
    );
    timings.push({ x, z, inverted, elapsed, phaseTimes });
  }
  console.log('room return timing', timings);
  // The product sequence includes one higher airborne turn after recovery.
  // Retain the six-second upright budget; allow its extra beat after inversion.
  assert.ok(
    timings.every((t) => t.elapsed < (t.inverted ? 10 : 6)),
    JSON.stringify(timings),
  );
});
test('a real pointer throw produces irritation and a continuous physical return to the viewer', async () => {
  for (const side of [-1, 1]) {
    const { v, event, body } = fixture();
    await v.solver.accelerate(bytes);
    for (let k = 0; k < 30; k++) v.update(1 / 60);
    assert.equal(v.pointerDown(event), true);
    for (let k = 1; k <= 20; k++) {
      v.pointerMove({
        ...event,
        clientX: 200 + side * k * 7,
        clientY: 200 - k * 6,
        timeStamp: k * 16.67,
      });
      v.update(1 / 60);
    }
    v.pointerUp({ ...event, timeStamp: 350, type: 'pointerup' });
    const phases = new Set();
    let maxMood = 0,
      arrived = false,
      maxDistance = 0;
    for (let k = 0; k < 1500; k++) {
      v.update(1 / 60);
      const c = v.characterState();
      if (!c) continue;
      phases.add(c.phase);
      maxMood = Math.max(maxMood, c.mood);
      maxDistance = Math.max(
        maxDistance,
        Math.hypot(
          (body.boundingBox.min.x + body.boundingBox.max.x) / 2,
          (body.boundingBox.min.z + body.boundingBox.max.z) / 2,
        ),
      );
      if (c.phase === 'arrived') {
        arrived = true;
        break;
      }
    }
    console.log('character throw', {
      side,
      maxDistance,
      maxMood,
      phases: [...phases],
      gait: v.motor.gait.stats(),
      end: v.characterState(),
    });
    assert.ok(
      maxMood > 0.25,
      'throw must be recognized from its physical release',
    );
    assert.ok(
      phases.has('returning') && arrived,
      'must actually return, not only react',
    );
    assert.ok(
      v.motor.gait.stats().steps >= 3,
      'the whole return must contain successive physical steps',
    );
    assert.ok(v.solver.stats().minJacobian > 0.5);
    const arrivalPhases = new Set();
    for (let k = 0; k < 120; k++) {
      v.update(1 / 60);
      arrivalPhases.add(v.characterState().phase);
    }
    assert.ok(
      [...arrivalPhases].every(
        (phase) => phase === 'arrived' || phase === 'idle',
      ),
      'an arrival puff must not restart the fall/landing performance: ' +
        JSON.stringify([...arrivalPhases]),
    );
  }
});
