import test from 'node:test';
import assert from 'node:assert/strict';
import * as camera from '../lib/softbody/rendezvous.ts';

test('slow camera orbit remains moving at 30, 60 and 120 Hz, then becomes quiet', () => {
  assert.equal(typeof camera.cameraDirectionMoving, 'function');
  for (const hz of [30, 60, 120]) {
    const dt = 1 / hz;
    let previous = [0, 0, 1];
    for (let i = 1; i <= hz; i++) {
      const angle = i * dt * 0.1;
      const next = [Math.sin(angle), 0, Math.cos(angle)];
      assert.equal(
        camera.cameraDirectionMoving(previous, next, dt),
        true,
        `${hz} Hz`,
      );
      previous = next;
    }
    assert.equal(camera.cameraDirectionMoving(previous, previous, dt), false);
  }
});
