import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { characterFixture } from './softbody-fixture.mjs';
const contactModule = await import('../lib/candy-contact.ts').catch(() => ({}));
const adapterModule = await import('../lib/studio-candies.ts').catch(
  () => ({}),
);

test('coarse contact follows approved indexed skin deformation and world motion', () => {
  assert.equal(typeof contactModule.CandyContact, 'function');
  const { body: geometry } = characterFixture();
  assert.equal(geometry.attributes.position.count, 19202);
  const body = new THREE.Mesh(geometry);
  const shell = new contactModule.CandyContact(body);
  shell.update();
  const center = shell.bounds.getCenter(new THREE.Vector3());
  assert.ok(shell.contact(center, 0.085));
  assert.equal(shell.contact({ x: 20, y: 20, z: 20 }, 0.085), null);
  const old = center.clone();
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * 1.5);
  body.position.x = 4;
  body.rotation.y = Math.PI / 2;
  shell.update();
  const moved = shell.bounds.getCenter(new THREE.Vector3());
  assert.ok(moved.x > old.x + 3.9);
  assert.equal(shell.contact(old, 0.085), null);
  const hit = shell.contact(moved, 0.085);
  assert.ok(hit);
  assert.ok(new THREE.Vector3().copy(hit.position).distanceTo(moved) > 0.2);
  assert.ok(
    shell.triangleCount < 4000,
    `shell triangles ${shell.triangleCount}`,
  );
});

function setup() {
  assert.equal(typeof adapterModule.StudioCandies, 'function');
  class Surface extends EventTarget {
    captures = new Set();
    setPointerCapture(id) {
      this.captures.add(id);
    }
    hasPointerCapture(id) {
      return this.captures.has(id);
    }
    releasePointerCapture(id) {
      this.captures.delete(id);
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    }
  }
  const canvas = new Surface();
  const tray = new Surface();
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100);
  camera.position.set(0, 4, 8);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const body = new THREE.Mesh(characterFixture().body);
  const runtime = new adapterModule.StudioCandies(
    canvas,
    camera,
    new THREE.Scene(),
    body,
  );
  const ev = (id = 1, x = 400, t = 0) => ({
    pointerId: id,
    clientX: x,
    clientY: 220,
    timeStamp: t,
    currentTarget: tray,
    button: 0,
    pointerType: 'touch',
  });
  return { runtime, tray, ev, camera };
}

test('disallowed hand patch does not attract candy or attempt capture', () => {
  const { runtime, ev } = setup();
  runtime.beginTray('gummy', ev());
  runtime.raycaster.ray.set(
    new THREE.Vector3(0, 1, 5),
    new THREE.Vector3(0, 0, -1),
  );
  let moves = 0,
    captures = 0;
  const move = runtime.world.moveHeld.bind(runtime.world);
  runtime.world.moveHeld = (...args) => {
    moves++;
    return move(...args);
  };
  runtime.onHandContact = () => {
    captures++;
    return false;
  };
  runtime.onHandContactAllowed = () => false;
  runtime.update(1 / 60);
  assert.equal(moves, 0, 'no homing target into a blocked patch');
  assert.equal(captures, 0);
  runtime.onHandContactAllowed = () => true;
  runtime.update(1 / 60);
  assert.equal(moves, 1, 'allowed surface approach still works');
  runtime.dispose();
});

test('high-frequency pointer input performs at most one hand surface query per displayed frame', () => {
  const { runtime, ev } = setup();
  runtime.onHandContact = () => false;
  let queries = 0;
  const original = runtime.raycaster.intersectObject.bind(runtime.raycaster);
  runtime.raycaster.intersectObject = (...args) => {
    queries++;
    return original(...args);
  };
  runtime.beginTray('gummy', ev());
  queries = 0;
  for (let i = 1; i <= 30; i++) runtime.move(ev(1, 400 + i * 0.1, i));
  assert.equal(queries, 0, 'pointer handlers must not scan the detailed mesh');
  runtime.update(1 / 60);
  assert.equal(queries, 1);
  runtime.dispose();
});

test('playable candies match the contact study cube size', () => {
  const { runtime } = setup();
  runtime.spawn('gummy');
  const c = runtime.world.candies[0],
    mesh = runtime.mesh(c.id);
  assert.equal(
    c.radius,
    0.18,
    'physical radius follows the larger visible candy',
  );
  mesh.geometry.computeBoundingBox();
  const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(
    Math.abs(size.x * mesh.scale.x - 0.36) < 1e-5,
    'same .36 edge as the contact study',
  );
  runtime.dispose();
});
test('one candy owns the scene through contact and digestion without replacement', () => {
  const { runtime, tray, ev } = setup();
  assert.equal(runtime.spawn('gummy'), true);
  const ids = runtime.stats().candies.map((c) => c.id);
  assert.equal(runtime.spawn('hard'), false);
  assert.equal(runtime.beginTray('hard', ev()), false);
  assert.equal(tray.hasPointerCapture(1), false);
  runtime.world.candies[0].mode = 'merging';
  assert.equal(
    runtime.spawn('hard'),
    false,
    'digesting candy still owns the slot',
  );
  assert.deepEqual(
    runtime.stats().candies.map((c) => c.id),
    ids,
  );
  runtime.remove(ids[0]);
  assert.equal(runtime.spawn('hard'), true, 'finished candy frees the slot');
  runtime.clear();
  assert.equal(runtime.stats().count, 0);
  assert.equal(runtime.spawn('gummy'), true, 'clearing also frees the slot');
  runtime.dispose();
});
test('tray owns initiating pointer; cancellation drops without stale throw', () => {
  const { runtime, tray, ev } = setup();
  assert.equal(runtime.beginTray('hard', ev()), true);
  assert.equal(tray.hasPointerCapture(1), true);
  assert.equal(runtime.move(ev(2, 500, 20)), false);
  assert.equal(runtime.up(ev(2)), false);
  runtime.move(ev(1, 600, 40));
  runtime.update(0.02);
  runtime.up(ev(1, 600, 45), true);
  const c = runtime.stats().candies[0];
  assert.equal(c.mode, 'free');
  assert.equal(Math.hypot(c.vx, c.vy, c.vz), 0);
  assert.equal(runtime.held, false);
  assert.equal(tray.hasPointerCapture(1), false);
  assert.equal(runtime.up(ev()), false);
  runtime.clear();
  assert.equal(runtime.beginTray('gummy', ev()), true);
  runtime.move(ev(1, 650, 80));
  tray.dispatchEvent(
    Object.assign(new Event('lostpointercapture'), { pointerId: 1 }),
  );
  assert.equal(runtime.held, false);
  assert.equal(runtime.stats().heldId, null);
  runtime.dispose();
});

test('moving approved body over resting floor candy expels it above the floor', () => {
  const body = new THREE.Mesh(characterFixture().body),
    shell = new contactModule.CandyContact(body);
  const center = shell.bounds.getCenter(new THREE.Vector3());
  const p = { x: center.x + 0.15, y: 0.085, z: center.z };
  const hit = shell.contact(p, 0.085);
  assert.ok(hit);
  assert.ok(hit.position.y >= 0.085, `floor penetration ${hit.position.y}`);
  assert.ok(Math.hypot(hit.position.x - p.x, hit.position.z - p.z) > 0.1);
});

test('held candy also stays outside current skin while its target passes through body', () => {
  const { runtime } = setup();
  const c = runtime.world.spawn('#fff', 'hard', { x: 0, y: 1, z: 0 });
  runtime.world.grab(c.id);
  runtime.world.moveHeld({ x: 0, y: 1, z: 0 }, 0.016);
  runtime.update(0.025);
  assert.ok(
    Math.hypot(c.x, c.z) > 0.3 || Math.abs(c.y - 1) > 0.5,
    JSON.stringify(c),
  );
  runtime.dispose();
});

test('re-pick accepts visible candy and rejects candy occluded by approved body', () => {
  const { runtime, ev, camera } = setup();
  const behind = runtime.world.spawn('#fff', 'hard', { x: 0, y: 0.085, z: -3 });
  const eventAt = (c) => {
    const p = new THREE.Vector3(c.x, c.y, c.z).project(camera);
    return { ...ev(), clientX: (p.x + 1) * 400, clientY: (1 - p.y) * 300 };
  };
  runtime.update(0);
  assert.equal(runtime.down(eventAt(behind)), false);
  const front = runtime.world.spawn('#fff', 'gummy', { x: 0, y: 0.085, z: 3 });
  runtime.update(0);
  assert.equal(runtime.down(eventAt(front)), true);
  assert.equal(runtime.world.heldId, front.id);
  runtime.cancel();
  runtime.dispose();
});
test('fresh pointer release throws while delayed release without animation drops quietly', () => {
  const { runtime, ev } = setup();
  runtime.beginTray('gummy', ev());
  runtime.move(ev(1, 550, 30));
  runtime.update(0.016);
  runtime.up(ev(1, 550, 35));
  const first = runtime.stats().candies[0];
  assert.ok(Math.hypot(first.vx, first.vy, first.vz) > 0.1);
  runtime.clear();
  assert.equal(runtime.beginTray('gummy', ev(1, 400, 100)), true);
  runtime.move(ev(1, 550, 130));
  runtime.up(ev(1, 550, 1000));
  const second = runtime.stats().candies[0];
  assert.equal(Math.hypot(second.vx, second.vy, second.vz), 0);
  runtime.dispose();
});

test('tray threshold pointermove starts with primary button held and rejects other buttons', () => {
  const { runtime, ev, tray } = setup();
  for (const buttons of [0, 2, 4])
    assert.equal(
      runtime.beginTray('gummy', { ...ev(), button: -1, buttons }, tray),
      false,
    );
  assert.equal(runtime.stats().count, 0);
  assert.equal(
    runtime.beginTray('gummy', { ...ev(), button: -1, buttons: 1 }, tray),
    true,
  );
  assert.equal(runtime.held, true);
  assert.equal(tray.hasPointerCapture(1), true);
  assert.equal(runtime.stats().count, 1);
  runtime.cancel();
  assert.equal(runtime.down({ ...ev(), button: -1, buttons: 1 }), false);
  runtime.dispose();
});

test('room-edge skin contact chooses feasible exits for candy and approaching sleepers', async () => {
  const { CandyWorld } = await import('../lib/candy-physics.ts');
  for (const axis of ['x', 'z']) {
    const body = new THREE.Mesh(characterFixture().body);
    const world = new CandyWorld();
    world.bounds = { x: 6, zMin: -6, zMax: 6 };
    const shell = new contactModule.CandyContact(body, world.bounds);
    const c = world.spawn('#fff', 'hard', {
      x: axis === 'x' ? 5.9 : 0,
      y: 0.085,
      z: axis === 'z' ? 5.9 : 0,
    });
    c.sleeping = true;
    for (let i = 0; i < 120; i++) {
      body.position[axis] = 4.5 + Math.min(0.6, i * 0.02);
      shell.update();
      world.advance(1 / 120, {
        x: 0,
        y: 0,
        z: 0,
        mouth: { x: 0, y: 0, z: 0 },
        edibleId: null,
        contact: shell.contact,
      });
      assert.ok(
        Math.abs(c.x) <= 6 - c.radius + 1e-8 &&
          Math.abs(c.z) <= 6 - c.radius + 1e-8,
        `${axis} escaped ${c.x},${c.z}`,
      );
      assert.ok(c.y >= c.radius);
    }
    const unresolved = shell.contact(c, c.radius);
    assert.ok(
      !unresolved ||
        Math.hypot(
          unresolved.position.x - c.x,
          unresolved.position.y - c.y,
          unresolved.position.z - c.z,
        ) < 0.01,
      'candy remains embedded',
    );
  }
});

test('capture loss from a secondary pointer preserves primary candy ownership', () => {
  const { runtime, ev, tray } = setup();
  runtime.beginTray('hard', ev());
  tray.dispatchEvent(
    Object.assign(new Event('lostpointercapture'), { pointerId: 2 }),
  );
  assert.equal(runtime.held, true);
  assert.equal(runtime.stats().heldId, 1);
  tray.dispatchEvent(
    Object.assign(new Event('lostpointercapture'), { pointerId: 1 }),
  );
  assert.equal(runtime.held, false);
  assert.equal(runtime.stats().heldId, null);
  runtime.dispose();
});
