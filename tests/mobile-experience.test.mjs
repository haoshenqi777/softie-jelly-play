import test from 'node:test';
import assert from 'node:assert/strict';
import * as input from '../lib/touch-orbit.ts';
import * as framing from '../lib/studio-camera.ts';
import { PerspectiveCamera, Vector3 } from 'three';

test('a burst of moves applies the newest position before simulation, with no old backlog', () => {
  assert.equal(typeof input.FramePointerInput, 'function');
  const queue = new input.FramePointerInput();
  const seen = [];
  for (let i = 0; i < 240; i++) queue.push({ pointerId: 1, clientX: i });
  queue.push({ pointerId: 2, clientX: 900 });
  queue.flush((e) => seen.push([e.pointerId, e.clientX]));
  assert.deepEqual(seen, [
    [1, 239],
    [2, 900],
  ]);
  queue.flush((e) => seen.push(e));
  assert.equal(seen.length, 2);
  queue.push({ pointerId: 1, clientX: 400 });
  queue.clear();
  queue.flush((e) => seen.push(e));
  assert.equal(
    seen.length,
    2,
    'cancelled moves must never resume a released drag',
  );
});

test('mobile resting frame is larger, with stable framing through ordinary jiggle', () => {
  assert.equal(typeof framing.FixedStudioFrame, 'function');
  const frame = new framing.FixedStudioFrame();
  const aspect = 393 / 617;
  const normal = framing.studioCameraDistance(aspect);
  const rest = {
    min: { x: -1.62, y: 0, z: -1.2 },
    max: { x: 1.62, y: 2.32, z: 1.2 },
  };
  const values = [];
  for (let i = 0; i < 300; i++) {
    const box = {
      min: { ...rest.min },
      max: { ...rest.max, y: 2.32 + Math.sin(i) * 0.04 },
    };
    values.push(frame.update(1 / 60, aspect, 0, 0.18, 1, box, false));
  }
  assert.ok(
    values.at(-1) < normal * 0.96,
    'resting character should be visibly larger',
  );
  assert.ok(
    Math.max(...values) - Math.min(...values) < 0.002,
    'jiggle must not pump the lens',
  );
});

test('fixed camera contains high jumps in portrait and landscape and freezes during a grip', () => {
  assert.equal(typeof framing.FixedStudioFrame, 'function');
  for (const aspect of [393 / 617, 320 / 485, 844 / 285]) {
    const frame = new framing.FixedStudioFrame();
    const camera = new PerspectiveCamera(30, aspect, 0.1, 100);
    for (const y of [0, 0.2, 1, 2, 4.6, 3, 0]) {
      const box = {
        min: { x: -1.7, y, z: -1.2 },
        max: { x: 1.7, y: y + 2.32, z: 1.2 },
      };
      const distance = frame.update(1 / 60, aspect, 0, 0.18, 1, box, false);
      camera.position.set(
        0,
        framing.MOBILE_TARGET_Y + Math.sin(0.18) * distance,
        Math.cos(0.18) * distance,
      );
      camera.lookAt(0, framing.MOBILE_TARGET_Y, 0);
      camera.updateMatrixWorld();
      for (const x of [box.min.x, box.max.x])
        for (const by of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const p = new Vector3(x, by, z).project(camera);
            assert.ok(
              Math.abs(p.x) <= 0.94 && Math.abs(p.y) <= 0.94,
              `cropped at ${aspect}, ${y}: ${p.toArray()}`,
            );
          }
      const held = frame.update(
        1 / 60,
        aspect,
        0,
        0.18,
        1,
        { min: { x: -4, y: 0, z: -4 }, max: { x: 4, y: 9, z: 4 } },
        true,
      );
      assert.equal(
        held,
        distance,
        'the grab plane must remain stable while a finger owns the body',
      );
    }
  }
});

test('manual pinch responds in the next frame instead of waiting for automatic lens recovery', () => {
  const frame = new framing.FixedStudioFrame();
  const rest = {
    min: { x: -1.62, y: 0, z: -1.47 },
    max: { x: 1.62, y: 2.32, z: 1.47 },
  };
  const before = frame.update(1 / 60, 393 / 617, 0, 0.18, 1, rest, false);
  const after = frame.update(1 / 60, 393 / 617, 0, 0.18, 0.85, rest, false);
  assert.ok(
    after < before * 0.9,
    `pinch did not respond: ${before} -> ${after}`,
  );
  const distant = frame.update(1 / 60, 393 / 617, 0, 0.18, 1.2, rest, false);
  assert.ok(distant > before * 1.1);
});

test('close manual zoom still contains the highest jump', () => {
  for (const aspect of [393 / 617, 844 / 316]) {
    const frame = new framing.FixedStudioFrame();
    const box = {
      min: { x: -1.7, y: 4.6, z: -1.47 },
      max: { x: 1.7, y: 6.92, z: 1.47 },
    };
    const distance = frame.update(1 / 60, aspect, 0, 0.18, 0.85, box, false);
    const camera = new PerspectiveCamera(30, aspect, 0.1, 100);
    camera.position.set(
      0,
      framing.MOBILE_TARGET_Y + Math.sin(0.18) * distance,
      Math.cos(0.18) * distance,
    );
    camera.lookAt(0, framing.MOBILE_TARGET_Y, 0);
    camera.updateMatrixWorld();
    for (const x of [-1.7, 1.7])
      for (const y of [4.6, 6.92])
        for (const z of [-1.47, 1.47]) {
          const p = new Vector3(x, y, z).project(camera);
          assert.ok(Math.abs(p.x) < 0.94 && Math.abs(p.y) < 0.94);
        }
  }
});
