import test from 'node:test';
import assert from 'node:assert/strict';
const mod = await import('../lib/touch-orbit.ts').catch(() => ({}));
test('a single touch cannot rotate; two touches use centroid and stop when either lifts', () => {
  assert.equal(typeof mod.TouchOrbit, 'function');
  const t = new mod.TouchOrbit();
  t.down(1, 0, 0);
  assert.equal(t.move(1, 40, 0), null);
  t.down(2, 80, 0);
  const delta = t.move(2, 100, 10);
  assert.equal(delta.x, 10);
  assert.equal(delta.y, 5);
  assert.ok(Math.abs(delta.zoom - 40 / Math.hypot(60, 10)) < 1e-8);
  t.up(1);
  assert.equal(t.move(2, 120, 10), null);
  t.up(2);
  assert.equal(t.size, 0);
});
test('pinch handles coincident fingers and rebases when fingers are replaced', () => {
  const t = new mod.TouchOrbit();
  t.down(1, 0, 0);
  t.down(2, 0, 0);
  assert.equal(t.move(2, 50, 0).zoom, 1);
  assert.equal(t.move(2, 100, 0).zoom, 0.5);
  t.down(3, 70, 0);
  assert.equal(t.move(2, 110, 0), null);
  t.up(1);
  assert.equal(t.move(3, 70, 0).zoom, 1);
});
