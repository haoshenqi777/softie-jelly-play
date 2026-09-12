import test from 'node:test';
import assert from 'node:assert/strict';
import { DataUtils, HalfFloatType, NoColorSpace } from 'three/webgpu';
import { linearCaptureFromPixels } from '../lib/gel-linear-capture.ts';

test('capture conversion preserves linear color, alpha and image orientation', () => {
  const t = linearCaptureFromPixels(
    new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 128, 128, 128, 128, 252, 0, 0, 255, 0,
    ]),
    2,
    2,
  );
  const d = [...t.image.data].map((value) => DataUtils.fromHalfFloat(value));
  assert.ok(Math.abs(d[0] - 0.21586) < 0.0003);
  assert.ok(Math.abs(d[3] - 252 / 255) < 0.0005);
  assert.deepEqual(d.slice(4, 8), [0, 0, 1, 0]);
  assert.deepEqual(d.slice(8, 12), [1, 0, 0, 1]);
  assert.equal(t.flipY, false);
  assert.equal(t.generateMipmaps, false);
  assert.equal(t.type, HalfFloatType);
  assert.equal(t.colorSpace, NoColorSpace);
  t.dispose();
});

test('conversion retains odd-sized image dimensions without resampling', () => {
  const pixels = new Uint8ClampedArray(3 * 5 * 4).fill(255);
  const t = linearCaptureFromPixels(pixels, 3, 5);
  assert.equal(t.image.width, 3);
  assert.equal(t.image.height, 5);
  assert.ok([...t.image.data].every((v) => DataUtils.fromHalfFloat(v) === 1));
  t.dispose();
});
