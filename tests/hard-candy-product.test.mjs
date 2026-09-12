import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { CandyWorld, candyBevel } from '../lib/candy-physics.ts';
import { CandyRenderer } from '../lib/candy-renderer.ts';
import { ContactCandy } from '../lib/contact-candy.ts';
import * as pigments from '../lib/studio-pigment.ts';
import { AbsorptionField } from '../lib/absorption-field.ts';
import { AbsorptionInterior } from '../lib/absorption-interior.ts';
import { uniform } from 'three/tsl';
import { digestionAt } from '../lib/candy-digestion.ts';

function volume(g) {
  const p = g.attributes.position,
    index = g.index;
  let v = 0;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(p, index.getX(i));
    b.fromBufferAttribute(p, index.getX(i + 1));
    c.fromBufferAttribute(p, index.getX(i + 2));
    v += a.dot(b.cross(c)) / 6;
  }
  return Math.abs(v);
}

test('product offers the selected eight colors and preserves saved legacy colors', () => {
  assert.deepEqual(
    pigments.PLAY_PIGMENTS?.map((p) => p.id),
    [
      'rose',
      'peach',
      'mint',
      'sky',
      'lychee',
      'whitegrape',
      'pomegranate',
      'tea',
    ],
  );
  for (const p of pigments.PLAY_PIGMENTS) {
    const field = new AbsorptionField();
    field.select(p.id);
    const saved = field.freeze();
    field.select('rose');
    field.restore(saved);
    assert.equal(field.state.base, p.id);
    const layer = new pigments.PigmentLayer();
    layer.configureShade(p.id);
    assert.ok(layer.shadeAbsorption.value.toArray().every(Number.isFinite));
  }
  for (const id of ['honey', 'lemon', 'grape', 'strawberry'])
    assert.equal(pigments.validPigment(id), id);
});

for (const kind of ['cube', 'round']) {
  test(
    kind + ' visibly retains half its volume when half the sugar is released',
    () => {
      const scene = new THREE.Scene(),
        world = new CandyWorld(),
        renderer = new CandyRenderer(scene);
      const c = world.spawn(
        '#92a9ee',
        kind,
        { x: 0, y: 1, z: 0 },
        undefined,
        0.18,
      );
      renderer.update(world.candies);
      const source = renderer.mesh(c.id),
        bevel = candyBevel(kind, 0.18);
      const visual = new ContactCandy(
        scene,
        new THREE.Texture(),
        undefined,
        undefined,
        {
          geometry: source.geometry,
          half: 0.18,
          hex: c.hex,
          round: kind === 'round',
          rigid: true,
          bevel,
          scale: 0.18 / 0.085,
          material: source.material,
        },
      );
      try {
        visual.update(0);
        const start = volume(visual.exterior.geometry);
        const f = digestionAt(4.5, kind === 'round' ? 'round' : { bevel });
        visual.update(f.dissolve);
        const ratio = volume(visual.exterior.geometry) / start;
        assert.ok(
          Math.abs(ratio - 0.5) < 0.06,
          `actual remaining volume ${ratio} should match half the sugar`,
        );
      } finally {
        visual.dispose();
        renderer.dispose();
      }
    },
  );
  test(
    kind +
      ' internal color contains the same opaque pigmented sugar surface as its exterior',
    () => {
      const scene = new THREE.Scene(),
        world = new CandyWorld(),
        renderer = new CandyRenderer(scene);
      const c = world.spawn(
        '#92a9ee',
        kind,
        { x: 0, y: 1, z: 0 },
        undefined,
        0.18,
      );
      renderer.update(world.candies);
      const source = renderer.mesh(c.id),
        capture = new AbsorptionInterior();
      const optics = { front: uniform(1), back: uniform(4) };
      const visual = new ContactCandy(
        scene,
        new THREE.Texture(),
        optics,
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
        const inner = capture.root.children.find(
          (p) => p.name === 'ContactStudy.InternalCandy',
        );
        const nodes = new Set();
        inner.material.colorNode.traverse((n) => nodes.add(n));
        assert.ok(
          [...nodes].some(
            (n) =>
              n.value?.isColor &&
              n.value.equals(source.material.attenuationColor),
          ),
          'blue sugar pigment must not be replaced with white',
        );
        assert.ok(
          nodes.has(source.material.colorNode),
          'buried opaque sugar retains exactly the same grain albedo',
        );
      } finally {
        visual.dispose();
        renderer.dispose();
        capture.dispose();
      }
    },
  );
  test(
    kind +
      ' stays rigid through landing and hand contact and settles above its actual mesh',
    () => {
      const scene = new THREE.Scene(),
        world = new CandyWorld(),
        renderer = new CandyRenderer(scene);
      const c = world.spawn(
        '#efa880',
        kind,
        { x: 0, y: 1.3, z: 1 },
        { x: 0.2, y: 0, z: 0.1 },
        0.18,
      );
      try {
        for (let i = 0; i < 960; i++) {
          world.advance(1 / 120);
          assert.equal(c.compression, 0);
          renderer.update(world.candies);
          assert.ok(
            new THREE.Box3().setFromObject(renderer.mesh(c.id), true).min.y >=
              -0.001,
            'rotated hard candy must not intersect the floor',
          );
        }
        assert.equal(c.sleeping, true);
        world.grab(c.id);
        c.contactHeld = true;
        c.contactCompression = 0.2;
        for (let i = 0; i < 120; i++) world.advance(1 / 120);
        assert.equal(
          c.compression,
          0,
          'contact pressure cannot squash hard candy',
        );
      } finally {
        renderer.dispose();
      }
    },
  );
  test(
    kind +
      ' keeps textured shape and all material maps through the first absorption frame',
    () => {
      const scene = new THREE.Scene(),
        world = new CandyWorld(),
        renderer = new CandyRenderer(scene);
      const c = world.spawn(
        '#abc9e9',
        kind,
        { x: 0, y: 1, z: 0 },
        undefined,
        0.18,
      );
      let intake;
      try {
        renderer.update(world.candies);
        const source = renderer.mesh(c.id);
        assert.ok(source.geometry.getAttribute('candyCoord'));
        assert.ok(source.material.normalNode, 'fine surface texture');
        assert.ok(
          source.material.roughnessNode,
          'roughness varies over sugar surface',
        );
        const before = new THREE.Box3().setFromObject(source);
        intake = new ContactCandy(
          scene,
          new THREE.Texture(),
          undefined,
          undefined,
          {
            geometry: source.geometry,
            half: 0.18,
            hex: c.hex,
            round: kind === 'round',
            rigid: true,
            bevel: candyBevel(kind, 0.18),
            scale: 0.18 / 0.085,
            material: source.material,
          },
        );
        intake.exterior.position.copy(source.position);
        intake.exterior.quaternion.copy(source.quaternion);
        intake.update(0, 0.25);
        const after = new THREE.Box3().setFromObject(intake.exterior);
        assert.ok(before.min.distanceTo(after.min) < 1e-6);
        assert.ok(before.max.distanceTo(after.max) < 1e-6);
        assert.equal(
          intake.exterior.material.normalNode,
          source.material.normalNode,
        );
        assert.equal(
          intake.exterior.material.roughnessNode,
          source.material.roughnessNode,
        );
        assert.equal(
          intake.exterior.material.thicknessNode,
          source.material.thicknessNode,
        );
        assert.equal(
          intake.exterior.material.transmissionNode,
          source.material.transmissionNode,
        );
        assert.deepEqual(
          intake.exterior.geometry.getAttribute('candyCoord').array,
          source.geometry.getAttribute('candyCoord').array,
        );
        intake.update(0.001);
        const eroded = new THREE.Box3().setFromObject(intake.exterior);
        assert.ok(
          after.min.distanceTo(eroded.min) < 0.003,
          'dissolve starts without changing cube bevel abruptly',
        );
      } finally {
        intake?.dispose();
        renderer.dispose();
      }
    },
  );
}
