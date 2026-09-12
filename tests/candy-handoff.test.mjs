import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { CandyWorld } from '../lib/candy-physics.ts';
import { CandyRenderer } from '../lib/candy-renderer.ts';
import { ContactCandy } from '../lib/contact-candy.ts';
import {
  candyCompressionMatrix,
  inverseCandyCompression,
} from '../lib/candy-deformation.ts';
for (const radius of [0.085, 0.18])
  test(
    'compressed rotated gummy retains its visible shape at absorption handoff, radius ' +
      radius,
    () => {
      const scene = new THREE.Scene(),
        world = new CandyWorld(),
        renderer = new CandyRenderer(scene);
      const c = world.spawn(
        '#8de6c2',
        'gummy',
        { x: 1, y: radius, z: 1 },
        undefined,
        radius,
      );
      c.compression = 0.32;
      c.compressionAxis = [0.6, 0, 0.8];
      renderer.update(world.candies);
      const source = renderer.mesh(c.id),
        before = new THREE.Box3().setFromObject(source);
      const intake = new ContactCandy(
        scene,
        new THREE.Texture(),
        undefined,
        undefined,
        {
          geometry: source.geometry,
          half: c.radius,
          hex: c.hex,
          scale: c.radius / 0.085,
          material: source.material,
        },
      );
      intake.exterior.position.setFromMatrixPosition(source.matrix);
      intake.exterior.rotation.copy(source.rotation);
      intake.update(0, c.compression, c.compressionAxis);
      const after = new THREE.Box3().setFromObject(intake.exterior);
      for (const key of [
        'roughness',
        'transmission',
        'ior',
        'clearcoat',
        'clearcoatRoughness',
        'transparent',
        'depthWrite',
      ])
        assert.equal(
          intake.exterior.material[key],
          source.material[key],
          key + ' is continuous at contact',
        );
      assert.ok(intake.exterior.material.color.equals(source.material.color));
      assert.equal(
        intake.exterior.geometry.attributes.position.count,
        source.geometry.attributes.position.count,
        'contact keeps the same authored vertex layout',
      );
      assert.ok(
        before.min.distanceTo(after.min) < 1e-6,
        'same compressed lower boundary',
      );
      assert.ok(
        before.max.distanceTo(after.max) < 1e-6,
        'same compressed upper boundary',
      );
      intake.dispose();
      renderer.dispose();
    },
  );

test('gummy squash shortens the contact direction and shares the exact inverse with collision', () => {
  const axis = [0.6, 0, 0.8],
    matrix = candyCompressionMatrix(new THREE.Matrix4(), 0.2, axis);
  const load = new THREE.Vector3(...axis).applyMatrix4(matrix);
  assert.ok(Math.abs(load.length() - 0.8) < 1e-10);
  assert.ok(
    Math.abs(matrix.determinant() - 1) < 1e-10,
    'squash preserves volume',
  );
  const point = new THREE.Vector3(0.21, -0.05, 0.17),
    visual = point.clone().applyMatrix4(matrix),
    out = new Float64Array(3);
  inverseCandyCompression(visual.x, visual.y, visual.z, 0.2, axis, out);
  assert.ok(point.distanceTo(new THREE.Vector3().fromArray(out)) < 1e-10);
});

test('hard candy visible boundary matches the collision radius', () => {
  const scene = new THREE.Scene(),
    world = new CandyWorld(),
    renderer = new CandyRenderer(scene);
  const c = world.spawn(
    '#abc',
    'hard',
    { x: 0, y: 0.18, z: 0 },
    undefined,
    0.18,
  );
  renderer.update(world.candies);
  const mesh = renderer.mesh(c.id),
    p = mesh.geometry.attributes.position;
  let radius = 0;
  for (let i = 0; i < p.count; i++)
    radius = Math.max(
      radius,
      Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) * mesh.scale.x,
    );
  assert.ok(Math.abs(radius - c.radius) < 1e-6);
  renderer.dispose();
});
