import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Mesh, PerspectiveCamera } from 'three/webgpu';
import { VolumeInteraction } from '../lib/softbody/interaction.ts';
import { BodyPosture } from '../lib/softbody/posture.ts';
import { characterFixture } from './softbody-fixture.mjs';
const bytes = readFileSync(
  new URL('../public/physics/volume.wasm', import.meta.url),
);
function fixture() {
  const { body, geometry, profile, bubbles } = characterFixture(),
    mesh = new Mesh(body);
  mesh.userData.optical_profile = JSON.stringify(profile);
  mesh.updateMatrixWorld();
  const camera = new PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, 2.1, 8);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const canvas = {
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    setPointerCapture() {},
    hasPointerCapture: () => false,
    releasePointerCapture() {},
  };
  const parts = ['Eye.L', 'Eye.R', 'Smile'].map((name) => {
    const m = new Mesh(geometry(name));
    m.name = name;
    return m;
  });

  const v = new VolumeInteraction(
    canvas,
    camera,
    mesh,
    [mesh, ...parts],
    bubbles,
  );
  v.setExpression({ responsive: true });
  v.setTuning({ stiffness: 32.7, damping: 64.2, jump: 100, bounce: 0 });
  return v;
}
// Without an intake owner, observing candy never drives a jump or approach.
for (const [x, z] of [
  [4, 0],
  [-4, 1],
  [0, -4],
])
  test(
    'candy inspection without an intake never moves the body at ' + x + ',' + z,
    async () => {
      const v = fixture();
      await v.solver.accelerate(bytes);
      const candy = {
        id: 1,
        x,
        y: 0.2,
        z,
        vx: 0,
        vy: 0,
        vz: 0,
        radius: 0.2,
        mode: 'free',
      };
      v.setCandies([candy]);
      for (let n = 0; n < 1200; n++) {
        v.update(1 / 60);
        const state = v.characterState();
        assert.notEqual(state.phase, 'collecting');
        assert.ok(!['seeking', 'collecting'].includes(state.phase));
        assert.equal(v.motor.gait.stats().steps, 0, 'no food-driven hops');
      }
      const sensor = new BodyPosture(v.solver.rest, v.solver.mass);
      const pose = sensor.sample(v.solver.x, v.solver.velocity);
      assert.ok(
        Math.hypot(pose.center[0], pose.center[2]) < 0.25,
        'stays near rest',
      );
      assert.equal(candy.mode, 'free');
      assert.equal(candy.x, x);
      assert.equal(candy.z, z);
    },
  );
