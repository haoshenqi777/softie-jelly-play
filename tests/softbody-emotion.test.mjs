import test from 'node:test';
import assert from 'node:assert/strict';
import { EmotionDirector } from '../lib/softbody/emotion.ts';

function director() {
  return new EmotionDirector();
}

function advance(emotion, seconds, step = 1 / 60) {
  for (let left = seconds; left > 1e-9; left -= step)
    emotion.update(Math.min(left, step));
}

function stroke(emotion, seconds, step = 0.05) {
  for (let left = seconds; left > 1e-9; left -= step) {
    const dt = Math.min(left, step);
    emotion.notify('stroke', dt);
    emotion.update(dt);
  }
}

test('quiet attention occasionally peeks before falling asleep, and a touch wakes for a full beat', () => {
  const emotion = director();
  assert.equal(emotion.frame().id, 'neutral');
  const seen = new Set();
  for (let i = 0; i < 330; i++) {
    emotion.update(0.1);
    seen.add(emotion.frame().id);
  }
  assert.ok(seen.has('peek'), 'a quiet face occasionally looks over');
  assert.equal(emotion.frame().id, 'sleepy');
  emotion.notify('touch');
  assert.equal(emotion.frame().id, 'waking');
  advance(emotion, 0.3);
  emotion.notify('release');
  emotion.notify('poke');
  assert.equal(
    emotion.frame().id,
    'waking',
    'release-generated poke must not erase waking',
  );
  advance(emotion, 0.8);
  assert.equal(emotion.frame().id, 'waking');
  advance(emotion, 0.11);
  assert.equal(emotion.frame().id, 'neutral');
});

test('a direct poke wakes a sleeping face without restarting the waking beat on later contact', () => {
  const emotion = director();
  emotion.notify('sleep');
  emotion.notify('poke');
  advance(emotion, 0.6);
  emotion.notify('touch');
  emotion.notify('poke');
  advance(emotion, 0.61);
  assert.equal(emotion.frame().id, 'neutral');
});

test('a single poke reacts briefly, while three nearby pokes build anger that slowly cools', () => {
  const emotion = director();
  emotion.notify('poke');
  assert.ok(['surprised', 'effort'].includes(emotion.frame().id));
  assert.ok(emotion.frame().heat > 0.25 && emotion.frame().heat < 0.4);
  advance(emotion, 0.15);
  emotion.notify('poke');
  advance(emotion, 0.15);
  emotion.notify('poke');
  assert.equal(emotion.frame().id, 'angry');
  const heat = emotion.frame().heat;
  assert.ok(heat > 0.8 && heat <= 1);
  advance(emotion, 4);
  assert.ok(
    emotion.frame().heat > 0.3 && emotion.frame().heat < heat,
    'heat cools gradually',
  );
  const single = director();
  single.notify('poke');
  advance(single, 2);
  assert.equal(single.frame().id, 'neutral');
});

test('gentle strokes soothe anger before contentment, without restarting each frame', () => {
  const emotion = director();
  for (let i = 0; i < 3; i++) emotion.notify('poke');
  stroke(emotion, 0.2);
  assert.equal(
    emotion.frame().id,
    'angry',
    'comfort must accumulate before anger changes',
  );
  stroke(emotion, 0.2);
  assert.equal(emotion.frame().id, 'soothed');
  const firstAge = emotion.frame().age;
  stroke(emotion, 0.5);
  assert.equal(emotion.frame().id, 'soothed');
  assert.ok(
    emotion.frame().age > firstAge + 0.45,
    'continuous strokes do not rewind the performance',
  );
  stroke(emotion, 0.8);
  assert.equal(emotion.frame().id, 'content');
  assert.ok(emotion.frame().heat < 0.3);
});

test('a disappointed face also needs a little comfort before it relaxes', () => {
  const emotion = director();
  emotion.notify('food');
  emotion.notify('withdraw');
  assert.equal(emotion.frame().id, 'sad');
  stroke(emotion, 0.4);
  assert.equal(emotion.frame().id, 'soothed');
  advance(emotion, 1.3);
  assert.equal(emotion.frame().id, 'content');
});

test('continuous gentle play grows from giggle to happy to content and preserves expression age', () => {
  const emotion = director();
  stroke(emotion, 0.4);
  assert.equal(emotion.frame().id, 'giggle');
  const age = emotion.frame().age;
  stroke(emotion, 0.25);
  assert.equal(emotion.frame().id, 'giggle');
  assert.ok(emotion.frame().age > age + 0.2);
  stroke(emotion, 0.55);
  assert.equal(emotion.frame().id, 'happy');
  stroke(emotion, 1.2);
  assert.equal(emotion.frame().id, 'content');
  stroke(emotion, 4);
  assert.equal(
    emotion.frame().id,
    'content',
    'continuing affection does not fall back to neutral',
  );
  advance(emotion, 5);
  assert.equal(emotion.frame().id, 'neutral');
});

test('sustained stretching holds effort, keeps its age and releases even before it becomes idle', () => {
  const emotion = director();
  emotion.notify('stretch', 0.3);
  assert.equal(emotion.frame().id, 'effort');
  const firstStrength = emotion.frame().strength;
  for (let i = 0; i < 400; i++) {
    emotion.notify('stretch', 0.8);
    emotion.update(0.1);
  }
  assert.equal(emotion.frame().id, 'effort');
  assert.ok(emotion.frame().age > 39);
  assert.ok(emotion.frame().strength > firstStrength);
  assert.ok(emotion.frame().idle < 0.2);
  emotion.notify('release');
  assert.notEqual(emotion.frame().id, 'effort');
  advance(emotion, 2);
  assert.equal(emotion.frame().id, 'neutral');
});

test('insignificant landings are quiet and significant landings have a replay cooldown', () => {
  const emotion = director();
  emotion.notify('land', 1.2);
  assert.equal(emotion.frame().id, 'neutral');
  emotion.notify('land', 2);
  assert.equal(emotion.frame().id, 'surprised');
  advance(emotion, 0.2);
  const age = emotion.frame().age;
  emotion.notify('land', 4);
  assert.equal(
    emotion.frame().id,
    'surprised',
    'contact noise cannot replace the real landing',
  );
  assert.equal(emotion.frame().age, age);
  advance(emotion, 1.3);
  emotion.notify('land', 4);
  assert.equal(emotion.frame().id, 'dizzy');
  advance(emotion, 2.5);
  assert.equal(emotion.frame().id, 'neutral');
});

test('food previews are interruptible and a reward becomes proud then content', () => {
  const emotion = director();
  emotion.notify('food');
  assert.equal(emotion.frame().id, 'curious');
  emotion.notify('withdraw');
  assert.equal(emotion.frame().id, 'sad');
  emotion.notify('food');
  emotion.notify('withdraw');
  assert.equal(emotion.frame().id, 'angry');
  emotion.notify('fed');
  assert.equal(emotion.frame().id, 'proud');
  advance(emotion, 1.4);
  assert.equal(emotion.frame().id, 'content');
  emotion.notify('poke');
  assert.notEqual(emotion.frame().id, 'content');
});

test('frame cadence does not change sleep, timelines or cooling', () => {
  function replay(step) {
    const emotion = director();
    advance(emotion, 33.2, step);
    emotion.notify('touch');
    advance(emotion, 1.7, step);
    emotion.notify('poke');
    advance(emotion, 0.25, step);
    emotion.notify('poke');
    advance(emotion, 0.25, step);
    emotion.notify('poke');
    advance(emotion, 4.17, step);
    emotion.notify('fed');
    advance(emotion, 2.27, step);
    return emotion.frame();
  }
  const slow = replay(0.1),
    fast = replay(1 / 120);
  assert.equal(slow.id, fast.id);
  for (const field of ['strength', 'age', 'heat', 'idle']) {
    assert.ok(
      Math.abs(slow[field] - fast[field]) < 1e-7,
      field + ' is cadence independent',
    );
  }
});

test('invalid elapsed time is ignored and large elapsed time is capped to one small frame', () => {
  const emotion = director();
  emotion.notify('poke');
  const before = emotion.frame();
  for (const dt of [NaN, Infinity, -Infinity, -1, 0]) emotion.update(dt);
  assert.deepEqual(emotion.frame(), before);
  emotion.update(10000);
  assert.ok(Math.abs(emotion.frame().age - 0.1) < 1e-9);
  assert.ok(Math.abs(emotion.frame().idle - 0.1) < 1e-9);
});

test('small valid time steps still accumulate instead of being discarded', () => {
  const emotion = director();
  for (let i = 0; i < 10000; i++) emotion.update(1e-10);
  assert.ok(Math.abs(emotion.frame().age - 0.000001) < 1e-12);
  assert.ok(Math.abs(emotion.frame().idle - 0.000001) < 1e-12);
});

test('crossing the comfort threshold between frames soothes the same amount at different cadences', () => {
  function replay(step) {
    const emotion = director();
    for (let i = 0; i < 3; i++) emotion.notify('poke');
    stroke(emotion, 0.4, step);
    return emotion.frame();
  }
  const slow = replay(0.1),
    fast = replay(0.025);
  assert.equal(slow.id, 'soothed');
  assert.equal(fast.id, 'soothed');
  assert.ok(
    Math.abs(slow.heat - fast.heat) < 1e-9,
    'do not lose comfort that crosses the threshold',
  );
});

test('invalid interaction amounts never contaminate a finite bounded frame', () => {
  const emotion = director();
  for (const event of ['poke', 'stroke', 'stretch', 'land']) {
    for (const amount of [NaN, Infinity, -Infinity, -1])
      emotion.notify(event, amount);
  }
  assert.equal(emotion.frame().id, 'neutral');
  for (let i = 0; i < 30; i++) emotion.notify('poke', 1e100);
  emotion.notify('stretch', 1e100);
  advance(emotion, 2);
  for (const value of Object.values(emotion.frame()).filter(
    (v) => typeof v === 'number',
  ))
    assert.ok(Number.isFinite(value));
  assert.ok(emotion.frame().heat >= 0 && emotion.frame().heat <= 1);
  assert.ok(emotion.frame().strength >= 0 && emotion.frame().strength <= 1);
});

test('reset clears anger, sleep, landing cooldown and pending performances', () => {
  const emotion = director();
  for (let i = 0; i < 3; i++) emotion.notify('poke');
  emotion.notify('land', 5);
  emotion.notify('sleep');
  emotion.reset();
  assert.deepEqual(emotion.frame(), {
    id: 'neutral',
    strength: 1,
    age: 0,
    heat: 0,
    idle: 0,
  });
  advance(emotion, 2);
  assert.equal(emotion.frame().id, 'neutral');
  emotion.notify('land', 5);
  assert.equal(emotion.frame().id, 'dizzy');
});

test('a stumble notices a side fall or an upside-down fall before looking for footing', () => {
  for (const [severity, first] of [
    [0, 'surprised'],
    [1, 'dizzy'],
  ]) {
    const emotion = director();
    emotion.notify('stumble', severity);
    assert.equal(emotion.frame().id, first);
    const seen = new Set();
    for (let i = 0; i < 25; i++) {
      emotion.update(0.1);
      seen.add(emotion.frame().id);
    }
    assert.ok(
      seen.has('peek'),
      'it checks its surroundings after the surprise',
    );
    assert.equal(emotion.frame().id, 'neutral');
  }
});

test('righting heartbeats hold effort without restarting its age or falling asleep', () => {
  const emotion = director();
  emotion.notify('righting', 0);
  assert.equal(emotion.frame().id, 'effort');
  const firstStrength = emotion.frame().strength;
  for (let i = 0; i < 400; i++) {
    emotion.notify('righting', 1);
    emotion.update(0.1);
  }
  assert.equal(emotion.frame().id, 'effort');
  assert.ok(emotion.frame().age > 39);
  assert.ok(emotion.frame().strength > firstStrength);
  assert.ok(emotion.frame().idle < 0.2);
  const beforeLanding = emotion.frame();
  emotion.notify('land', 5);
  assert.deepEqual(
    emotion.frame(),
    beforeLanding,
    'floor contacts cannot overwrite active effort',
  );
});

test('righting effort expires when its controller stops sending heartbeats', () => {
  const emotion = director();
  emotion.notify('righting', 0.8);
  assert.equal(emotion.frame().id, 'effort');
  advance(emotion, 2);
  assert.equal(emotion.frame().id, 'neutral');
});

test('standing up shows relief, then pride, then returns to neutral', () => {
  const emotion = director();
  emotion.notify('righting', 1);
  emotion.notify('recovered');
  assert.equal(emotion.frame().id, 'soothed');
  let sawPride = false;
  for (let i = 0; i < 35; i++) {
    emotion.update(0.1);
    sawPride ||= emotion.frame().id === 'proud';
  }
  assert.ok(sawPride);
  assert.equal(emotion.frame().id, 'neutral');
});

test('recovery cancellation clears every recovery performance', () => {
  for (const event of ['stumble', 'righting', 'recovered']) {
    const emotion = director();
    emotion.notify(event, 1);
    assert.notEqual(emotion.frame().id, 'neutral');
    emotion.notify('recovery-cancel');
    assert.equal(emotion.frame().id, 'neutral');
    advance(emotion, 3);
    assert.equal(
      emotion.frame().id,
      'neutral',
      'cancelled beats must not return',
    );
  }
});

test('real interaction interrupts recovery and cancellation preserves the new reaction', () => {
  for (const recovery of ['stumble', 'righting', 'recovered']) {
    for (const [event, amount, expected] of [
      ['touch', undefined, 'shy'],
      ['poke', 1, 'surprised'],
      ['stroke', 0.2, 'giggle'],
      ['stretch', 0.6, 'effort'],
    ]) {
      const emotion = director();
      emotion.notify(recovery, 1);
      emotion.notify(event, amount);
      assert.equal(
        emotion.frame().id,
        expected,
        `${event} interrupts ${recovery}`,
      );
      advance(emotion, 0.1);
      const interactionFrame = emotion.frame();
      emotion.notify('recovery-cancel');
      assert.deepEqual(
        emotion.frame(),
        interactionFrame,
        'cleanup preserves interaction ownership',
      );
    }
  }
});

test('recovery cancellation leaves unrelated reaction timelines and idle attention alone', () => {
  for (const event of ['poke', 'food', 'fed', 'stretch', 'sleep']) {
    const emotion = director();
    const untouched = director();
    emotion.notify(event, 1);
    untouched.notify(event, 1);
    advance(emotion, 0.2);
    advance(untouched, 0.2);
    emotion.notify('recovery-cancel');
    assert.deepEqual(emotion.frame(), untouched.frame());
    advance(emotion, 2);
    advance(untouched, 2);
    assert.deepEqual(emotion.frame(), untouched.frame());
  }
});

test('reset clears a held recovery effort and its pending expiration', () => {
  const emotion = director();
  emotion.notify('righting', 1);
  assert.equal(emotion.frame().id, 'effort');
  emotion.reset();
  emotion.notify('food');
  advance(emotion, 1);
  assert.equal(emotion.frame().id, 'curious');
});
