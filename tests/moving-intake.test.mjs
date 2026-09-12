import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { characterFixture } from './softbody-fixture.mjs';
import { createCage } from '../lib/softbody/cage.ts';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';
import { ContactShell } from '../lib/softbody/contact-shell.ts';
import { CandyWorld } from '../lib/candy-physics.ts';
import { EmbeddedSurface } from '../lib/softbody/surface.ts';
import { readFileSync } from 'node:fs';
import { MaterialAnchor } from '../lib/softbody/material-anchor.ts';
import { BodyIntake } from '../lib/softbody/body-intake.ts';

test('material attachment follows translation, rotation and an inward material point', () => {
  assert.equal(typeof MaterialAnchor, 'function');
  const f = characterFixture(),
    cage = createCage(f.profile, f.body.attributes.position.array);
  const p = new THREE.Vector3(0, 1.1, 0.9),
    n = new THREE.Vector3(0, 0, 1);
  const a = new MaterialAnchor(cage, p, n),
    original = a.sample(cage.positions);
  const transform = new THREE.Matrix4()
    .makeRotationY(1.2)
    .setPosition(2, 0.4, -1);
  const nodes = Float64Array.from(cage.positions);
  const v = new THREE.Vector3();
  for (let i = 0; i < nodes.length; i += 3)
    v.fromArray(nodes, i).applyMatrix4(transform).toArray(nodes, i);
  const moved = a.sample(nodes);
  assert.ok(
    moved.point.distanceTo(original.point.clone().applyMatrix4(transform)) <
      1e-5,
  );
  assert.ok(
    moved.normal.distanceTo(
      original.normal.clone().transformDirection(transform),
    ) < 1e-5,
  );
});

test('a captured candy follows rotation while wrapping and translation after entry', async () => {
  assert.equal(typeof BodyIntake, 'function');
  const f = characterFixture(),
    cage = createCage(f.profile, f.body.attributes.position.array),
    solver = new VolumeSoftBody(cage);
  await solver.accelerate(
    readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
  );
  const mesh = new THREE.Mesh(f.body),
    skin = new EmbeddedSurface(f.body, cage),
    intake = new BodyIntake(cage, solver, mesh);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 1.1, 5),
    new THREE.Vector3(0, 0, -1),
  );
  mesh.updateMatrixWorld();
  const hit = ray.intersectObject(mesh)[0],
    world = new CandyWorld();
  const candy = world.spawn(
    '#8de6c2',
    'gummy',
    hit.point.clone().addScaledVector(hit.normal, 0.085),
  );
  assert.ok(intake.begin(candy, hit.point, hit.normal));
  assert.equal(candy.mode, 'merging');
  let seenInside = false,
    moved = false,
    rotated = false;
  for (let i = 0; i < 1300; i++) {
    intake.prepare();
    solver.advance(1 / 60, undefined, intake);
    skin.update(solver.x, solver.nodalTransforms());
    intake.applySurface();
    const frame = intake.frame();
    if (frame.stage === 'wrapping' && frame.wrap > 0.75 && !rotated) {
      const turn = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          0.65,
        ),
        delta = new THREE.Vector3(0.7, 0, -0.35),
        v = new THREE.Vector3();
      const expected = new THREE.Vector3(candy.x, candy.y, candy.z)
        .applyQuaternion(turn)
        .add(delta);
      for (let j = 0; j < solver.x.length; j += 3) {
        v.fromArray(solver.x, j)
          .applyQuaternion(turn)
          .add(delta)
          .toArray(solver.x, j);
        v.fromArray(solver.velocity, j)
          .applyQuaternion(turn)
          .toArray(solver.velocity, j);
      }
      intake.prepare();
      solver.advance(1 / 240, undefined, intake);
      assert.ok(
        new THREE.Vector3(candy.x, candy.y, candy.z).distanceTo(expected) <
          0.035,
        'wet candy follows the material patch without a world-space tether',
      );
      rotated = true;
    }
    if (frame.stage === 'inside' && !moved) {
      seenInside = true;
      const previous = candy.x;
      for (let j = 0; j < solver.x.length; j += 3) solver.x[j] += 1.4;
      intake.prepare();
      solver.advance(1 / 240, undefined, intake);
      assert.ok(
        Math.abs(candy.x - previous - 1.4) < 0.03,
        'core stays in its material location',
      );
      moved = true;
    }
    if (frame.dissolve > 0) assert.ok(intake.shell.stats().maxIndent < 0.035);
    if (frame.stage === 'done') break;
  }
  assert.ok(seenInside);
  assert.ok(rotated, 'rotation exercised the still-wrapping skin');
  assert.equal(intake.frame().stage, 'done');
  assert.equal(candy.melt, 1);
  intake.reset();
  assert.equal(intake.frame().stage, 'idle');
});

test('game contact shell does not pull a translated body toward the studio origin', () => {
  const f = characterFixture(),
    cage = createCage(f.profile, f.body.attributes.position.array),
    s = new VolumeSoftBody(cage, { gravity: 0 });
  for (let i = 0; i < s.x.length; i += 3) s.x[i] += 3;
  const shell = new ContactShell(
    cage,
    f.body.attributes.position.array,
    f.body.attributes.normal.array,
    f.body.index.array,
    { supported: false },
  );
  shell.candy.position.set([10, 10, 10]);
  shell.candy.target.set([10, 10, 10]);
  shell.beginStep(1 / 240, s);
  assert.ok(
    s.velocity.every((v) => Math.abs(v) < 1e-12),
    'no hidden rest-position tether in gameplay',
  );
});

test('capture is a real free-candy contact and never consumes a held treat', () => {
  const world = new CandyWorld();
  let hits = 0;
  const c = world.spawn('#8de6c2', 'gummy', { x: 0, y: 1, z: 0 });
  const collider = {
    x: 0,
    y: 0,
    z: 0,
    mouth: { x: 0, y: 0, z: 0 },
    edibleId: null,
    contact: (p) => ({
      position: { ...p, x: 0.1 },
      normal: { x: 1, y: 0, z: 0 },
    }),
    capture: (c) => {
      hits++;
      c.mode = 'merging';
      return true;
    },
  };
  world.grab(c.id);
  world.advance(1 / 60, collider);
  assert.equal(hits, 0);
  world.release();
  world.advance(1 / 60, collider);
  assert.equal(hits, 1);
  assert.equal(c.mode, 'merging');
  world.advance(0.2, collider);
  assert.equal(hits, 1);
});
