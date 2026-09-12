import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { StudioCandies } from '../lib/studio-candies.ts';
import { CandyInterest } from '../lib/softbody/candy-interest.ts';

function fixture() {
  const captured = new Set();
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    setPointerCapture: (id) => captured.add(id),
    releasePointerCapture: (id) => captured.delete(id),
    hasPointerCapture: (id) => captured.has(id),
    addEventListener() {},
    removeEventListener() {},
  };
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 2, 6);
  camera.lookAt(0, 0.18, 0);
  camera.updateMatrixWorld();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(1),
    new THREE.MeshBasicMaterial(),
  );
  body.position.x = -5;
  scene.add(body);
  body.updateMatrixWorld();
  const candies = new StudioCandies(canvas, camera, scene, body);
  const c = candies.world.spawn(
    '#ffaaaa',
    'cube',
    { x: 0, y: 0.18, z: 0 },
    undefined,
    0.18,
  );
  const event = (x = 200, y = 200, timeStamp = 0) => ({
    clientX: x,
    clientY: y,
    timeStamp,
    button: 0,
    pointerId: 1,
    pointerType: 'touch',
    currentTarget: canvas,
  });
  return { candies, c, event, captured };
}
test('floor tap invites without lifting or moving the rigid candy; drag and cancel do not invite', () => {
  const { candies, c, event, captured } = fixture();
  let taps = 0;
  candies.onTap = () => taps++;
  const start = [c.x, c.y, c.z];
  assert.equal(candies.down(event()), true);
  assert.equal(c.mode, 'free');
  assert.equal(c.pointerPending, true);
  candies.move(event(203, 202, 60));
  assert.deepEqual([c.x, c.y, c.z], start);
  candies.up(event(203, 202, 110));
  assert.equal(taps, 1);
  assert.equal(c.pointerPending, false);
  assert.equal(captured.size, 0);
  assert.equal(candies.down(event(200, 200, 300)), true);
  candies.move(event(215, 200, 360));
  assert.equal(c.mode, 'held');
  candies.up(event(215, 200, 390));
  assert.equal(taps, 1);
  c.x = 0;
  c.y = 0.18;
  c.z = 0;
  candies.down(event(200, 200, 500));
  candies.cancel();
  assert.equal(taps, 1);
  assert.equal(captured.size, 0);
  assert.equal(c.pointerPending, false);
  candies.dispose();
});
test('explicit invitation responds promptly, repeated taps cannot restart a pounce, reserved candy is excluded', () => {
  const interest = new CandyInterest();
  const c = {
    id: 1,
    x: 3,
    y: 0.18,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    radius: 0.18,
    mode: 'free',
  };
  const o = {
    center: [0, 1, 0],
    forward: [0, 0, 1],
    velocity: [0, 0, 0],
    width: 3.2,
    grounded: true,
    stable: true,
    canAbsorb: true,
  };
  assert.equal(
    interest.step([c], o, 0.1),
    null,
    'natural discovery leaves time to tap',
  );
  interest.invite(c.id);
  let f = interest.step([c], o, 0.02);
  assert.equal(f.stage, 'noticing');
  assert.equal(f.invited, true);
  for (let i = 0; i < 60; i++) {
    interest.invite(c.id);
    f = interest.step([c], o, 1 / 60);
  }
  assert.equal(f.stage, 'collecting');
  c.pointerPending = true;
  assert.equal(
    interest.step([c], o, 0.01).stage,
    'collecting',
    'a repeated tap does not interrupt flight',
  );
  c.mode = 'held';
  assert.equal(interest.step([c], o, 0.01), null, 'actual grab interrupts');
});

test('one-candy tray alternates visible floor positions even after removing every candy', () => {
  const { candies } = fixture();
  candies.clear();
  const points = [];
  for (let i = 0; i < 3; i++) {
    assert.equal(candies.spawn('cube'), true);
    const c = candies.world.candies[0];
    points.push([c.x, c.z]);
    candies.clear();
  }
  assert.ok(
    Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) > 0.7,
  );
  assert.ok(
    Math.hypot(points[1][0] - points[2][0], points[1][1] - points[2][1]) > 0.5,
  );
  candies.dispose();
});

test('successive candies at the same spot choose three distinct shoulder landings and retain them on retap', () => {
  const interest = new CandyInterest();
  const o = {
    center: [0, 1, 0],
    forward: [0, 0, 1],
    velocity: [0, 0, 0],
    width: 3.2,
    grounded: true,
    stable: true,
    canAbsorb: true,
  };
  const points = [],
    motions = [];
  for (let id = 1; id <= 3; id++) {
    interest.reset();
    const c = {
      id,
      x: 0,
      y: 0.18,
      z: 2.5,
      vx: 0,
      vy: 0,
      vz: 0,
      radius: 0.18,
      mode: 'free',
    };
    interest.invite(id);
    const f = interest.step([c], o, 0.02);
    points.push(f.destination.slice());
    motions.push(f.motion);
    interest.invite(id);
    assert.deepEqual(interest.step([c], o, 0.02).destination, points.at(-1));
    assert.ok(
      Math.abs(
        Math.hypot(f.destination[0], f.destination[2] - 2.5) - 3.2 * 0.42,
      ) < 1e-8,
    );
  }
  assert.equal(new Set(motions).size, 3);
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 3; j++)
      assert.ok(
        Math.hypot(points[i][0] - points[j][0], points[i][2] - points[j][2]) >
          0.55,
      );
});
