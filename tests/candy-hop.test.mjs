import test from 'node:test';
import assert from 'node:assert/strict';
import { CandyHop } from '../lib/softbody/candy-hop.ts';
import { BodyPosture } from '../lib/softbody/posture.ts';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { characterFixture } from './softbody-fixture.mjs';

test('a candy hop waits on the floor, launches once, and never corrects translation in flight', () => {
  const { cage } = characterFixture();
  const s = new VolumeSoftBody(cage),
    hop = new CandyHop(s);
  const p = new BodyPosture(s.rest, s.mass).sample(s.x, s.velocity);
  const food = { id: 1, point: [2, 0.18, 0], destination: [1.65, 0, 0] };
  const initial = s.x.slice();
  let launches = 0;
  const kick = s.kick.bind(s);
  s.kick = (...args) => {
    launches++;
    kick(...args);
  };
  for (let i = 0; i < 25; i++) hop.step(p, true, food, 5, 1 / 120);
  assert.equal(launches, 0, 'no sliding toward food during anticipation');
  for (let i = 0; i < 38; i++) hop.step(p, true, food, 5, 1 / 120);
  assert.equal(launches, 1);
  const v = s.velocity.slice();
  food.destination = [-3, 0, -2];
  for (let i = 0; i < 35; i++) hop.step(p, false, food, 5, 1 / 120);
  assert.equal(launches, 1, 'no attraction or extra impulses in midair');
  assert.deepEqual(s.x, initial, 'motor never writes a position or pose');
  assert.ok(v.some((x) => x > 0));
  hop.interrupt();
  s.velocity.fill(0);
  assert.equal(hop.stats().phase, 'idle');
});
test('far food gets a bounded low stride before a higher final pounce', () => {
  const { cage } = characterFixture();
  const launch = (distance) => {
    const s = new VolumeSoftBody(cage),
      h = new CandyHop(s);
    const p = new BodyPosture(s.rest, s.mass).sample(s.x, s.velocity);
    let impulse;
    s.kick = (...v) => {
      impulse = v;
    };
    for (let i = 0; i < 70; i++)
      h.step(
        p,
        true,
        { destination: [distance, 0, 0], invited: true, id: 1 },
        5,
        1 / 120,
      );
    return { impulse, stats: h.stats() };
  };
  const far = launch(5),
    near = launch(1.4);
  assert.equal(far.stats.kind, 'stride');
  assert.equal(near.stats.kind, 'pounce');
  assert.ok(far.stats.destination[0] < 1.7);
  assert.ok(near.impulse[1] > far.impulse[1] * 1.3);
});
