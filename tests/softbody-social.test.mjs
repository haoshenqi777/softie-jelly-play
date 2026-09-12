import test from 'node:test';
import assert from 'node:assert/strict';
import { SocialResponse } from '../lib/softbody/social-response.ts';

const advance = (
  s,
  seconds,
  mood = 0.5,
  active = true,
  held = false,
  hz = 60,
) => {
  for (let n = 0; n < seconds * hz; n++) s.step(1 / hz, mood, active, held);
  return s.frame();
};

test('complaint reads as look, gradual inflation, one stamp, then a finite wait', () => {
  const s = new SocialResponse();
  s.arrive(0.6);
  const beats = [s.frame().beat];
  for (let n = 0; n < 600; n++) {
    s.step(1 / 60, 0.5, true);
    if (beats.at(-1) !== s.frame().beat) beats.push(s.frame().beat);
  }
  assert.deepEqual(beats, ['look', 'inflate', 'stamp', 'wait', 'none']);
});

test('comfort needs continuous gentle attention, then exhales before approaching', () => {
  const s = new SocialResponse();
  s.arrive(0.55);
  let mood = 0.55;
  mood -= s.stroke(0.2, mood);
  assert.equal(mood, 0.55, 'one fleeting touch cannot erase the complaint');
  advance(s, 0.9, mood);
  mood -= s.stroke(0.2, mood);
  assert.equal(mood, 0.55, 'separated taps cannot bank instant soothing');
  for (let n = 0; n < 120; n++) {
    mood = Math.max(0, mood - s.stroke(1 / 60, mood));
    s.step(1 / 60, mood, true, true);
  }
  assert.ok(mood < 0.1);
  assert.equal(s.frame().beat, 'soften');
  assert.equal(s.frame().age, 0, 'hands keep physical ownership while petting');
  const beats = [];
  for (let n = 0; n < 300; n++) {
    s.step(1 / 60, mood, true);
    if (beats.at(-1) !== s.frame().beat) beats.push(s.frame().beat);
  }
  assert.deepEqual(beats, ['soften', 'nuzzle', 'content', 'none']);
});

test('unfinished soothing returns to waiting; forceful interruption clears the performance', () => {
  const s = new SocialResponse();
  s.arrive(0.8);
  s.stroke(0.55, 0.8);
  assert.equal(s.frame().beat, 'soften');
  assert.equal(advance(s, 1.2, 0.7).beat, 'wait');
  s.interrupt(true);
  assert.equal(s.frame().beat, 'none');
  assert.equal(s.frame().joy, 0);
  assert.equal(s.frame().comfort, 0);
  advance(s, 4, 0.7);
  assert.equal(s.frame().beat, 'none', 'cancelled performances cannot resume');
});

test('social timing agrees at 30/60/120 Hz and ignores invalid input', () => {
  for (const hz of [30, 60, 120]) {
    const s = new SocialResponse();
    s.arrive(0.5);
    assert.equal(advance(s, 2, 0.5, true, false, hz).beat, 'wait');
    const before = { ...s.frame() };
    for (const value of [NaN, Infinity, -1, 0]) {
      s.step(value, 0.5, true);
      assert.equal(s.stroke(value, 0.5), 0);
    }
    assert.deepEqual(s.frame(), before);
  }
});
