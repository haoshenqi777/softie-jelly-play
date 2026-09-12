import test from 'node:test';
import assert from 'node:assert/strict';
import { CandyWorld } from '../lib/candy-physics.ts';
import { SlimeDynamics } from '../lib/slime-physics.ts';
import { SlimeFeeding } from '../lib/slime-feeding.ts';
import { SlimeContactSurface } from '../lib/slime-contact.ts';
const mouthOf = (s) => {
  const p = s.deform(0, 1.025, 1.17);
  return { x: p.x + s.x, y: p.y + s.y, z: p.z + s.z };
};
for (const [x, z] of [
  [0, 1.2],
  [-1.6, 0.6],
  [1.6, 2.4],
  [2.2, -0.3],
  [1.63, 2.715],
  [0, -0.615],
]) {
  for (const fullness of [0, 3 / 7, 6 / 7]) {
    test(`a grounded candy at ${x},${z}, fullness ${fullness.toFixed(2)} is physically picked up and reaches the mouth`, () => {
      const s = new SlimeDynamics(),
        w = new CandyWorld(),
        f = new SlimeFeeding();
      const skin = new SlimeContactSurface(s);
      s.fullness = s.pose.fullness = fullness;
      const c = w.spawn('#6ecfb1', 'gummy', { x, y: 0.085, z });
      let ate = false,
        lifts = 0;
      for (let i = 0; i < 2400; i++) {
        const mouth = mouthOf(s);
        const action = f.update(
          1 / 120,
          w.candies,
          { x: s.x, y: s.y, z: s.z, mouth, held: false, bound: 2.3 },
          true,
        );
        if (action.scoopId !== null) lifts++;
        f.apply(action, s, w, mouth);
        s.advance(1 / 120);
        const nextMouth = mouthOf(s);
        w.advance(1 / 120, {
          x: s.x,
          y: s.y,
          z: s.z,
          mouth: nextMouth,
          edibleId: f.targetId,
          contact: skin.contact,
        });
        if (f.contact(w.candies, nextMouth) === c.id) {
          ate = true;
          break;
        }
      }
      assert.ok(lifts > 0, 'must nudge ground candy before eating');
      assert.ok(
        ate,
        JSON.stringify({
          c,
          body: [s.x, s.y, s.z],
          distance: f.distance,
          lifts,
        }),
      );
    });
  }
}
