import test from 'node:test';
import assert from 'node:assert/strict';
import { characterFixture } from './softbody-fixture.mjs';
import { updateDeformedSurface } from '../lib/softbody/deformed-surface.ts';

test('fast contact normals and bounds match Three on the full deformed approved body', () => {
  const { body } = characterFixture();
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const dent =
      0.13 *
      Math.exp(-((x - 0.9) ** 2 + (y - 1.1) ** 2 + (z - 0.6) ** 2) / 0.17);
    p.setXYZ(i, x - dent * 0.7, y * 0.92 - dent * 0.2, z - dent * 0.6);
  }
  const reference = body.clone();
  reference.computeVertexNormals();
  reference.computeBoundingBox();
  reference.computeBoundingSphere();
  updateDeformedSurface(body);
  const n = body.attributes.normal.array,
    expected = reference.attributes.normal.array;
  let max = 0;
  for (let i = 0; i < n.length; i++)
    max = Math.max(max, Math.abs(n[i] - expected[i]));
  assert.ok(max < 1e-6, `same surface lighting normals: ${max}`);
  assert.ok(body.boundingBox.min.distanceTo(reference.boundingBox.min) < 1e-9);
  assert.ok(body.boundingBox.max.distanceTo(reference.boundingBox.max) < 1e-9);
  assert.ok(
    body.boundingSphere.center.distanceTo(reference.boundingSphere.center) <
      1e-9,
  );
  assert.ok(
    Math.abs(body.boundingSphere.radius - reference.boundingSphere.radius) <
      1e-9,
  );
  body.dispose();
  reference.dispose();
});
