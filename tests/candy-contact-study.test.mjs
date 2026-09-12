import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { characterFixture } from './softbody-fixture.mjs';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';

const contactModule = await import('../lib/softbody/contact-shell.ts');
const make = (name, roll = 0, hz = 120) => {
  assert.equal(
    typeof contactModule.ContactShell,
    'function',
    'contact-driven surface solver exists',
  );
  const f = characterFixture();
  const body = new THREE.Mesh(
    f.body,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  const ray = new THREE.Raycaster();
  const origins = {
    front: [-0.6, 1.2, 5],
    side: [5, 1.2, 0],
    crown: [0, 5, 0],
  };
  const dirs = { front: [0, 0, -1], side: [-1, 0, 0], crown: [0, -1, 0] };
  ray.set(
    new THREE.Vector3(...origins[name]),
    new THREE.Vector3(...dirs[name]),
  );
  body.updateMatrixWorld();
  const hit = ray.intersectObject(body)[0];
  const normal = hit.normal.clone().normalize();
  const shell = new contactModule.ContactShell(
    f.cage,
    f.body.attributes.position.array,
    f.body.attributes.normal.array,
    f.body.index.array,
  );
  shell.setRegion(hit.point.toArray());
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    normal,
  );
  q.multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll),
  );
  shell.candy.rotation.set(q.toArray());
  const outside = hit.point.clone().addScaledVector(normal, 0.29).toArray();
  shell.candy.position.set(outside);
  shell.candy.target.set(outside);
  const solver = new VolumeSoftBody(f.cage, {
    gravity: 0,
    shear: 240,
    bulk: 12000,
    damping: 12,
  });
  const tick = (seconds) => {
    for (let t = 0; t < Math.round(seconds * hz); t++) {
      shell.beginStep(1 / hz, solver);
      solver.step(1 / hz, (dt, it) => shell.project(dt, solver, it));
      shell.endStep(1 / hz);
    }
  };
  return { f, shell, solver, tick, hit, normal, outside };
};

for (const location of ['front', 'side', 'crown'])
  test(`${location}: real cube contact produces a local dent and withdrawal recovers`, () => {
    const { shell, solver, tick, hit, normal, outside } = make(location);
    tick(0.2);
    assert.ok(
      Math.max(...shell.displacement.map(Math.abs)) < 1e-6,
      'untouched approved surface stays at rest',
    );
    shell.candy.target.set(
      hit.point.clone().addScaledVector(normal, -0.035).toArray(),
    );
    tick(0.8);
    const s = shell.stats();
    assert.ok(s.contacts > 0, 'contact is measured, not scheduled');
    assert.ok(s.maxIndent > 0.055, `visible concavity: ${s.maxIndent}`);
    assert.ok(s.maxOutward < s.maxIndent * 0.3, 'no protruding collar');
    assert.ok(s.maxIndent < 0.4, 'bounded depression');
    assert.ok(solver.stats().minJacobian > 0.2, 'coarse body remains valid');
    assert.ok(s.reaction > 0, 'candy receives the skin reaction');
    shell.candy.target.set(outside);
    tick(2);
    assert.ok(
      shell.stats().maxIndent < 0.008,
      'withdrawal restores local skin',
    );
  });

test('rotated cube changes the contact footprint; aggressive retarget remains finite', () => {
  const a = make('front'),
    b = make('front', Math.PI / 4);
  for (const m of [a, b]) {
    m.shell.candy.target.set(
      m.hit.point.clone().addScaledVector(m.normal, -0.015).toArray(),
    );
    m.tick(0.6);
  }
  let difference = 0;
  for (let i = 0; i < a.shell.displacement.length; i++)
    difference += Math.abs(a.shell.displacement[i] - b.shell.displacement[i]);
  assert.ok(
    difference > 0.2,
    'box orientation affects actual pressure footprint',
  );
  for (let i = 0; i < 20; i++) {
    a.shell.candy.target.set(
      i % 2
        ? a.outside
        : a.hit.point.clone().addScaledVector(a.normal, -0.035).toArray(),
    );
    a.tick(0.025);
  }
  assert.ok(a.shell.displacement.every(Number.isFinite));
  assert.ok(a.solver.x.every(Number.isFinite));
  a.shell.candy.target.set(a.outside);
  a.tick(2);
  assert.ok(
    a.shell.stats().maxIndent < 0.012,
    'rapid input leaves no stuck dent',
  );
});

test('retargeting retains the previous dent until its own recovery finishes', () => {
  const a = make('front'),
    next = make('crown');
  a.shell.candy.target.set(
    a.hit.point.clone().addScaledVector(a.normal, -0.015).toArray(),
  );
  a.tick(0.6);
  const before = a.shell.displacement.slice();
  a.shell.setRegion(next.hit.point.toArray());
  assert.deepEqual(
    a.shell.displacement,
    before,
    'selecting a new point cannot pop the old surface',
  );
  a.shell.candy.position.set(next.outside);
  a.shell.candy.target.set(next.outside);
  a.shell.candy.velocity.fill(0);
  a.shell.candy.rotation.set(next.shell.candy.rotation);
  a.tick(2);
  assert.ok(
    a.shell.stats().maxIndent < 0.008,
    'inactive previous region keeps relaxing',
  );
  assert.ok(
    a.shell.stats().activeNodes < a.shell.stats().fineNodes / 2,
    'local solve stays local',
  );
});

test('contact hook produces matching coupled motion in WASM and JavaScript', async () => {
  const a = make('front'),
    b = make('front');
  await b.solver.accelerate(
    readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
  );
  for (const m of [a, b]) {
    m.shell.candy.target.set(
      m.hit.point.clone().addScaledVector(m.normal, -0.015).toArray(),
    );
    m.tick(0.4);
    m.shell.candy.target.set(m.outside);
    m.tick(0.4);
  }
  for (const key of ['displacement', 'velocity']) {
    const error = Math.max(
      ...a.shell[key].map((v, i) => Math.abs(v - b.shell[key][i])),
    );
    assert.ok(error < 0.00001, `${key} backend agreement: ${error}`);
  }
  assert.ok(
    Math.max(...a.solver.x.map((v, i) => Math.abs(v - b.solver.x[i]))) <
      0.00001,
  );
});
