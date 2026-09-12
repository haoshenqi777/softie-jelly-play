import test from 'node:test';
import assert from 'node:assert/strict';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { characterFixture } from './softbody-fixture.mjs';
import { MotionPerception } from '../lib/softbody/perception.ts';
import { rendezvous } from '../lib/softbody/rendezvous.ts';
test('physical release distinguishes carrying, throwing and cancellation without duplicate releases', () => {
  const s = new VolumeSoftBody(characterFixture().cage),
    p = new MotionPerception();
  p.observePointer('down', 0);
  assert.equal(p.sample(s, 0)[0].kind, 'grab');
  for (let i = 0; i < s.x.length; i += 3) s.x[i] += 2;
  s.kick(3, 1, 0);
  p.observePointer('up', 1);
  const release = p.sample(s, 0)[0];
  assert.ok(release.carriedDistance > 1.99);
  assert.ok(Math.abs(release.velocity[0] - 3) < 1e-10);
  p.observePointer('up', 1);
  assert.deepEqual(p.sample(s, 0), []);
  p.observePointer('down', 2);
  p.sample(s, 0);
  p.observePointer('cancel', 3);
  assert.equal(p.sample(s, 0)[0].kind, 'cancel');
  p.observePointer('up', 3);
  assert.deepEqual(p.sample(s, 0), []);
});
test('camera rendezvous stays on the table and preserves the last horizontal direction for vertical views', () => {
  const a = rendezvous([0, 5, 10], [0, 0, 0], 3, [1, 0, 0]),
    b = rendezvous([0, 30, 10], [0, 0, 0], 3, [1, 0, 0]);
  assert.deepEqual(a, b);
  assert.equal(a.point[1], 0);
  assert.deepEqual(
    rendezvous([0, 10, 0], [0, 0, 0], 3, [1, 0, 0]).direction,
    [1, 0, 0],
  );
});
