import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { BodyPosture } from '../lib/softbody/posture.ts';
import { FloorSurface } from '../lib/softbody/floor-surface.ts';
import { GaitMotor } from '../lib/softbody/gait.ts';
import { characterFixture } from './softbody-fixture.mjs';
const bytes = readFileSync(
  new URL('../public/physics/volume.wasm', import.meta.url),
);

test('stalled fallback clears the ground higher than a normal low step, without changing the resting mesh', async () => {
  const heights = [];
  for (const mode of ['scoot', 'hop']) {
    const { cage, body } = characterFixture(),
      s = new VolumeSoftBody(cage);
    await s.accelerate(bytes);
    const sensor = new BodyPosture(s.rest, s.mass),
      skin = new FloorSurface(cage, body.attributes.position.array),
      gait = new GaitMotor(s),
      rest = s.rest.slice();
    let height = 0;
    for (let k = 0; k < 360; k++)
      s.advance(1 / 240, (dt) => {
        s.setFloorLevel(skin.level(s.x));
        const p = sensor.sample(s.x, s.velocity);
        height = Math.max(height, p.minY - s.floorLevel);
        gait.step(
          p,
          p.minY - s.floorLevel < 0.025,
          [1, 0, 0],
          0.7,
          dt,
          mode,
          0.4,
        );
      });
    heights.push(height);
    assert.deepEqual(s.rest, rest);
    assert.ok(s.stats().minJacobian > 0.5);
  }
  assert.ok(heights[1] > heights[0] + 0.12, JSON.stringify(heights));
});
test('short physical steps travel in either direction, have ground/air beats and brake without teleporting', async () => {
  for (const sign of [-1, 1]) {
    const { cage, body } = characterFixture(),
      s = new VolumeSoftBody(cage);
    await s.accelerate(bytes);
    const sensor = new BodyPosture(s.rest, s.mass),
      skin = new FloorSurface(cage, body.getAttribute('position').array),
      gait = new GaitMotor(s);
    let airborne = 0,
      steps = 0,
      stopX = 0;
    for (let k = 0; k < 1680; k++) {
      s.advance(1 / 240, (dt) => {
        s.setFloorLevel(skin.level(s.x));
        const p = sensor.sample(s.x, s.velocity);
        const grounded = p.minY - s.floorLevel < 0.025;
        if (!grounded) airborne++;
        const before = s.x.slice();
        gait.step(p, grounded, [sign, 0, 0], k < 960 ? 1.05 : 0, dt);
        assert.deepEqual(s.x, before);
      });
      if (k === 959) stopX = sensor.sample(s.x, s.velocity).center[0];
    }
    steps = gait.stats().steps;
    const p = sensor.sample(s.x, s.velocity);
    assert.ok(sign * stopX > 1.6, `travel ${stopX}`);
    assert.ok(
      Math.abs(p.center[0] - stopX) < 0.65,
      `braking ${p.center[0] - stopX}`,
    );
    assert.ok(airborne > 10 && steps >= 3, JSON.stringify({ airborne, steps }));
    assert.ok(s.stats().minJacobian > 0.5);
    assert.ok(p.up[1] > 0.9);
    console.log('gait', { sign, stopX, end: p.center[0], airborne, steps });
  }
});
