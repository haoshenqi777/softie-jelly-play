import test from 'node:test';
import assert from 'node:assert/strict';
import { BubbleWorld } from '../lib/bubble-world.ts';
test('major feedback bubbles are limited, move and expire without accumulation', () => {
  const w = new BubbleWorld();
  for (let i = 0; i < 8; i++) w.emit('heart', { x: 0, y: 2.7, z: 0 });
  assert.equal(w.bubbles.length, 2);
  const y = w.bubbles[0].y;
  w.advance(0.1);
  assert.ok(w.bubbles[0].y > y);
  for (let i = 0; i < 500; i++) w.advance(1 / 120);
  assert.equal(w.bubbles.length, 0);
});
test('a bubble pops once and keeps its short collapse animation before removal', () => {
  const w = new BubbleWorld();
  const b = w.emit('star', { x: 0, y: 2.7, z: 0 });
  assert.ok(w.pop(b.id));
  assert.equal(w.pop(b.id), false);
  assert.equal(w.bubbles.length, 1);
  w.advance(0.1);
  assert.ok(w.bubbles[0].popping);
  w.advance(0.1);
  w.advance(0.1);
  assert.equal(w.bubbles.length, 0);
});
