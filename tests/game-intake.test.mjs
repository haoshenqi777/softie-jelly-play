import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { characterFixture } from './softbody-fixture.mjs';
import { VolumeInteraction } from '../lib/softbody/interaction.ts';
import { StudioCandies } from '../lib/studio-candies.ts';
import { AbsorptionField } from '../lib/absorption-field.ts';
import { GameIntake } from '../lib/game-intake.ts';
import { SlimeOptics } from '../lib/slime-optics.ts';
import { AbsorptionInterior } from '../lib/absorption-interior.ts';

test('completed pigment becomes the next candy baseline without a pink reset', () => {
  const f = new AbsorptionField();
  f.setTarget('mint');
  f.settled.value = 1;
  f.commit();
  assert.deepEqual(f.state, { base: 'mint', target: 'mint' });
  assert.equal(f.released.value, 0);
  f.setTarget('honey');
  assert.deepEqual(f.state, { base: 'mint', target: 'honey' });
  f.commit();
  assert.equal(f.state.base, 'honey');
});

function fixture(rendering = false) {
  const { body, geometry, profile, bubbles } = characterFixture();
  const mesh = new THREE.Mesh(body);
  mesh.userData.optical_profile = JSON.stringify(profile);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, 2.1, 8);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const canvas = {
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    setPointerCapture() {},
    hasPointerCapture: () => false,
    releasePointerCapture() {},
    addEventListener() {},
    removeEventListener() {},
  };
  const parts = ['Eye.L', 'Eye.R', 'Smile'].map((name) => {
    const m = new THREE.Mesh(geometry(name));
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
  const scene = new THREE.Scene();
  scene.add(mesh);
  const candies = new StudioCandies(canvas, camera, scene, mesh),
    field = new AbsorptionField(2);
  assert.equal(typeof GameIntake, 'function');
  const optics = rendering ? new SlimeOptics(mesh, scene) : null;
  const interior = rendering ? new AbsorptionInterior() : null;
  const game = new GameIntake(
    v,
    candies,
    field,
    rendering
      ? {
          scene,
          optics,
          interior,
          environment: new THREE.Texture(),
        }
      : undefined,
  );
  v.setExpression({ responsive: true });
  return { v, candies, game, field, mesh, scene, optics, interior };
}

test('camera takeover without a body grab preserves the current candy-flight velocity', () => {
  const { v, candies, game } = fixture();
  v.setPlayMode('tabletop');
  assert.equal(v.held, false);
  v.solver.kick(1, 3, 0);
  const before = v.solver.velocity.slice();
  v.cancel();
  assert.deepEqual(v.solver.velocity, before);
  game.dispose();
  candies.dispose();
});

test('an intentional jump immediately after touch release keeps its selected height', async () => {
  const peaks = [];
  for (const touched of [false, true]) {
    const { v, candies, game } = fixture();
    try {
      v.setPlayMode('tabletop');
      v.setTuning({ jump: 100 });
      await v.solver.accelerate(
        readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
      );
      if (touched) {
        assert.equal(
          v.pointerDown({
            button: 0,
            pointerId: 19,
            clientX: 200,
            clientY: 200,
            timeStamp: 0,
            preventDefault() {},
          }),
          true,
        );
        v.pointerUp({ pointerId: 19, type: 'pointerup', timeStamp: 400 });
      }
      v.drop();
      for (let i = 0; i < 120; i++) v.update(1 / 60);
      peaks.push(v.stats().maxHeight);
    } finally {
      game.dispose();
      candies.dispose();
    }
  }
  assert.ok(
    Math.abs(peaks[0] - peaks[1]) < 0.1,
      `touch release must not damp the next intentional jump: ${peaks.join(',')}`,
  );
});

for (const mode of ['free', 'tabletop'])
  test(`${mode}: three meals at the SAME floor point use different physical contacts and complete without suction`, async () => {
    const contacts = [],
      motions = [],
      peaks = [];
    for (let turn = 0; turn < 3; turn++) {
      const { v, candies, game } = fixture();
      v.setPlayMode(mode);
      candies.setPlayMode(mode);
      try {
        await v.solver.accelerate(
          readFileSync(
            new URL('../public/physics/volume.wasm', import.meta.url),
          ),
        );
        await v.intake.shell.skin.accelerate(
          readFileSync(
            new URL('../public/physics/contact-skin.wasm', import.meta.url),
          ),
        );
        for (let i = 0; i <= turn; i++) {
          candies.clear();
          candies.spawn(turn % 2 ? 'round' : 'cube');
        }
        const c = candies.world.candies[0];
        Object.assign(c, {
          x: 0,
          y: 0.25,
          z: mode === 'tabletop' ? 2 : 2.5,
          vx: 0,
          vy: 0,
          vz: 0,
        });
        let captured = false,
          peak = 0,
          response = false;
        for (let i = 0; i < 2400 && game.stats().completed === 0; i++) {
          v.setCandies(candies.world.candies);
          if (i === 60) v.inviteCandy(c.id);
          v.update(1 / 60);
          candies.update(1 / 60);
          game.update();
          const s = v.stats();
          peak = Math.max(peak, s.maxHeight);
          if (!captured && v.intake.active) {
            captured = true;
            contacts.push(v.intake.anchor.restPoint.toArray());
            motions.push(s.candyHop.motion);
          }
          if (s.meal?.stage === 'settling' && s.meal?.beat === 'finish')
            response ||= s.expression.active !== 'neutral';
          assert.ok(v.solver.x.every(Number.isFinite));
        }
        assert.equal(
          game.stats().completed,
          1,
          JSON.stringify({
            turn,
            game: game.stats(),
            character: v.characterState(),
            hop: v.motor.candyHop.stats(),
          }),
        );
        assert.ok(
          response,
          'the visible sugar disappearing triggers an actual non-neutral face',
        );
        peaks.push(peak);
      } finally {
        game.dispose();
        candies.dispose();
      }
    }
    assert.equal(new Set(motions).size, 3);
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++)
        assert.ok(
          Math.hypot(...contacts[i].map((v, k) => v - contacts[j][k])) > 0.35,
          JSON.stringify(contacts),
        );
    assert.ok(
      Math.max(...peaks) - Math.min(...peaks) > 0.22,
      JSON.stringify(peaks),
    );
  });

test('floor candy at five angles completes real contact; an invited far candy gets strides then a pounce', async () => {
  const contacts = [];
  for (const [x, z] of [
    [2.5, 0],
    [-2.5, 0],
    [0, -2.5],
    [0, 2.5],
    [4.8, 2],
  ]) {
    const { v, candies, game } = fixture();
    try {
      await v.solver.accelerate(
        readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
      );
      await v.intake.shell.skin.accelerate(
        readFileSync(
          new URL('../public/physics/contact-skin.wasm', import.meta.url),
        ),
      );
      candies.spawn('cube');
      const c = candies.world.candies[0];
      Object.assign(c, { x, y: 0.25, z, vx: 0, vy: 0, vz: 0 });
      let peak = 0,
        captured = false;
      const stages = new Set(),
        trace = [],
        hopKinds = new Set();
      for (let i = 0; i < 2400 && game.stats().completed === 0; i++) {
        v.setCandies(candies.world.candies);
        if (x === 4.8 && i === 60) v.inviteCandy(c.id);
        v.update(1 / 60);
        candies.update(1 / 60);
        game.update();
        const s = v.stats();
        if (s.candyHop.phase === 'flight') hopKinds.add(s.candyHop.kind);
        peak = Math.max(peak, s.maxHeight);
        stages.add(v.characterState().phase);
        if (i % 120 === 0)
          trace.push({
            t: i / 60,
            phase: v.characterState().phase,
            hop: s.candyHop,
            intake: v.intake.frame(),
            c: [c.x, c.y, c.z],
          });
        if (!captured && v.intake.active) {
          captured = true;
          contacts.push(v.intake.anchor.restPoint.toArray());
          assert.ok(v.motor.candyHop.stats().launches > 0);
        }
        assert.equal(v.solver.x.every(Number.isFinite), true);
      }
      assert.equal(
        game.stats().completed,
        1,
        JSON.stringify({ x, z, stages: [...stages], trace }),
      );
      assert.ok(
        stages.has('noticing') &&
          stages.has('inspecting') &&
          stages.has('collecting'),
      );
      assert.ok(peak > 2.6, 'actually leaves the table');
      if (x === 4.8) {
        assert.deepEqual([...hopKinds], ['stride', 'pounce']);
        assert.ok(v.motor.candyHop.stats().launches >= 2);
      }
    } finally {
      game.dispose();
      candies.dispose();
    }
  }
  assert.equal(contacts.length, 5);
  assert.ok(
    contacts[0][0] > 0.8 && contacts[1][0] < -0.8 && contacts[2][2] < -0.8,
    'contact is on three actual body regions',
  );
});

test('new hard cube and round candy retain their shape through held pressure and complete absorption', async () => {
  for (const kind of ['cube', 'round']) {
    const { v, candies, game, mesh, field } = fixture();
    try {
      await v.solver.accelerate(
        readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
      );
      await v.intake.shell.skin.accelerate(
        readFileSync(
          new URL('../public/physics/contact-skin.wasm', import.meta.url),
        ),
      );
      v.setRecoveryEnabled(false);
      candies.spawn(kind);
      const c = candies.world.candies[0];
      const hit = new THREE.Raycaster(
        new THREE.Vector3(0.85, 1, 5),
        new THREE.Vector3(0, 0, -1),
      ).intersectObject(mesh)[0];
      const p = hit.point.clone().addScaledVector(hit.normal, 0.23);
      Object.assign(c, { x: p.x, y: p.y, z: p.z });
      candies.world.grab(c.id);
      assert.equal(candies.onHandContact(c, hit.point, hit.normal), true);
      const tick = () => {
        v.update(1 / 60);
        candies.update(1 / 60);
        game.update();
      };
      candies.onHandPressure(100);
      for (let i = 0; i < 150; i++) {
        tick();
        assert.equal(c.compression, 0);
        assert.equal(v.intake.shell.candy.compression, 0);
        assert.equal(c.mode, 'held');
      }
      assert.equal(v.intake.frame().dissolve, 0);
      assert.ok(v.intake.frame().indent > 0.01);
      candies.onHandRelease(false);
      candies.world.release();
      assert.equal(c.mode, 'merging');
      for (let i = 0; i < 1600 && game.stats().completed === 0; i++) tick();
      assert.equal(game.stats().completed, 1);
      assert.equal(candies.world.candies.length, 0);
      assert.equal(field.state.base, kind === 'cube' ? 'peach' : 'sky');
    } finally {
      game.dispose();
      candies.dispose();
    }
  }
});

test('feeding face follows real hand pressure without requiring autonomous walking', async () => {
  const { v, candies, game, mesh } = fixture();
  try {
    await v.solver.accelerate(
      readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
    );
    await v.intake.shell.skin.accelerate(
      readFileSync(
        new URL('../public/physics/contact-skin.wasm', import.meta.url),
      ),
    );
    v.setRecoveryEnabled(false);
    candies.spawn('cube');
    const c = candies.world.candies[0];
    const hit = new THREE.Raycaster(
      new THREE.Vector3(0.85, 1, 5),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(mesh)[0];
    const p = hit.point.clone().addScaledVector(hit.normal, 0.23);
    Object.assign(c, { x: p.x, y: p.y, z: p.z });
    candies.world.grab(c.id);
    assert.equal(candies.onHandContact(c, hit.point, hit.normal), true);
    const tick = (n) => {
      for (let i = 0; i < n; i++) {
        v.update(1 / 60);
        candies.update(1 / 60);
        game.update();
      }
    };
    candies.onHandPressure(10);
    tick(60);
    assert.equal(
      v.expression.stats().active,
      'curious',
      'light contact is an attentive glance, including with autonomy off',
    );
    candies.onHandPressure(85);
    tick(100);
    assert.equal(
      v.expression.stats().active,
      'effort',
      'deeper pressure shows effort instead of waiting for a timed face',
    );
    assert.equal(
      v.intake.frame().dissolve,
      0,
      'holding the candy cannot start satisfaction or digestion',
    );
    candies.onHandPressure(0);
    tick(80);
    assert.equal(
      v.expression.stats().active,
      'curious',
      'letting pressure ease must relax the face before release',
    );
    candies.onHandRelease(true);
    candies.world.release();
    tick(100);
    assert.notEqual(
      v.expression.stats().active,
      'happy',
      'withdrawal cannot trigger a completed-meal celebration',
    );
  } finally {
    game.dispose();
    candies.dispose();
  }
});

test('direct body touch and gentle strokes cancel the completed meal tail', () => {
  const { v, game, candies } = fixture();
  const signal = {
    id: 100,
    stage: 'inside',
    held: false,
    pressure: 0,
    withdrawing: false,
    wrap: 1,
    diffusionAge: 0,
  };
  try {
    for (const gesture of ['hold', 'stroke']) {
      v.meal.reset();
      v.meal.step(1 / 60, signal);
      v.meal.step(1 / 60, { ...signal, stage: 'done' });
      assert.equal(v.meal.frame().active, true);
      if (gesture === 'hold') {
        assert.equal(
          v.pointerDown({
            button: 0,
            pointerId: 19,
            clientX: 200,
            clientY: 200,
            timeStamp: 0,
            preventDefault() {},
          }),
          true,
        );
        v.pointerUp({ pointerId: 19, type: 'pointerup', timeStamp: 400 });
      } else v.stroke(0.1);
      v.meal.step(1 / 60, { ...signal, stage: 'done' });
      assert.equal(
        v.meal.frame().active,
        false,
        `${gesture} cannot restart the finishing gesture after input`,
      );
    }
  } finally {
    game.dispose();
    candies.dispose();
  }
});

test('face patch rejects held candy but keeps free absorption and body touch available', () => {
  const { v, candies, game, mesh } = fixture();
  try {
    const hit = new THREE.Raycaster(
      new THREE.Vector3(0, 1.08, 5),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(mesh)[0];
    for (const kind of ['gummy', 'hard']) {
      const c = candies.world.spawn(
        '#94dcb9',
        kind,
        hit.point.clone().addScaledVector(hit.normal, 0.2),
        undefined,
        0.18,
      );
      candies.world.grab(c.id);
      assert.equal(candies.onHandContact(c, hit.point, hit.normal), false);
      assert.equal(c.mode, 'held');
      assert.equal(v.intake.active, false);
      assert.equal(
        v.intake.anchor,
        null,
        'blocked contact never binds the fine shell',
      );
      candies.world.release();
      assert.equal(
        candies.onContact(c, hit.point, hit.normal),
        true,
        'free candy absorption is unchanged',
      );
      game.clear();
      candies.clear();
    }
    assert.equal(
      v.pointerDown({
        button: 0,
        pointerId: 9,
        clientX: 200,
        clientY: 200,
        timeStamp: 0,
        preventDefault() {},
      }),
      true,
      'body press is still available',
    );
    v.pointerUp({ pointerId: 9, type: 'pointerup', timeStamp: 20 });
  } finally {
    game.dispose();
    candies.dispose();
  }
});

test('held-candy face guard follows rest coordinates through rotation and deformation', () => {
  const { candies, game, mesh } = fixture();
  try {
    const ray = (x, y, z, dx, dy, dz) =>
      new THREE.Raycaster(
        new THREE.Vector3(x, y, z),
        new THREE.Vector3(dx, dy, dz),
      ).intersectObject(mesh)[0];
    assert.equal(typeof candies.onHandContactAllowed, 'function');
    assert.equal(
      candies.onHandContactAllowed(ray(0, 1.08, 5, 0, 0, -1)),
      false,
    );
    assert.equal(
      candies.onHandContactAllowed(ray(0.85, 1.08, 5, 0, 0, -1)),
      true,
    );
    assert.equal(candies.onHandContactAllowed(ray(0, 1.08, -5, 0, 0, 1)), true);
    assert.equal(candies.onHandContactAllowed(ray(0, 5, 0, 0, -1, 0)), true);
    mesh.geometry.scale(0.85, 0.9, 1);
    mesh.rotation.y = Math.PI / 2;
    mesh.position.x = 2;
    mesh.updateMatrixWorld();
    assert.equal(
      candies.onHandContactAllowed(ray(7, 1.08 * 0.9, 0, -1, 0, 0)),
      false,
    );
    assert.equal(
      candies.onHandContactAllowed(ray(-3, 1.08 * 0.9, 0, 1, 0, 0)),
      true,
    );
  } finally {
    game.dispose();
    candies.dispose();
  }
});

test('candy appearance is prepared before contact and reused through withdrawal and recapture', () => {
  for (const kind of ['gummy', 'hard']) {
    const { candies, game, mesh, scene, optics, interior } = fixture(true);
    try {
      candies.spawn(kind);
      const c = candies.world.candies[0],
        source = candies.mesh(c.id);
      const prepared = scene.getObjectByName('ContactStudy.Candy');
      assert.ok(
        prepared,
        'absorption geometry exists before the first contact',
      );
      assert.equal(prepared.visible, false, 'only the free candy is visible');
      const material = source.material;
      assert.equal(
        prepared.material,
        material,
        'one material across both draw meshes',
      );
      assert.equal(material.transparent, false);
      assert.equal(material.depthWrite, true);
      const hit = new THREE.Raycaster(
        new THREE.Vector3(0, 1, 5),
        new THREE.Vector3(0, 0, -1),
      ).intersectObject(mesh)[0];
      const p = hit.point.clone().addScaledVector(hit.normal, c.radius + 0.02);
      Object.assign(c, { x: p.x, y: p.y, z: p.z, rx: 0.4, ry: 0.3 });
      c.compression = kind === 'gummy' ? 0.16 : 0;
      candies.renderer.update(candies.world.candies);
      const before = new THREE.Box3().setFromObject(source);
      assert.ok(candies.onContact(c, hit.point, hit.normal));
      game.update();
      assert.equal(
        scene.getObjectByName('ContactStudy.Candy'),
        prepared,
        'no new geometry on contact',
      );
      assert.equal(
        prepared.material,
        material,
        'no material switch on contact',
      );
      const after = new THREE.Box3().setFromObject(prepared);
      assert.ok(before.min.distanceTo(after.min) < 1e-6);
      assert.ok(before.max.distanceTo(after.max) < 1e-6);
      game.clear();
      assert.equal(prepared.visible, false);
      assert.equal(
        source.material,
        material,
        'withdrawal keeps the warmed material',
      );
      assert.ok(candies.onContact(c, hit.point, hit.normal));
      game.update();
      assert.equal(
        scene.getObjectByName('ContactStudy.Candy'),
        prepared,
        'recapture reuses the same resource',
      );
      let disposals = 0;
      material.addEventListener('dispose', () => disposals++);
      candies.clear();
      assert.equal(scene.getObjectByName('ContactStudy.Candy'), undefined);
      assert.equal(interior.root.children.length, 0);
      assert.equal(
        disposals,
        1,
        'removed candy releases its private material once',
      );
    } finally {
      game.dispose();
      candies.dispose();
      optics.dispose();
      interior.dispose();
    }
  }
});
test('a real low-belly cube with a partial floor collar proceeds through entry and digestion', async (t) => {
  const { v, candies, game, mesh } = fixture();
  try {
    await v.solver.accelerate(
      readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
    );
    await v.intake.shell.skin.accelerate(
      readFileSync(
        new URL('../public/physics/contact-skin.wasm', import.meta.url),
      ),
    );
    v.setRecoveryEnabled(false);
    candies.spawn('cube');
    const c = candies.world.candies[0];
    const hit = new THREE.Raycaster(
      new THREE.Vector3(0.7, 0.3, 5),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(mesh)[0];
    const p = hit.point.clone().addScaledVector(hit.normal, 0.23);
    Object.assign(c, { x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0 });
    assert.equal(candies.onContact(c, hit.point, hit.normal), true);
    const phases = new Set();
    for (let i = 0; i < 1700 && game.stats().completed === 0; i++) {
      v.update(1 / 60);
      candies.update(1 / 60);
      game.update();
      phases.add(v.intake.frame().stage);
    }
    t.diagnostic(JSON.stringify({ phases: [...phases], frame: game.stats() }));
    assert.ok(
      phases.has('wrapping') && phases.has('sealing') && phases.has('inside'),
    );
    assert.equal(game.stats().completed, 1);
  } finally {
    game.dispose();
    candies.dispose();
  }
});

test('free crown and side impacts retain their material attachment and accept a second flavor', async (t) => {
  const { v, candies, game, field, mesh } = fixture();
  await v.solver.accelerate(
    readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
  );
  if (process.env.CONTACT_SKIN_WASM === '1')
    await v.intake.shell.skin.accelerate(
      readFileSync(
        new URL('../public/physics/contact-skin.wasm', import.meta.url),
      ),
    );
  v.setRecoveryEnabled(false);
  for (const kind of ['gummy', 'hard']) {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox,
      center = box.getCenter(new THREE.Vector3());
    const axis =
      kind === 'gummy'
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
    mesh.updateMatrixWorld();
    const hit = new THREE.Raycaster(
      center.clone().addScaledVector(axis, 5),
      axis.clone().negate(),
    ).intersectObject(mesh)[0];
    assert.ok(hit);
    const c = candies.world.spawn(
      kind === 'gummy' ? '#8de6c2' : '#f3b94d',
      kind,
      hit.point.clone().addScaledVector(axis, 0.22),
      axis.clone().multiplyScalar(-2.5),
      0.18,
    );
    const previousCompleted = game.stats().completed;
    let moved = false,
      entered = false;
    for (let i = 0; i < 1800; i++) {
      v.update(1 / 60);
      candies.update(1 / 60);
      game.update();
      const f = v.intake.frame();
      entered ||= c.mode === 'merging';
      if (f.stage === 'inside' && !moved) {
        const transform = new THREE.Matrix4()
          .makeRotationY(0.8)
          .setPosition(1.1, 0, -0.4);
        const expected = new THREE.Vector3(c.x, c.y, c.z).applyMatrix4(
            transform,
          ),
          point = new THREE.Vector3();
        for (let j = 0; j < v.solver.x.length; j += 3)
          point
            .fromArray(v.solver.x, j)
            .applyMatrix4(transform)
            .toArray(v.solver.x, j);
        v.update(1 / 240);
        game.update();
        assert.ok(
          new THREE.Vector3(c.x, c.y, c.z).distanceTo(expected) < 0.04,
          'core advects with a turning/moving body',
        );
        moved = true;
      }
      if (game.stats().completed > previousCompleted) break;
    }
    t.diagnostic(JSON.stringify({ kind, frame: game.stats() }));
    assert.ok(entered);
    assert.ok(moved);
    assert.equal(game.stats().completed, previousCompleted + 1);
    assert.equal(field.state.base, kind === 'gummy' ? 'mint' : 'honey');
  }
  game.clear();
  candies.dispose();
});

test('held candy presses inward, can withdraw, and only absorbs after a deep release', async () => {
  const { v, candies, game, mesh } = fixture();
  await v.solver.accelerate(
    readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
  );
  if (process.env.CONTACT_SKIN_WASM === '1')
    await v.intake.shell.skin.accelerate(
      readFileSync(
        new URL('../public/physics/contact-skin.wasm', import.meta.url),
      ),
    );
  assert.equal(typeof v.intake.beginHeld, 'function');
  v.setRecoveryEnabled(false);
  for (const cancel of [true, false]) {
    const hit = new THREE.Raycaster(
      new THREE.Vector3(0.85, 1, 5),
      new THREE.Vector3(0, 0, -1),
    ).intersectObject(mesh)[0];
    const n = hit.normal.clone().normalize();
    const c = candies.world.spawn(
      '#94dcb9',
      'gummy',
      hit.point.clone().addScaledVector(n, 0.2),
      undefined,
      0.18,
    );
    candies.world.grab(c.id);
    assert.equal(candies.onHandContact(c, hit.point, n), true);
    candies.onHandPressure(100);
    for (let i = 0; i < 120; i++) {
      v.update(1 / 60);
      candies.update(1 / 60);
      game.update();
    }
    assert.equal(c.mode, 'held');
    assert.equal(candies.world.heldId, c.id);
    assert.ok(v.intake.frame().indent > 0.01);
    assert.equal(v.intake.frame().dissolve, 0);
    assert.ok(
      c.compression > 0.08,
      'sustained physical pressure squashes gummy candy',
    );
    const releaseAnchor = v.intake.anchor.sample(v.solver.x);
    const beforeDepth = new THREE.Vector3(c.x, c.y, c.z)
      .sub(releaseAnchor.point)
      .dot(releaseAnchor.normal);
    assert.ok(beforeDepth < 0, 'the real candy has reached the interior');
    const beforeRelease = new THREE.Vector3(c.x, c.y, c.z);
    candies.onHandRelease(cancel);
    candies.world.release();
    if (cancel) {
      assert.equal(c.mode, 'free');
      assert.equal(v.intake.frame().withdrawing, true);
      assert.equal(
        new THREE.Vector3(c.x, c.y, c.z).distanceTo(beforeRelease),
        0,
        'release must not teleport the candy',
      );
      for (let i = 0; i < 180 && c.contactHeld; i++) {
        v.update(1 / 60);
        candies.update(1 / 60);
        game.update();
      }
      assert.equal(v.intake.frame().stage, 'idle');
      assert.equal(c.contactHeld, false);
      v.update(1 / 60);
      candies.update(1 / 60);
      game.update();
      assert.equal(
        c.mode,
        'free',
        'canceled hand pressure must not recapture next frame',
      );
    } else {
      assert.equal(c.mode, 'merging');
      for (let i = 0; i < 1500; i++) {
        v.update(1 / 60);
        candies.update(1 / 60);
        game.update();
      }
      assert.equal(v.intake.frame().stage, 'done');
      assert.equal(candies.world.candies.length, 0);
    }
    v.reset();
    candies.clear();
  }
  game.dispose();
  candies.dispose();
});

test('tray drag waits for physical contact, and stale deep release still transfers to absorption', async () => {
  const { v, candies, game } = fixture();
  await v.solver.accelerate(
    readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
  );
  if (process.env.CONTACT_SKIN_WASM === '1')
    await v.intake.shell.skin.accelerate(
      readFileSync(
        new URL('../public/physics/contact-skin.wasm', import.meta.url),
      ),
    );
  v.setRecoveryEnabled(false);
  const e = {
    button: 0,
    buttons: 1,
    pointerId: 7,
    clientX: 285,
    clientY: 200,
    timeStamp: 100,
  };
  assert.equal(candies.beginTray('gummy', e), true);
  const c = candies.world.candies[0];
  assert.equal(
    c.contactHeld,
    undefined,
    'a ray over the body is not yet physical contact',
  );
  for (let i = 0; i < 90; i++) {
    v.update(1 / 60);
    candies.update(1 / 60);
    game.update();
  }
  assert.equal(
    c.contactHeld,
    true,
    'held candy reaches the surface without requiring extra pointer events',
  );
  candies.move({ ...e, clientY: 330, timeStamp: 1600 });
  for (let i = 0; i < 120; i++) {
    v.update(1 / 60);
    candies.update(1 / 60);
    game.update();
  }
  candies.up({ ...e, clientY: 330, timeStamp: 4000 });
  assert.equal(
    c.mode,
    'merging',
    'a stationary press is not a canceled gesture',
  );
  assert.equal(candies.held, false);
  assert.equal(candies.world.heldId, null);
  game.dispose();
  candies.dispose();
});

test('a quick change of pressure target cannot absorb a candy that is still outside', async () => {
  const { v, candies, game, mesh } = fixture();
  await v.solver.accelerate(
    readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
  );
  if (process.env.CONTACT_SKIN_WASM === '1')
    await v.intake.shell.skin.accelerate(
      readFileSync(
        new URL('../public/physics/contact-skin.wasm', import.meta.url),
      ),
    );
  v.setRecoveryEnabled(false);
  const hit = new THREE.Raycaster(
    new THREE.Vector3(0.85, 1, 5),
    new THREE.Vector3(0, 0, -1),
  ).intersectObject(mesh)[0];
  const c = candies.world.spawn(
    '#94dcb9',
    'gummy',
    hit.point.clone().addScaledVector(hit.normal, 0.2),
    undefined,
    0.18,
  );
  candies.world.grab(c.id);
  assert.equal(candies.onHandContact(c, hit.point, hit.normal), true);
  candies.onHandPressure(30);
  for (let i = 0; i < 60; i++) {
    v.update(1 / 60);
    candies.update(1 / 60);
    game.update();
  }
  candies.onHandPressure(100);
  candies.onHandRelease(false);
  candies.world.release();
  assert.equal(c.mode, 'free');
  assert.equal(v.intake.frame().withdrawing, true);
  for (let i = 0; i < 180 && c.contactHeld; i++) {
    v.update(1 / 60);
    candies.update(1 / 60);
    game.update();
  }
  assert.equal(v.intake.active, false);
  game.dispose();
  candies.dispose();
});

test('saved spatial dye follows the body after the candy has gone', () => {
  const { v, candies, game, field } = fixture();
  game.restoreColor({
    version: 1,
    base: 'rose',
    target: 'mint',
    source: [0.2, 1, 0.7],
    radius: 0.3,
    released: 1,
  });
  game.update();
  const material = new THREE.Vector3(0.2, 1, 0.7),
    before = material.clone().applyMatrix4(field.worldToRest.value);
  for (let i = 0; i < v.solver.x.length; i += 3) v.solver.x[i] += 2;
  game.update();
  const after = material
    .clone()
    .add(new THREE.Vector3(2, 0, 0))
    .applyMatrix4(field.worldToRest.value);
  assert.ok(before.distanceTo(after) < 1e-6);
  game.clear();
  assert.equal(
    field.released.value,
    1,
    'body reset preserves the chosen appearance',
  );
  game.dispose();
  candies.dispose();
});

test('a saved blend survives light candy contact and withdrawal', async () => {
  const { v, candies, game, field, mesh } = fixture();
  await v.solver.accelerate(
    readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
  );
  if (process.env.CONTACT_SKIN_WASM === '1')
    await v.intake.shell.skin.accelerate(
      readFileSync(
        new URL('../public/physics/contact-skin.wasm', import.meta.url),
      ),
    );
  v.setRecoveryEnabled(false);
  game.restoreColor({
    version: 1,
    base: 'rose',
    target: 'mint',
    released: 0.75,
    settled: 0.1,
    radius: 1.8,
    source: [0, 0.7, 0.8],
  });
  const saved = field.freeze();
  const hit = new THREE.Raycaster(
    new THREE.Vector3(0.85, 1, 5),
    new THREE.Vector3(0, 0, -1),
  ).intersectObject(mesh)[0];
  const c = candies.world.spawn(
    '#edc980',
    'hard',
    hit.point.clone().addScaledVector(hit.normal, 0.2),
    undefined,
    0.18,
  );
  candies.world.grab(c.id);
  assert.equal(candies.onHandContact(c, hit.point, hit.normal), true);
  for (let i = 0; i < 45; i++) {
    v.update(1 / 60);
    candies.update(1 / 60);
    game.update();
  }
  assert.deepEqual(
    field.freeze(),
    saved,
    'contact alone cannot erase a chosen blend',
  );
  candies.onHandRelease(true);
  candies.world.release();
  for (let i = 0; i < 180 && c.contactHeld; i++) {
    v.update(1 / 60);
    candies.update(1 / 60);
    game.update();
  }
  assert.deepEqual(field.freeze(), saved);
  game.dispose();
  candies.dispose();
});

test('reset and tray clear release ownership without keeping a hidden candy', async () => {
  const { v, candies, game, mesh } = fixture();
  await v.solver.accelerate(
    readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
  );
  if (process.env.CONTACT_SKIN_WASM === '1')
    await v.intake.shell.skin.accelerate(
      readFileSync(
        new URL('../public/physics/contact-skin.wasm', import.meta.url),
      ),
    );
  const hit = new THREE.Raycaster(
    new THREE.Vector3(0, 1, 5),
    new THREE.Vector3(0, 0, -1),
  ).intersectObject(mesh)[0];
  const c = candies.world.spawn(
    '#8de6c2',
    'gummy',
    hit.point.clone().add(new THREE.Vector3(0, 0, 0.09)),
  );
  v.update(1 / 60);
  candies.update(1 / 60);
  game.update();
  assert.equal(c.mode, 'merging');
  for (let i = 0; i < 80; i++) {
    v.update(1 / 60);
    candies.update(1 / 60);
    game.update();
  }
  assert.ok(
    v.intake.frame().indent > 0.01,
    'reset while the skin is actually indented',
  );
  v.reset();
  game.update();
  assert.equal(c.mode, 'free');
  assert.equal(game.stats().stage, 'idle');
  assert.equal(
    v.intake.frame().indent,
    0,
    'reset restores the smooth skin too',
  );
  candies.clear();
  assert.equal(candies.world.candies.length, 0);
  assert.equal(game.stats().id, null);
  game.dispose();
  candies.dispose();
});
