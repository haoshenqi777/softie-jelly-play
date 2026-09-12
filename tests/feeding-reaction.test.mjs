import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedingReaction } from '../lib/softbody/feeding-reaction.ts';
import { CharacterMotor } from '../lib/softbody/character-motor.ts';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { createCage } from '../lib/softbody/cage.ts';
import { BodyPosture } from '../lib/softbody/posture.ts';
import { characterFixture } from './softbody-fixture.mjs';
import { digestionAt, DIGESTION } from '../lib/candy-digestion.ts';

const signal = (stage, values = {}) => ({
  id: 1,
  stage,
  held: false,
  pressure: 0,
  withdrawing: false,
  wrap: 0,
  diffusionAge: 0,
  ...values,
});
const advance = (r, seconds, s, rate = 120) => {
  for (let i = 0; i < Math.round(seconds * rate); i++)
    r.step(1 / rate, s, { x: 0.8, y: 1.4, z: 0.5 });
  return r.frame();
};

test('visible core disappearance immediately gets a readable satisfaction beat, before colour finishes', () => {
  const r = new FeedingReaction();
  let response = false,
    maxBend = 0,
    maxCrown = 0;
  for (let i = 0; i < 13 * 120; i++) {
    const t = i / 120,
      d = digestionAt(t);
    const f = r.step(
      1 / 120,
      signal(d.stage, { diffusionAge: d.diffusionAge }),
    );
    const goneAt = DIGESTION.hold + DIGESTION.dissolve;
    if (t > goneAt && t < goneAt + 0.8) {
      response ||= f.beat === 'finish' && f.face !== 'neutral';
      maxBend = Math.max(maxBend, Math.abs(f.bend));
      maxCrown = Math.max(maxCrown, Math.abs(f.crown));
    }
  }
  assert.ok(
    response,
    'respond within 0.8s of the last visible sugar disappearing',
  );
  assert.ok(
    maxBend >= 0.03 && maxCrown >= 0.065,
    'clear finite head/body movement',
  );
});

test('colour completion cannot replay the satisfaction already performed at core disappearance', () => {
  const r = new FeedingReaction();
  let finishes = 0,
    previous = '';
  for (let i = 0; i < 17 * 120; i++) {
    const d = digestionAt(i / 120);
    const f = r.step(
      1 / 120,
      signal(d.stage, { diffusionAge: d.diffusionAge }),
    );
    if (f.beat === 'finish' && previous !== 'finish') finishes++;
    previous = f.beat;
  }
  assert.equal(finishes, 1);
});

test('touching during satisfaction cancels the performance without replay at colour completion', () => {
  const r = new FeedingReaction();
  advance(r, 0.5, signal('settling', { diffusionAge: 7 }));
  assert.equal(r.frame().beat, 'finish');
  r.interrupt();
  assert.equal(
    advance(r, 0.2, signal('settling', { diffusionAge: 7.2 })).active,
    false,
  );
  assert.equal(advance(r, 0.5, signal('done')).active, false);
});

test('contact and withdrawal change the face without adding a feeding body load', () => {
  const r = new FeedingReaction();
  for (const stage of ['pressing', 'wrapping', 'entering', 'sealing']) {
    for (const held of [true, false]) {
      const f = advance(r, 0.8, signal(stage, { held, pressure: 90 }));
      assert.equal(f.active, true);
      assert.ok(['curious', 'effort', 'shy'].includes(f.face));
      assert.deepEqual([f.stretch, f.bend, f.crown], [0, 0, 0]);
    }
  }
  const f = advance(
    r,
    0.5,
    signal('pressing', { held: true, withdrawing: true }),
  );
  assert.equal(f.beat, 'withdraw');
  assert.deepEqual([f.stretch, f.bend, f.crown], [0, 0, 0]);
});

test('digestion gestures remain bounded after enclosure', () => {
  const r = new FeedingReaction();
  for (const stage of ['inside', 'dissolving', 'settling', 'done']) {
    for (let i = 0; i < 480; i++) {
      const f = r.step(1 / 120, signal(stage, { diffusionAge: i / 120 }));
      assert.ok(Math.abs(f.stretch) <= 0.065);
      assert.ok(Math.abs(f.bend) <= 0.04);
      assert.ok(Math.abs(f.crown) <= 0.095);
    }
  }
});

test('enclosure reaction has equal duration at 30, 60 and 120 Hz', () => {
  const frames = [30, 60, 120].map((rate) =>
    advance(new FeedingReaction(), 0.8, signal('inside'), rate),
  );
  for (const f of frames) {
    assert.ok(
      Math.abs(f.age - 0.8) < 1e-8,
      'a phase must retain the time of its first step',
    );
    assert.ok(Math.abs(f.crown - frames[0].crown) < 1e-8);
  }
});

test('pressure is reversible and a long sealing wait cannot play enclosure relief', () => {
  const r = new FeedingReaction();
  advance(r, 1, signal('pressing', { held: true, pressure: 8 }));
  assert.equal(r.frame().face, 'curious');
  advance(r, 1, signal('entering', { held: true, pressure: 90 }));
  assert.equal(r.frame().face, 'effort');
  advance(r, 1, signal('pressing', { held: true, pressure: 0 }));
  assert.equal(r.frame().face, 'curious');
  advance(r, 12, signal('sealing'));
  assert.notEqual(r.frame().beat, 'enclose');
  assert.ok(r.frame().crown <= 0);
  advance(r, 0.7, signal('inside'));
  assert.equal(r.frame().beat, 'enclose');
  assert.ok(
    r.frame().crown > 0 && r.frame().crown <= 0.075,
    'only confirmed enclosure releases the crown',
  );
});

test('digestion has quiet gaps rather than a continuous repeating wiggle', () => {
  const r = new FeedingReaction();
  r.step(1 / 120, signal('inside'));
  for (const age of [0, 2.8, 5.5]) {
    const f = r.step(1 / 120, signal('dissolving', { diffusionAge: age }));
    assert.equal(f.beat, 'rest');
    assert.equal(f.stretch, 0);
    assert.equal(f.bend, 0);
    assert.equal(f.crown, 0);
  }
  const savor = r.step(1 / 120, signal('dissolving', { diffusionAge: 1.25 }));
  assert.equal(savor.beat, 'savor');
  assert.ok(savor.pose.closeL > 0.8 && savor.crown > 0);
  const quiet = advance(r, 4, signal('settling', { diffusionAge: 10 }));
  assert.deepEqual([quiet.stretch, quiet.bend, quiet.crown], [0, 0, 0]);
});

test('completion performs once and cancellation or a new candy cannot replay it', () => {
  const r = new FeedingReaction();
  advance(r, 1, signal('inside'));
  advance(r, 0.5, signal('done'));
  assert.equal(r.frame().beat, 'finish');
  assert.ok(r.frame().crown > 0 && r.frame().crown <= 0.025);
  advance(r, 8, signal('done'));
  assert.equal(r.frame().active, false);
  advance(r, 1, signal('done'));
  assert.equal(r.frame().active, false);
  advance(r, 0.5, signal('pressing', { id: 2, held: true, pressure: 5 }));
  assert.equal(r.frame().face, 'curious');
  r.step(1 / 120, signal('pressing', { id: 2, held: true, withdrawing: true }));
  assert.equal(r.frame().beat, 'withdraw');
  r.step(1 / 120, null);
  assert.equal(r.frame().active, false);
  advance(r, 0.5, signal('done', { id: 2 }));
  assert.equal(
    r.frame().active,
    false,
    'a skipped or canceled meal has no finish',
  );
  advance(r, 1, signal('inside', { id: 3 }));
  advance(r, 0.4, signal('done', { id: 3 }));
  r.interrupt();
  advance(r, 0.2, signal('done', { id: 3 }));
  assert.equal(r.frame().active, false);
});

test('contact gaze uses the local side and height of the actual candy', () => {
  const r = new FeedingReaction();
  let f = r.step(1 / 120, signal('pressing', { held: true }), {
    x: -1,
    y: 1.8,
    z: 0.1,
  });
  assert.ok(f.gazeX < -0.7 && f.gazeY > 0.5);
  assert.ok(
    f.bend === 0,
    'hand contact tracks with the eyes, without leaning toward it',
  );
  f = r.step(1 / 120, signal('pressing', { id: 2, held: true }), {
    x: 1,
    y: 0.1,
    z: 0.1,
  });
  assert.ok(f.gazeX > 0.7 && f.gazeY < -0.3);
  assert.ok(f.bend === 0);
});

test('meal movement supplies bounded internal forces and yields to a real body hold', () => {
  const { body, profile } = characterFixture();
  const s = new VolumeSoftBody(
    createCage(profile, body.attributes.position.array),
  );
  const motor = new CharacterMotor(s),
    sensor = new BodyPosture(s.rest, s.mass),
    r = new FeedingReaction();
  const p = sensor.sample(s.x, s.velocity);
  const o = {
    time: 0,
    center: p.center,
    velocity: [0, 0, 0],
    up: p.up,
    forward: p.forward,
    grounded: true,
    held: false,
    stable: true,
    width: 3.23,
    height: 2.35,
    impactSpeed: 0,
    rendezvous: [0, 0, 0],
    viewerDirection: [0, 0, 1],
    cameraMoving: false,
    absorbing: true,
  };
  const intent = {
    phase: 'absorbing',
    candy: null,
    destination: null,
    facing: [0, 0, 1],
    mood: 0,
    social: 'none',
    socialAge: 0,
    comfort: 0,
    joy: 0,
    gait: 'hop',
    desiredSpeed: 0,
    body: 'brake',
  };
  const start = s.x.slice();
  let crown = 0,
    max = 0;
  for (let i = 0; i < 180; i++) {
    const f = r.step(1 / 240, signal('inside'));
    s.velocity.fill(0);
    motor.step(o, intent, 1 / 240, f);
    const mean = [0, 0, 0];
    let mass = 0;
    for (let n = 0; n < s.nodeCount; n++) {
      mass += s.mass[n];
      for (let k = 0; k < 3; k++) mean[k] += s.mass[n] * s.velocity[n * 3 + k];
      max = Math.max(max, Math.hypot(...s.velocity.subarray(n * 3, n * 3 + 3)));
      if (s.rest[n * 3 + 1] > 1.9)
        crown = Math.max(crown, Math.abs(s.velocity[n * 3 + 1]));
    }
    assert.ok(
      Math.hypot(...mean) / mass < 1e-5,
      'a satisfied wiggle must not propel the whole body',
    );
  }
  assert.ok(
    crown > 0.0005,
    'the performance must exert real force on the soft crown',
  );
  assert.ok(max < 0.45, `readable reaction remains impulse-limited: ${max}`);
  assert.deepEqual(s.x, start, 'the motor must not write a pose into geometry');
  s.velocity.fill(0);
  motor.step({ ...o, held: true }, intent, 1 / 240, r.frame());
  assert.ok(
    s.velocity.every((v) => v === 0),
    'direct body input owns motion',
  );
});
