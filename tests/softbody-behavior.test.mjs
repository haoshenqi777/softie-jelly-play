import test from 'node:test';
import assert from 'node:assert/strict';
import { CharacterBehavior } from '../lib/softbody/behavior.ts';

function fixture(hz = 60, seed = 42) {
  const behavior = new CharacterBehavior(seed);
  const observation = {
    time: 0,
    center: [0, 1.3, 0],
    velocity: [0, 0, 0],
    up: [0, 1, 0],
    forward: [0, 0, 1],
    grounded: true,
    held: false,
    stable: true,
    width: 3.2,
    height: 3.5,
    impactSpeed: 0,
    rendezvous: [0, 0, 0],
    viewerDirection: [0, 0, 1],
    cameraMoving: false,
  };
  function tick(patch = {}, dt = 1 / hz) {
    Object.assign(observation, patch);
    observation.time += dt;
    return behavior.step(observation, dt);
  }
  function advance(seconds, patch = {}) {
    Object.assign(observation, patch);
    let result;
    for (let left = seconds; left > 1e-8; left -= 1 / hz)
      result = tick({}, Math.min(left, 1 / hz));
    return result;
  }
  function event(kind, fields = {}) {
    behavior.observe({ kind, time: observation.time, ...fields });
  }
  function release({
    speed = 5,
    distance = 5,
    valid = true,
    grabbed = true,
  } = {}) {
    if (grabbed) {
      event('grab');
      tick({ held: true });
    }
    event('release', {
      velocity: [speed, 0, 0],
      carriedDistance: distance,
      valid,
    });
    return tick({
      held: false,
      grounded: false,
      stable: false,
      center: [5, 3, 0],
      velocity: [speed, -1, 0],
    });
  }
  function startReturning() {
    return untilPhase('returning', { center: [5, 1.3, 0], forward: [0, 0, 1] });
  }
  function untilPhase(phase, patch = {}) {
    Object.assign(observation, patch);
    for (let i = 0; i < hz * 3; i++) {
      const result = tick();
      if (result.phase === phase) return result;
    }
    assert.fail(`never reached ${phase}`);
  }
  return {
    behavior,
    observation,
    tick,
    advance,
    event,
    release,
    startReturning,
    untilPhase,
  };
}

test('far returns lengthen horizontal steps smoothly, retaining the close approach and viewer-facing direction', () => {
  const speeds = [];
  for (const widths of [0.4, 0.75, 1, 1.5, 2, 2.5, 4]) {
    const f = fixture();
    f.startReturning();
    const c = f.tick({ center: [widths * 3.2, 1.3, 0] });
    assert.equal(c.phase, 'returning');
    assert.deepEqual(c.facing, [0, 0, 1]);
    speeds.push(c.desiredSpeed);
  }
  assert.ok(
    speeds[0] > 0.27 * 3.2 && speeds[0] < 0.34 * 3.2,
    'close strides must progress without rushing the final stop',
  );
  assert.ok(
    speeds[5] > speeds[0] * 1.45,
    'a long return needs visibly greater strides',
  );
  assert.ok(speeds[5] <= speeds[0] * 2, 'keep the acceleration bounded');
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] >= speeds[i - 1]);
  assert.ok(
    speeds[6] === speeds[5],
    'extreme distance must not produce unbounded launch speeds',
  );
});

test('a real throw keeps one angry return through flight, landing, righting, and arrival', () => {
  const f = fixture();
  const flying = f.release();
  assert.equal(flying.phase, 'airborne');
  assert.equal(flying.body, 'quiet');
  assert.equal(flying.desiredSpeed, 0);
  assert.ok(flying.mood > 0.3);
  const destination = [...flying.destination];
  const landed = f.tick({
    grounded: true,
    center: [5, 1.1, 0],
    up: [0, -1, 0],
    velocity: [0, 0, 0],
    impactSpeed: 5,
  });
  assert.equal(landed.phase, 'landing');
  assert.deepEqual(landed.destination, destination);
  const righting = f.advance(0.7, { impactSpeed: 0 });
  assert.equal(righting.phase, 'righting');
  assert.equal(righting.body, 'recover');
  const anger = righting.mood;
  const orient = f.advance(0.3, {
    up: [0, 1, 0],
    stable: true,
    forward: [0, 0, 1],
  });
  assert.equal(orient.phase, 'orient');
  assert.ok(orient.mood > anger * 0.9);
  const returning = f.advance(1);
  assert.equal(returning.phase, 'returning');
  assert.equal(returning.body, 'travel');
  assert.ok(returning.desiredSpeed > 0 && returning.desiredSpeed < 2);
  assert.deepEqual(returning.destination, destination);
  const arrived = f.advance(0.35, {
    center: [0.12, 1.3, 0],
    forward: [0, 0, 1],
  });
  assert.equal(arrived.phase, 'arrived');
  assert.equal(arrived.desiredSpeed, 0);
  assert.equal(arrived.body, 'complain');
  assert.ok(arrived.mood > 0.2);
  assert.equal(
    f.advance(0.8).phase,
    'arrived',
    'arrival holds a readable response',
  );
  assert.equal(f.advance(1.4).social, 'wait');
  assert.equal(f.advance(5).phase, 'idle');
});

test('gentle placement returns without treating distance, falling, or cancellation as abuse', () => {
  for (const mode of [
    'gentle',
    'no-grab',
    'invalid',
    'not-carried',
    'cancel',
  ]) {
    const f = fixture();
    if (mode === 'cancel') {
      f.event('grab');
      f.tick({ held: true });
      f.event('cancel');
      f.event('release', {
        velocity: [10, 0, 0],
        carriedDistance: 5,
        valid: true,
      });
      f.tick({ held: false, grounded: false, center: [5, 3, 0] });
    } else
      f.release({
        speed: mode === 'gentle' ? 0.25 : 8,
        grabbed: mode !== 'no-grab',
        valid: mode !== 'invalid',
        distance: mode === 'not-carried' ? 0 : 5,
      });
    const result = f.untilPhase('returning', {
      grounded: true,
      stable: true,
      impactSpeed: 7,
      center: [5, 1.3, 0],
      velocity: [0, 0, 0],
      forward: [0, 0, 1],
    });
    assert.equal(result.phase, 'returning', mode);
    assert.equal(result.mood, 0, mode);
  }
});

test('grab stops travel immediately, cancel replans, and a second throw replaces the current return', () => {
  const f = fixture();
  f.startReturning();
  f.event('grab');
  const held = f.tick();
  assert.equal(held.phase, 'held');
  assert.equal(held.body, 'quiet');
  assert.equal(held.desiredSpeed, 0);
  f.event('cancel');
  const cancelled = f.tick();
  assert.equal(cancelled.body, 'quiet');
  assert.equal(cancelled.desiredSpeed, 0);
  assert.equal(f.untilPhase('returning').phase, 'returning');
  f.event('grab');
  f.tick({ held: true });
  f.event('release', { velocity: [-6, 0, 0], carriedDistance: 6, valid: true });
  const thrown = f.tick({
    held: false,
    grounded: false,
    center: [-6, 3, 0],
    velocity: [-6, 1, 0],
  });
  const anger = thrown.mood;
  assert.equal(thrown.phase, 'airborne');
  assert.deepEqual(thrown.destination, [0, 0, 0]);
  f.event('release', {
    velocity: [-20, 0, 0],
    carriedDistance: 6,
    valid: true,
  });
  assert.ok(
    f.tick().mood <= anger,
    'duplicate releases cannot accumulate anger',
  );
  const returning = f.untilPhase('returning', {
    grounded: true,
    stable: true,
    velocity: [0, 0, 0],
    forward: [0, 0, 1],
  });
  assert.equal(returning.phase, 'returning');
  assert.deepEqual(
    returning.facing,
    [0, 0, 1],
    'keep looking at the viewer from the new side',
  );
  assert.deepEqual(returning.destination, [0, 0, 0]);
});

test('stroking eases anger while retaining a return that is still needed', () => {
  const f = fixture();
  f.release();
  f.advance(2, {
    grounded: true,
    stable: true,
    velocity: [0, 0, 0],
    forward: [0, 0, 1],
  });
  const before = f.tick().mood;
  f.event('stroke', { seconds: 0.6 });
  const comfort = f.tick();
  assert.ok(comfort.mood < before && comfort.mood > 0);
  assert.equal(comfort.phase, 'returning');
  assert.notEqual(comfort.destination, null);
});

test('a delayed measured impact strengthens a throw once, without counting a support heartbeat repeatedly', () => {
  const f = fixture();
  f.release();
  const firstContact = f.tick({
    grounded: true,
    stable: true,
    velocity: [0, 0, 0],
    impactSpeed: 0,
  });
  const beforeImpact = firstContact.mood;
  const measured = f.tick({ impactSpeed: 8 });
  assert.ok(measured.mood > beforeImpact + 0.1);
  const afterImpact = measured.mood;
  assert.ok(f.advance(0.25).mood < afterImpact);
});

test('a new grab in the same input batch wins over an older cancellation', () => {
  const f = fixture();
  f.startReturning();
  f.event('cancel');
  f.event('grab');
  const result = f.tick({ held: true });
  assert.equal(result.phase, 'held');
  assert.equal(result.body, 'quiet');
  assert.equal(result.desiredSpeed, 0);
});

test('upright landing waits for support and return orientation waits for actual heading', () => {
  const f = fixture();
  f.release();
  const shaky = f.advance(1.2, {
    grounded: true,
    stable: false,
    up: [0, 1, 0],
    velocity: [0, 0, 0],
  });
  assert.equal(shaky.phase, 'landing');
  assert.equal(shaky.desiredSpeed, 0);
  const misaligned = f.advance(1.5, { stable: true, forward: [-1, 0, 0] });
  assert.equal(misaligned.phase, 'orient');
  assert.equal(misaligned.desiredSpeed, 0);
  assert.equal(f.advance(0.1, { forward: [0, 0, 1] }).phase, 'returning');
});

test('off-center returns first face the camera, then keep that gaze while bouncing sideways', () => {
  for (const side of [-1, 1]) {
    const f = fixture();
    const viewer = [-side * 0.6, 0, 0.8];
    const waiting = f.advance(1.8, {
      center: [side * 5, 1.3, 0],
      forward: [-side, 0, 0],
      viewerDirection: viewer,
    });
    assert.equal(
      waiting.phase,
      'orient',
      'pointing toward home is insufficient',
    );
    assert.equal(waiting.desiredSpeed, 0);
    assert.deepEqual(waiting.facing, viewer);
    assert.deepEqual(waiting.destination, [0, 0, 0]);
    const almostFacing = f.advance(0.2, {
      forward: [
        viewer[0] * 0.96 + 0.8 * 0.28,
        0,
        0.8 * 0.96 - viewer[0] * 0.28,
      ],
    });
    assert.equal(
      almostFacing.phase,
      'orient',
      'a .96 viewer dot must still finish turning',
    );
    assert.equal(almostFacing.desiredSpeed, 0);
    const returning = f.tick({ forward: viewer });
    assert.equal(returning.phase, 'returning');
    assert.ok(returning.desiredSpeed > 0);
    assert.deepEqual(returning.facing, viewer);
    assert.deepEqual(returning.destination, [0, 0, 0]);
    const bouncing = f.advance(0.2, {
      center: [side * 4.8, 1.5, 0],
      grounded: false,
      stable: false,
      velocity: [-side * 0.5, 0.3, 0],
    });
    assert.equal(bouncing.phase, 'returning');
    assert.deepEqual(
      bouncing.facing,
      viewer,
      'the flight heading is separate from its gaze',
    );
    assert.deepEqual(bouncing.destination, [0, 0, 0]);
  }
});

test('arrival requires low velocity and facing the viewer, with distance hysteresis afterwards', () => {
  const f = fixture();
  f.startReturning();
  let result = f.advance(0.4, { center: [0.2, 1.3, 0], velocity: [-2, 0, 0] });
  assert.equal(result.phase, 'returning');
  assert.equal(result.body, 'brake');
  assert.equal(result.desiredSpeed, 0);
  result = f.advance(0.5, { velocity: [0, 0, 0], forward: [-1, 0, 0] });
  assert.equal(result.phase, 'returning');
  assert.ok(result.facing[2] > 0.99);
  assert.equal(f.advance(0.4, { forward: [0, 0, 1] }).phase, 'arrived');
  assert.equal(f.advance(2.5).phase, 'idle');
  assert.equal(f.advance(3, { center: [0.8, 1.3, 0] }).phase, 'idle');
  assert.notEqual(f.advance(2, { center: [2, 1.3, 0] }).phase, 'idle');
});

test('normal gait flight preserves a return, while prolonged free fall stops autonomous travel', () => {
  const f = fixture();
  f.startReturning();
  const inStep = f.advance(0.2, {
    grounded: false,
    stable: false,
    velocity: [-0.5, 0.3, 0],
  });
  assert.equal(inStep.phase, 'returning');
  assert.equal(inStep.body, 'travel');
  assert.equal(f.tick({ grounded: true, stable: true }).phase, 'returning');
  const fall = f.advance(1.4, {
    grounded: false,
    stable: false,
    velocity: [0, -6, 0],
  });
  assert.equal(fall.phase, 'airborne');
  assert.equal(fall.desiredSpeed, 0);
  assert.equal(fall.body, 'quiet');
});

test('small arrival recoil preserves its reaction, while a fall or grab interrupts it', () => {
  const f = fixture();
  f.release();
  f.untilPhase('returning', {
    grounded: true,
    stable: true,
    velocity: [0, 0, 0],
  });
  f.advance(0.3, { center: [0.1, 1.3, 0] });
  assert.equal(f.tick().phase, 'arrived');
  const recoil = f.advance(0.1, {
    grounded: false,
    stable: false,
    velocity: [0, 0.65, 0],
  });
  assert.equal(recoil.phase, 'arrived');
  assert.equal(recoil.body, 'complain');
  assert.equal(
    f.tick({ grounded: true, stable: true, velocity: [0, 0, 0] }).phase,
    'arrived',
  );
  const falling = f.advance(0.3, {
    grounded: false,
    stable: false,
    velocity: [0, -1.4, 0],
  });
  assert.equal(falling.phase, 'airborne');
  f.event('grab');
  assert.equal(f.tick({ held: true }).phase, 'held');
});

test('camera target stays fixed during orbit, updates on quiet boundaries, and ignores vertical directions', () => {
  const f = fixture();
  f.startReturning();
  const original = [...f.tick().destination];
  const moving = f.advance(1, {
    cameraMoving: true,
    rendezvous: [0.3, 0, 0],
    viewerDirection: [1, 0, 0],
  });
  assert.deepEqual(moving.destination, original);
  assert.ok(
    moving.facing[0] > 0.99,
    'gaze follows an orbit while the destination stays fixed',
  );
  assert.deepEqual(
    f.advance(0.2, { cameraMoving: false }).destination,
    original,
  );
  const changed = f.advance(0.8, { center: [4.7, 1.3, 0] });
  assert.ok(changed.destination[0] > 0 && changed.destination[0] <= 0.3);
  assert.equal(changed.destination[1], 0);
  const copy = [...changed.destination];
  f.observation.rendezvous[0] = 0.31;
  assert.deepEqual(
    changed.destination,
    copy,
    'intent never aliases camera input',
  );
  const vertical = f.advance(0.8, { viewerDirection: [0, 1, 0] });
  assert.ok(vertical.facing.every(Number.isFinite));
  assert.ok(Math.hypot(vertical.facing[0], vertical.facing[2]) > 0.99);
});

test('moving camera and body rays smoothly update gaze without releasing the destination lock', () => {
  const f = fixture();
  f.startReturning();
  const destination = [...f.tick().destination];
  const firstTurn = f.tick({
    cameraMoving: true,
    viewerDirection: [1, 0, 0],
    rendezvous: [0.3, 0, 0],
  });
  assert.ok(
    firstTurn.facing[0] > 0 && firstTurn.facing[0] < 0.15,
    'first frame turns without snapping',
  );
  assert.ok(firstTurn.facing[2] > 0.98);
  let previous = [...firstTurn.facing];
  for (let i = 0; i < 60; i++) {
    const angle = Math.PI / 2 + 0.3 * Math.sin(i / 12);
    const result = f.tick({
      center: [5 - i * 0.01, 1.3, 0],
      viewerDirection: [Math.sin(angle), 0, Math.cos(angle)],
    });
    assert.deepEqual(result.destination, destination);
    assert.ok(result.facing.every(Number.isFinite));
    assert.ok(
      Math.abs(Math.hypot(result.facing[0], result.facing[2]) - 1) < 1e-12,
    );
    const turn = Math.acos(
      Math.min(
        1,
        previous[0] * result.facing[0] + previous[2] * result.facing[2],
      ),
    );
    assert.ok(turn <= 0.06, 'angular response remains bounded each frame');
    previous = [...result.facing];
  }
  const followed = f.advance(1, { viewerDirection: [0.6, 0, 0.8] });
  assert.ok(followed.facing[0] * 0.6 + followed.facing[2] * 0.8 > 0.999);
  assert.deepEqual(followed.destination, destination);
});

test('gaze takes the short arc across the yaw wrap and retains a finite direction at vertical views', () => {
  const f = fixture();
  const before = (179 * Math.PI) / 180;
  const after = (-179 * Math.PI) / 180;
  f.tick({
    center: [5, 1.3, 0],
    viewerDirection: [Math.sin(before), 0, Math.cos(before)],
  });
  const crossing = f.tick({
    cameraMoving: true,
    viewerDirection: [Math.sin(after), 0, Math.cos(after)],
  });
  assert.ok(
    crossing.facing[0] < Math.sin(before),
    'turn follows the two-degree short arc',
  );
  assert.ok(
    crossing.facing[2] < -0.99,
    'turn does not rotate through the front',
  );
  const followed = f.advance(0.8);
  assert.ok(followed.facing[0] < 0);
  assert.ok(
    followed.facing[0] * Math.sin(after) +
      followed.facing[2] * Math.cos(after) >
      0.99999,
  );
  for (const viewerDirection of [
    [0, 1, 0],
    [NaN, 0, Infinity],
  ]) {
    const result = f.advance(0.2, { viewerDirection });
    assert.ok(result.facing.every(Number.isFinite));
    assert.ok(result.facing[2] < -0.99);
  }
});

test('smoothed gaze cannot launch a return before the body faces the current camera ray', () => {
  const f = fixture();
  f.advance(1, { center: [5, 1.3, 0], forward: [-1, 0, 0] });
  const changed = f.tick({
    cameraMoving: true,
    viewerDirection: [1, 0, 0],
    forward: [0, 0, 1],
  });
  assert.equal(
    changed.phase,
    'orient',
    'facing the previous camera direction cannot launch',
  );
  assert.equal(changed.desiredSpeed, 0);
  const aligned = f.advance(1, { forward: [1, 0, 0] });
  assert.equal(aligned.phase, 'returning');
  assert.ok(aligned.desiredSpeed > 0);
  assert.ok(aligned.facing[0] > 0.99);
});

test('two sustained failures pause and select bounded hop fallback without moving the target', () => {
  const f = fixture();
  f.startReturning();
  let pauses = 0,
    previous = 'returning',
    result;
  for (let i = 0; i < 450; i++) {
    result = f.tick();
    if (result.phase === 'orient' && previous !== 'orient') pauses++;
    previous = result.phase;
    assert.ok(result.desiredSpeed <= 2);
    assert.deepEqual(result.destination, [0, 0, 0]);
  }
  assert.ok(pauses >= 2, 'failures have visible reassessment beats');
  assert.equal(result.gait, 'hop');
});

test('actual progress clears stall timing rather than triggering fallback on every long trip', () => {
  const f = fixture();
  f.startReturning();
  let result;
  for (let i = 0; i < 240; i++)
    result = f.tick({ center: [5 - i * 0.009, 1.3, 0] });
  assert.equal(result.phase, 'returning');
  assert.equal(result.gait, 'scoot');
});

test('seeded quiet actions are sparse, repeatable, and never repeat consecutively', () => {
  function collect(seed) {
    const f = fixture(60, seed);
    const starts = [];
    let previous = 'quiet';
    for (let i = 0; i < 60 * 80; i++) {
      const result = f.tick();
      if (result.body !== 'quiet' && result.body !== previous)
        starts.push([result.body, f.observation.time]);
      previous = result.body;
    }
    return starts;
  }
  const actions = collect(82);
  assert.ok(actions.length >= 4 && actions.length <= 8);
  assert.deepEqual(actions, collect(82));
  assert.notDeepEqual(actions, collect(9));
  assert.ok(actions[0][1] >= 8);
  for (let i = 1; i < actions.length; i++) {
    assert.notEqual(actions[i][0], actions[i - 1][0]);
    assert.ok(actions[i][1] - actions[i - 1][1] >= 8);
  }
});

test('touch or lost support cancels idle actions, and user activity defers the next one', () => {
  const f = fixture();
  let result;
  for (let i = 0; i < 16 * 60; i++) {
    result = f.tick();
    if (result.body !== 'quiet') break;
  }
  assert.notEqual(result.body, 'quiet');
  f.event('stroke', { seconds: 0.05 });
  assert.equal(f.tick().body, 'quiet');
  assert.equal(f.advance(7).body, 'quiet');
  for (let i = 0; i < 20 * 60; i++) {
    result = f.tick();
    if (result.body !== 'quiet') break;
  }
  assert.notEqual(result.body, 'quiet');
  assert.equal(f.tick({ grounded: false, stable: false }).body, 'quiet');
});

test('reset removes anger, pending release, return, and reproduces the seeded quiet schedule', () => {
  const f = fixture();
  f.release();
  f.event('reset');
  const result = f.tick({
    center: [0, 1.3, 0],
    velocity: [0, 0, 0],
    grounded: true,
    stable: true,
  });
  assert.equal(result.phase, 'idle');
  assert.equal(result.destination, null);
  assert.equal(result.mood, 0);
  f.event('grab');
  f.event('release', { velocity: [8, 0, 0], carriedDistance: 5, valid: true });
  f.behavior.reset();
  assert.equal(f.tick().mood, 0);
});

test('30, 60, and 120 Hz observed traces preserve the same phase order and mood', () => {
  function trace(hz) {
    const f = fixture(hz);
    const phases = [];
    let mood = 0;
    f.release();
    for (let i = 0; i < hz * 5; i++) {
      const t = i / hz;
      const result = f.tick(
        t < 0.5
          ? {}
          : t < 1.4
            ? { grounded: true, velocity: [0, 0, 0], up: [0, -1, 0] }
            : t < 3.7
              ? {
                  up: [0, 1, 0],
                  stable: true,
                  forward: [0, 0, 1],
                  center: [5 - (t - 1.4) * 1.9, 1.3, 0],
                }
              : { center: [0.1, 1.3, 0], forward: [0, 0, 1] },
      );
      if (phases.at(-1) !== result.phase) phases.push(result.phase);
      mood = result.mood;
    }
    return { phases, mood };
  }
  const baseline = trace(60);
  assert.deepEqual(baseline.phases, [
    'airborne',
    'landing',
    'righting',
    'orient',
    'returning',
    'arrived',
  ]);
  for (const hz of [30, 120]) {
    const other = trace(hz);
    assert.deepEqual(other.phases, baseline.phases);
    assert.ok(Math.abs(other.mood - baseline.mood) < 0.015);
  }
});
