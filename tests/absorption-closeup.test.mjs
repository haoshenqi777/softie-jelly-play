import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { characterFixture } from './softbody-fixture.mjs';
import { SlimeOptics } from '../lib/slime-optics.ts';
import { StudioAbsorption } from '../lib/studio-absorption.ts';
import { AbsorptionInterior } from '../lib/absorption-interior.ts';
import {
  AbsorptionTimeline,
  absorptionFrame,
  deformAbsorptionPoint,
} from '../lib/absorption-motion.ts';
import { AbsorptionField } from '../lib/absorption-field.ts';

test('actual sample meshes preserve the face and candy normals, enclose the full candy, and restore after seeking', () => {
  const fixture = characterFixture();
  const body = new THREE.Mesh(
    fixture.body,
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  const eye = new THREE.Mesh(fixture.geometry('Eye.L'));
  const face = new Float32Array(eye.geometry.attributes.position.array);
  const original = new Float32Array(body.geometry.attributes.position.array);
  const scene = new THREE.Scene();
  scene.add(body, eye);
  const optics = new SlimeOptics(body, scene);
  const interior = new AbsorptionInterior();
  const sample = new StudioAbsorption(
    body,
    [body, eye],
    scene,
    optics,
    new THREE.Texture(),
    new AbsorptionField(),
    interior,
  );
  const candy = scene.getObjectByName('MintCandy.Exterior');
  const inner = interior.root.getObjectByName('MintCandy.Interior');
  assert.equal(
    candy.geometry,
    inner.geometry,
    'entry uses one shared candy geometry',
  );
  assert.ok(
    candy.geometry.index,
    'erosion normals are smoothed across shared vertices',
  );
  const normals = new Float32Array(candy.geometry.attributes.normal.array);
  sample.timeline.configure({ time: 1.65 });
  sample.update(0);
  assert.deepEqual(
    eye.geometry.attributes.position.array,
    face,
    'lower belly wrapping must not twist the eye',
  );
  assert.deepEqual(
    candy.geometry.attributes.normal.array,
    normals,
    'intact candy retains its smooth normals',
  );
  sample.timeline.configure({ time: 3.8 });
  sample.update(0);
  scene.updateMatrixWorld(true);
  candy.geometry.computeBoundingBox();
  const box = candy.geometry.boundingBox;
  const cast = new THREE.Raycaster();
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).applyMatrix4(candy.matrixWorld);
        for (const sign of [-1, 1]) {
          cast.set(p, new THREE.Vector3(0, 0, sign));
          const hits = cast.intersectObject(body);
          assert.ok(
            hits.length && hits[0].distance > 0.15,
            'entire candy has gel on both sides during hold',
          );
        }
      }
  sample.timeline.configure({ time: 12 });
  sample.update(0);
  assert.equal(candy.visible, false);
  sample.timeline.configure({ time: 0 });
  sample.update(0);
  assert.equal(candy.visible, true);
  assert.deepEqual(body.geometry.attributes.position.array, original);
  assert.deepEqual(candy.geometry.attributes.normal.array, normals);
  sample.dispose();
  optics.dispose();
  interior.dispose();
});

test('pigment starts at the internal candy, expands in body coordinates and settles uniformly', () => {
  const field = new AbsorptionField();
  field.update(absorptionFrame(0));
  assert.equal(field.concentration([-0.52, 0.46, 0.66]), 0);
  field.update(absorptionFrame(6.7));
  assert.ok(field.concentration([-0.52, 0.46, 0.66]) > 0.7);
  assert.ok(field.concentration([1, 2, -0.8]) < 0.05);
  field.update(absorptionFrame(12));
  for (const p of [
    [-0.52, 0.46, 0.66],
    [1, 2, -0.8],
    [0, 0, 1.2],
  ])
    assert.equal(field.concentration(p), 1);
  field.update(absorptionFrame(0));
  assert.equal(field.concentration([-0.52, 0.46, 0.66]), 0);
});

test('candy stays intact through enclosure and only dissolves after its interior hold', () => {
  for (const t of [0, 1, 2, 3, 4]) {
    const f = absorptionFrame(t);
    assert.equal(f.dissolve, 0);
    assert.equal(f.dye, 0);
  }
  const inside = absorptionFrame(4);
  assert.ok(inside.candy[2] < 0.8 && inside.candy[1] > 0.35);
  const middle = absorptionFrame(7);
  assert.ok(middle.dissolve > 0 && middle.dissolve < 1);
  assert.ok(middle.dye > 0 && middle.dye < 1);
  assert.equal(absorptionFrame(12).dissolve, 1);
  assert.equal(absorptionFrame(12).dye, 1);
});

test('pause, slow playback, restart and malformed input do not leak time or produce nonfinite positions', () => {
  const clock = new AbsorptionTimeline();
  clock.configure({ time: 2, playing: false });
  clock.update(0.1);
  assert.equal(clock.frame.time, 2);
  clock.configure({ playing: true, speed: 0.25 });
  clock.update(0.1);
  assert.ok(Math.abs(clock.frame.time - 2.025) < 1e-9);
  clock.configure({ time: 99 });
  assert.equal(clock.frame.time, 12);
  clock.configure({ time: 0 });
  assert.deepEqual(clock.frame, absorptionFrame(0));
  for (const n of [NaN, Infinity, -100]) {
    const f = absorptionFrame(n);
    assert.ok(
      [f.time, f.wrap, f.dissolve, f.dye, ...f.candy].every(Number.isFinite),
    );
  }
});

test('contact deformation is localized, returns to the exact approved mesh, and stays above the floor', () => {
  const b = readFileSync(
    new URL('../public/models/slime-studio.glb', import.meta.url),
  );
  const len = b.readUInt32LE(12);
  const gltf = JSON.parse(b.subarray(20, 20 + len));
  const node = gltf.nodes.find((n) => n.name === 'Gel');
  const a =
    gltf.accessors[gltf.meshes[node.mesh].primitives[0].attributes.POSITION];
  const v = gltf.bufferViews[a.bufferView];
  let contactDisplacement = 0;
  for (let i = 0; i < a.count; i++) {
    const p = [0, 1, 2].map((k) =>
      b.readFloatLE(
        28 +
          len +
          (v.byteOffset || 0) +
          (a.byteOffset || 0) +
          i * (v.byteStride || 12) +
          k * 4,
      ),
    );
    assert.deepEqual(deformAbsorptionPoint(p, absorptionFrame(0)), p);
    assert.deepEqual(deformAbsorptionPoint(p, absorptionFrame(12)), p);
    for (const t of [1, 1.8, 2.6, 3.4, 4.5, 7]) {
      const q = deformAbsorptionPoint(p, absorptionFrame(t));
      assert.ok(q.every(Number.isFinite));
      assert.ok(q[1] >= -1e-7);
      const d = Math.hypot(...q.map((x, k) => x - p[k]));
      assert.ok(d < 0.5, 'no silhouette-destroying spike');
      if (p[2] < -0.5) assert.ok(d < 0.035, 'far surface stays quiet');
      contactDisplacement = Math.max(contactDisplacement, d);
    }
  }
  assert.ok(
    contactDisplacement > 0.1,
    'contact visibly changes the actual mesh',
  );
});
