import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { CandyRenderer } from '../lib/candy-renderer.ts';
import { CandyWorld } from '../lib/candy-physics.ts';
import { ContactCandy } from '../lib/contact-candy.ts';
import { AbsorptionInterior } from '../lib/absorption-interior.ts';
import { candyDetailTexture } from '../lib/hard-candy-material.ts';

for (const kind of ['cube', 'round']) {
  test(`${kind} has solid sugar detail and retains that surface inside gel`, () => {
    const scene = new THREE.Scene(),
      world = new CandyWorld();
    const renderer = new CandyRenderer(scene),
      capture = new AbsorptionInterior();
    scene.environmentIntensity = 0.8;
    const c = world.spawn(
      '#92a9ee',
      kind,
      { x: 0, y: 1, z: 0 },
      undefined,
      0.18,
    );
    renderer.update(world.candies);
    const source = renderer.mesh(c.id);
    const visual = new ContactCandy(
      scene,
      new THREE.Texture(),
      { front: uniform(1), back: uniform(4) },
      capture,
      {
        geometry: source.geometry,
        half: 0.18,
        hex: c.hex,
        round: kind === 'round',
        rigid: true,
        scale: 0.18 / 0.085,
        material: source.material,
      },
    );
    try {
      assert.equal(
        source.material.transmission,
        0,
        'solid sugar, not a glass bead',
      );
      assert.equal(
        source.material.transmissionNode,
        null,
        'node graph cannot override opaque sugar',
      );
      const inner = capture.root.children[0].material;
      const nodes = new Set();
      inner.colorNode.traverse((n) => nodes.add(n));
      assert.ok(
        nodes.has(source.material.colorNode),
        'exact same pigmented sugar pattern inside',
      );
      assert.equal(
        inner.opacityNode,
        null,
        'no instantaneous 16% alpha loss at the boundary',
      );
      assert.equal(inner.opacity, 1);
      assert.equal(
        inner.envMapIntensity,
        0.8,
        'same environment exposure on either side of the skin',
      );
      const geometry = visual.exterior.geometry;
      visual.update(0);
      const start = Float32Array.from(geometry.attributes.position.array);
      visual.update(0, 1, [1, 0, 0]);
      assert.deepEqual(
        geometry.attributes.position.array,
        start,
        'solid candy resists pressure',
      );
      visual.update(0.35);
      assert.equal(
        capture.root.children[0].geometry,
        geometry,
        'same eroding core in both passes',
      );
      assert.equal(
        capture.root.children[0].material,
        inner,
        'no compile/material swap at erosion',
      );
    } finally {
      visual.dispose();
      renderer.dispose();
      capture.dispose();
    }
  });
  test(`${kind} sugar coating has readable roughness and pigment variation`, () => {
    const texture = candyDetailTexture(kind),
      data = texture.image.data;
    let low = 255,
      high = 0,
      rough = 0;
    for (let i = 0; i < data.length; i += 4) {
      low = Math.min(low, data[i + 2]);
      high = Math.max(high, data[i + 2]);
      rough += data[i + 1];
    }
    assert.ok(
      high - low > 80,
      'grain visible in diffuse shading as well as specular',
    );
    assert.ok(
      rough / (data.length / 4) / 255 > 0.32,
      'sugar coating is not polished glass',
    );
    texture.dispose();
  });
}
