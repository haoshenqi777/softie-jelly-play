import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CandyPointer } from '../lib/candy-pointer.ts';
test('losing tray focus cancels only an entity owned by an active tray drag', () => {
  const p = new CandyPointer();
  let cancelled = 0;
  const cancel = () => cancelled++;
  p.reset(cancel);
  p.begin(1, 0, 0, 0);
  p.reset(cancel);
  assert.equal(cancelled, 0);
  p.begin(2, 0, 0, 0);
  p.active.dragging = true;
  p.reset(cancel);
  assert.equal(cancelled, 1);
});
test('cancelling a drag does not consume a subsequent keyboard feed', () => {
  const p = new CandyPointer();
  p.begin(1, 0, 0, 0);
  p.active.dragging = true;
  p.cancel(1);
  assert.equal(p.allowClick(undefined, true), true);
  assert.equal(p.allowClick(1, false), false);
});
test('a second touch cannot take ownership or trigger an unintended meal', () => {
  const p = new CandyPointer();
  p.begin(1, 0, 0, 0);
  p.active.dragging = true;
  assert.equal(p.begin(2, 1, 30, 0), false);
  assert.equal(p.active.id, 1);
  assert.equal(p.end(2), null);
  assert.equal(p.allowClick(2, false), false);
  assert.equal(p.end(1).dragging, true);
  assert.equal(p.allowClick(1, false), false);
});
test('reset suppresses the release click from the cancelled drag', () => {
  const p = new CandyPointer();
  p.begin(1, 0, 0, 0);
  p.active.dragging = true;
  assert.equal(p.reset().id, 1);
  assert.equal(p.end(1), null);
  assert.equal(p.allowClick(1, false), false);
  p.begin(1, 1, 0, 0);
  p.end(1);
  assert.equal(p.allowClick(1, false), true);
});
test('a drop has one action and keyboard can feed again after the meal', () => {
  const p = new CandyPointer();
  p.begin(1, 0, 0, 0);
  p.active.dragging = true;
  p.end(1);
  assert.equal(p.allowClick(1, false), false);
  assert.equal(p.allowClick(undefined, true), true);
});
