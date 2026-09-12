import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { characterFixture } from './softbody-fixture.mjs';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { BodyPosture } from '../lib/softbody/posture.ts';
import { FloorSurface } from '../lib/softbody/floor-surface.ts';
import { CharacterMotor } from '../lib/softbody/character-motor.ts';
const bytes = readFileSync(
  new URL('../public/physics/volume.wasm', import.meta.url),
);
async function fixture() {
  const { cage, body } = characterFixture(),
    s = new VolumeSoftBody(cage);
  await s.accelerate(bytes);
  return {
    s,
    m: new CharacterMotor(s),
    p: new BodyPosture(s.rest, s.mass),
    floor: new FloorSurface(cage, body.attributes.position.array),
  };
}
const intent = {
  phase: 'idle',
  candy: null,
  destination: null,
  facing: [0, 0, 1],
  mood: 0,
  social: 'none',
  socialAge: 0,
  comfort: 0,
  joy: 0,
  gait: 'hop',
  desiredSpeed: 0,
  body: 'quiet',
};
function observe(p, s, time) {
  return {
    time,
    center: p.center,
    velocity: [0, p.verticalSpeed, 0],
    up: p.up,
    forward: p.forward,
    grounded: p.minY - s.floorLevel < 0.025 && p.verticalSpeed < 0.5,
    held: false,
    stable: true,
    width: 3.2325,
    height: 2.35,
    impactSpeed: 0,
    rendezvous: [0, 0, 0],
    viewerDirection: [0, 0, 1],
    cameraMoving: false,
  };
}
test('idle breath moves the soft body subtly, preserves rest shape and can be disabled', async (t) => {
  const { s, m, p, floor } = await fixture();
  assert.equal(typeof m.setBreathing, 'function');
  m.setBreathing(true);
  const rest = s.rest.slice();
  let low = Infinity,
    high = -Infinity;
  for (let k = 0; k < 2400; k++)
    s.advance(1 / 240, (dt) => {
      s.setFloorLevel(floor.level(s.x));
      const pose = p.sample(s.x, s.velocity);
      m.step(observe(pose, s, k / 240), intent, dt);
      if (k > 960) {
        let h = -Infinity;
        for (let i = 1; i < s.x.length; i += 3) h = Math.max(h, s.x[i]);
        low = Math.min(low, h);
        high = Math.max(high, h);
      }
    });
  t.diagnostic(JSON.stringify({ breathRange: high - low }));
  assert.ok(high - low > 0.003 && high - low < 0.06);
  assert.deepEqual(s.rest, rest);
  assert.ok(s.stats().minJacobian > 0.6);
  m.setBreathing(false);
  assert.equal(m.breathStats().enabled, false);
});
test('orientation takes off before yawing, faces the viewer in flight and lands before completing', async (t) => {
  const { s, m, p, floor } = await fixture();
  assert.ok(m.turnHop, 'air turn motor');
  let maxClearance = 0,
    maxAirHeading = -1,
    groundYaw = 0,
    landed = false;
  const phases = new Set();
  for (let k = 0; k < 1100; k++)
    s.advance(1 / 240, (dt) => {
      s.setFloorLevel(floor.level(s.x));
      const pose = p.sample(s.x, s.velocity),
        o = observe(pose, s, k / 240);
      const phase = m.turnHop.stats().phase;
      phases.add(phase);
      if (phase === 'gather')
        groundYaw = Math.max(groundYaw, Math.abs(pose.forward[0]));
      if (phase === 'flight') {
        maxClearance = Math.max(maxClearance, pose.minY - s.floorLevel);
        if (!o.grounded)
          maxAirHeading = Math.max(maxAirHeading, -pose.forward[2]);
      }
      if (phase === 'done') landed ||= o.grounded;
      m.step(
        o,
        { ...intent, phase: 'orient', body: 'puff', facing: [0, 0, -1] },
        dt,
      );
    });
  t.diagnostic(
    JSON.stringify({
      maxClearance,
      maxAirHeading,
      groundYaw,
      phases: [...phases],
    }),
  );
  assert.ok(maxClearance > 0.3);
  assert.ok(maxAirHeading > 0.94);
  assert.ok(groundYaw < 0.08);
  assert.ok(landed);
  m.interrupt();
  assert.equal(m.turnHop.stats().phase, 'idle');
});
