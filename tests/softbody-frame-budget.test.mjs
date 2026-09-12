import test from 'node:test';
import assert from 'node:assert/strict';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { characterFixture } from './softbody-fixture.mjs';
test('delayed frame bounds catch-up work and does not carry stale work into the next input', () => {
  const s = new VolumeSoftBody(characterFixture().cage);
  let count = 0;
  s.advance(0.1, () => count++);
  assert.ok(count <= 8, `delayed frame ran ${count} substeps`);
  count = 0;
  s.grab(20, s.x.slice(60, 63), 0.6);
  s.moveGrab([0.2, 1.7, 0.4]);
  s.advance(1 / 60, () => count++);
  assert.equal(
    count,
    4,
    'normal frame responds to fresh target without old backlog',
  );
  assert.ok(s.x.every(Number.isFinite));
});
