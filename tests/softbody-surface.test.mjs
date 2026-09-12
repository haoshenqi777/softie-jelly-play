import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddedSurface, AttachedFace } from '../lib/softbody/surface.ts';
import { characterFixture } from './softbody-fixture.mjs';
import { Float32BufferAttribute } from 'three/webgpu';

test('approved mesh is fully embedded, rest-exact and has positive mechanical tetrahedra', () => {
  const { cage, body, bubbles } = characterFixture();
  assert.ok(cage.positions.length / 3 < 1100);
  assert.ok(cage.tets.length / 4 < 5000);
  for (const p of bubbles.map((b) => b.p)) cage.bind(p);
  const surface = new EmbeddedSurface(body, cage),
    before = body.attributes.position.array.slice();
  const f = new Float64Array(cage.positions.length * 3);
  for (let i = 0; i < f.length; i += 9) f[i] = f[i + 4] = f[i + 8] = 1;
  surface.update(new Float64Array(cage.positions), f);
  assert.ok(
    before.every(
      (v, i) => Math.abs(v - body.attributes.position.array[i]) < 4e-7,
    ),
  );
  for (let i = 0; i < cage.tets.length; i += 4) {
    const p = cage.tets
      .slice(i, i + 4)
      .map((id) => cage.positions.slice(id * 3, id * 3 + 3));
    const [a, b, c] = p.slice(1).map((v) => v.map((x, k) => x - p[0][k]));
    const determinant =
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      b[0] * (a[1] * c[2] - a[2] * c[1]) +
      c[0] * (a[1] * b[2] - a[2] * b[1]);
    assert.ok(determinant > 0);
  }
});

test('surface and triangle-attached face reproduce rest and a translated body', () => {
  const { cage, body, geometry } = characterFixture();
  const eye = geometry('Eye.L'),
    original = eye.attributes.position.array.slice();
  const face = new AttachedFace(eye, body),
    surface = new EmbeddedSurface(body, cage);
  face.update();
  assert.ok(
    original.every(
      (v, i) => Math.abs(v - eye.attributes.position.array[i]) < 1e-6,
    ),
  );
  const nodes = new Float64Array(cage.positions),
    f = new Float64Array(nodes.length * 3);
  for (let i = 0; i < f.length; i += 9) f[i] = f[i + 4] = f[i + 8] = 1;
  for (let i = 0; i < nodes.length; i += 3) {
    nodes[i] += 0.4;
    nodes[i + 1] += 0.8;
  }
  surface.update(nodes, f);
  face.update();
  assert.ok(
    original.every(
      (v, i) =>
        Math.abs(v + [0.4, 0.8, 0][i % 3] - eye.attributes.position.array[i]) <
        2e-6,
    ),
  );
});

test('unused preset morphs cannot enlarge mechanical contact bounds', () => {
  const { cage, body } = characterFixture();
  const delta = new Float32Array(body.attributes.position.array.length);
  for (let i = 1; i < delta.length; i += 3) delta[i] = -2;
  body.morphAttributes.position = [new Float32BufferAttribute(delta, 3)];
  body.morphTargetsRelative = true;
  const surface = new EmbeddedSurface(body, cage);
  const f = new Float64Array(cage.positions.length * 3);
  for (let i = 0; i < f.length; i += 9) f[i] = f[i + 4] = f[i + 8] = 1;
  surface.update(new Float64Array(cage.positions), f);
  assert.ok(body.boundingBox.min.y > -1e-6);
  assert.ok(body.boundingBox.max.y < 2.32);
});
