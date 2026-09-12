import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { BodyIntake } from '../lib/softbody/body-intake.ts';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { characterFixture } from './softbody-fixture.mjs';
test('contact integrates at 120Hz while the volume takes 240Hz substeps', () => {
  const f = characterFixture(),
    s = new VolumeSoftBody(f.cage),
    intake = new BodyIntake(f.cage, s, new THREE.Mesh(f.body));
  intake.pending = true;
  let count = 0,
    time = 0;
  const begin = intake.shell.beginStep.bind(intake.shell);
  intake.shell.beginStep = (dt, solver) => {
    count++;
    time += dt;
    begin(dt, solver);
  };
  // Keep the pending contact alive without coupling this scheduling test to feeding.
  intake.candy = { mode: 'held', radius: 0.18 };
  intake.manual = true;
  for (let i = 0; i < 4; i++) {
    intake.beginStep(1 / 240);
    intake.endStep(1 / 240);
  }
  assert.equal(count, 2);
  assert.ok(
    Math.abs(time - 1 / 60) < 1e-10,
    'contact clock must preserve elapsed simulation time',
  );
});
