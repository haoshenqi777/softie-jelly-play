import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXPRESSION,
  normalizeExpression,
  parseSavedExpression,
} from '../lib/softbody/expression-settings.ts';

test('expression settings reject corrupt storage and normalize without mutating defaults', () => {
  for (const value of [
    null,
    '',
    '{',
    'null',
    '[]',
    '{"version":2,"values":{}}',
  ])
    assert.equal(parseSavedExpression(value), null);
  const value = normalizeExpression({
    intensity: 180,
    speed: -8,
    expression: 'missing',
    gaze: 'yes',
    responsive: false,
  });
  assert.equal(value.intensity, 100);
  assert.equal(value.speed, 0);
  assert.equal(value.expression, 'neutral');
  assert.equal(value.gaze, true);
  assert.equal(DEFAULT_EXPRESSION.speed, 50);
  assert.equal(normalizeExpression({ speed: NaN }).speed, 50);
});

test('manual, reactive, and sequence modes are exclusive and saved audition does not auto-play', () => {
  const manual = normalizeExpression({ expression: 'sad' });
  assert.equal(manual.responsive, false);
  const loop = normalizeExpression({ sequence: true }, manual);
  assert.equal(loop.responsive, false);
  const live = normalizeExpression({ responsive: true }, loop);
  assert.equal(live.sequence, false);
  const saved = parseSavedExpression(
    JSON.stringify({
      version: 1,
      values: { ...loop, intensity: 67, microMotion: false },
    }),
  );
  assert.equal(saved.sequence, false);
  assert.equal(saved.responsive, false);
  assert.equal(saved.expression, 'sad');
  assert.equal(saved.intensity, 67);
  assert.equal(saved.microMotion, false);
});
