import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3, Raycaster } from 'three';
import * as orbitModule from '../lib/slime-orbit.ts';
import { SlimeDynamics } from '../lib/slime-physics.ts';
import { heightAt, radiusAt } from '../lib/slime-shape.ts';

test('empty-space orbit circles the room, stays above the floor, and returns by the shortest arc', () => {
  assert.equal(typeof orbitModule.SlimeOrbit, 'function');
  const view = new orbitModule.SlimeOrbit();
  view.rotate(-3 * Math.PI, 99);
  for (let i = 0; i < 240; i++) view.advance(1 / 120);
  assert.ok(view.yaw < -Math.PI * 2, 'rotation is not restricted to the front');
  assert.ok(view.pitch < 1.2 && view.pitch > 0.1);
  const before = view.yaw;
  view.home();
  view.advance(1 / 120);
  assert.ok(Math.abs(view.yaw - before) < 0.3, 'home does not jump');
  for (let i = 0; i < 240; i++) view.advance(1 / 120);
  assert.ok(Math.abs(Math.sin(view.yaw)) < 0.001 && Math.cos(view.yaw) > 0.999);
  assert.ok(Math.abs(view.yaw - before) <= Math.PI + 0.01);
});

test('view-aligned grab planes preserve the picked point at front, side and back views', () => {
  assert.equal(typeof orbitModule.grabPlane, 'function');
  for (const angle of [0, Math.PI / 2, Math.PI, 4.4]) {
    const camera = new PerspectiveCamera(32, 1.3, 0.1, 40);
    camera.position.set(Math.sin(angle) * 9, 3.5, Math.cos(angle) * 9);
    camera.lookAt(0, 1.2, 0);
    camera.updateMatrixWorld();
    const picked = new Vector3(0.4, 1.5, 0.6);
    const plane = orbitModule.grabPlane(camera, picked);
    const screen = picked.clone().project(camera);
    const ray = new Raycaster();
    ray.setFromCamera(screen, camera);
    const point = ray.ray.intersectPlane(plane, new Vector3());
    assert.ok(
      point.distanceTo(picked) < 1e-7,
      'starting a drag does not teleport',
    );
    screen.x += 0.12;
    ray.setFromCamera(screen, camera);
    const next = ray.ray.intersectPlane(plane, new Vector3());
    assert.ok(
      next.clone().project(camera).x > picked.clone().project(camera).x + 0.1,
    );
    assert.ok(
      Math.abs(next.y - picked.y) < 1e-6,
      'horizontal drag stays horizontal',
    );
  }
});

test('camera fits a rapidly lifted inflated crown and side flesh from every view', () => {
  assert.equal(typeof orbitModule.fitSlimeZoom, 'function');
  for (const yaw of [0, Math.PI / 2, Math.PI]) {
    const camera = new PerspectiveCamera(32, 1.6, 0.1, 40);
    camera.position.set(Math.sin(yaw) * 8.46, 2.5, Math.cos(yaw) * 8.46);
    camera.lookAt(0, 1.27, 0);
    camera.updateMatrixWorld();
    const s = new SlimeDynamics();
    s.puff = s.pose.puff = 1;
    s.grab(0, 0, { x: 0, y: 1.4, z: 1.1 });
    s.dragTo(1.5, 1.5, 0.8);
    for (let frame = 0; frame < 50; frame++) {
      s.advance(1 / 120);
      camera.zoom = orbitModule.fitSlimeZoom(camera, s);
      camera.updateProjectionMatrix();
      for (let i = 0; i <= 24; i++)
        for (let j = 0; j < 16; j++) {
          const t = -Math.cos((i * Math.PI) / 24),
            a = (j * Math.PI) / 8;
          const p = s.deform(
            1.64 * radiusAt(t) * Math.cos(a),
            heightAt(t),
            1.18 * radiusAt(t) * Math.sin(a),
          );
          const screen = new Vector3(p.x + s.x, p.y + s.y, p.z + s.z).project(
            camera,
          );
          assert.ok(
            Math.abs(screen.x) < 0.98 && Math.abs(screen.y) < 0.98,
            `clipped frame ${frame}, view ${yaw}: ${screen.x},${screen.y}`,
          );
        }
    }
  }
});
