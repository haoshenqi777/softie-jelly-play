import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleMeal } from '../lib/meal-motion.ts';
import { MEAL } from '../lib/slime-character.ts';
test('the solid candy enters before internal dispersion begins', () => {
  const entrance = sampleMeal(0.25, MEAL),
    chew = sampleMeal(1.2, MEAL),
    swallow = sampleMeal(3.1, MEAL),
    spread = sampleMeal(4.8, MEAL);
  assert.ok(entrance.ingest > 0 && entrance.ingest < 1);
  assert.equal(entrance.dispersion, 0);
  assert.ok(chew.chew > 0);
  assert.equal(chew.dispersion, 0);
  assert.ok(swallow.swallow > 0 && swallow.swallow < 1);
  assert.ok(spread.dispersion > 0 && spread.dispersion < 1);
});
test('the three chew lobes are separated and alternate cheeks', () => {
  const peaks = [1, 1.7, 2.4].map((t) => sampleMeal(t, MEAL));
  assert.ok(peaks.every((p) => p.chew > 0.9));
  assert.deepEqual(
    peaks.map((p) => Math.sign(p.chewSide)),
    [-1, 1, -1],
  );
  assert.equal(sampleMeal(3.1, MEAL).chew, 0);
});
test('swallow and syrup movement remain continuous across stage boundaries', () => {
  for (const t of [MEAL.bite, MEAL.chewEnd, MEAL.swallowEnd, MEAL.end]) {
    const a = sampleMeal(t - 0.00001, MEAL),
      b = sampleMeal(t + 0.00001, MEAL);
    assert.ok(Math.abs(a.swallow - b.swallow) < 0.001);
    assert.ok(Math.abs(a.dispersion - b.dispersion) < 0.001);
  }
  assert.equal(sampleMeal(-1, MEAL).visibility, 0);
  assert.equal(sampleMeal(10, MEAL).visibility, 0);
});
