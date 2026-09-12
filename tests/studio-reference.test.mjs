import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  STUDIO_TARGET_Y,
  STUDIO_VIEW_YAW,
  studioCameraDistance,
} from '../lib/studio-camera.ts';

test('Cycles reference images match the shipped model and web camera presets', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url));
  const manifest = JSON.parse(read('../public/reference/cycles/manifest.json'));
  const recipe = JSON.parse(read('../assets/studio-cycles-recipe.json'));
  const hash = createHash('sha256')
    .update(read('../public/models/slime-studio.glb'))
    .digest('hex');
  assert.equal(manifest.engine, 'Cycles');
  assert.equal(
    manifest.sourceGLBSHA256,
    hash,
    'rerender references when the actual asset changes',
  );
  assert.deepEqual(manifest.recipe, recipe);
  assert.equal(recipe.camera.targetY, STUDIO_TARGET_Y);
  assert.ok(manifest.samples >= recipe.samples);
  assert.deepEqual(
    manifest.views.map((v) => [v.name, v.pose]),
    [
      ['front', 'rest'],
      ['three-quarter', 'rest'],
      ['side', 'rest'],
      ['squash', 'squash'],
    ],
  );
  const distance = studioCameraDistance(
    recipe.resolution[0] / recipe.resolution[1],
  );
  for (const view of manifest.views) {
    assert.equal(
      view.yaw,
      STUDIO_VIEW_YAW[view.name === 'squash' ? 'three-quarter' : view.name],
    );
    const png = read(`../public/reference/cycles/${view.name}.png`);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual(
      [png.readUInt32BE(16), png.readUInt32BE(20)],
      recipe.resolution,
    );
    assert.ok(Math.abs(view.distance - distance) < 1e-8);
    const [x, y, z] = view.positionYUp;
    assert.ok(Math.abs(Math.atan2(x, z) - view.yaw) < 1e-8);
    assert.ok(
      Math.abs(
        y - recipe.camera.targetY - Math.sin(recipe.camera.pitch) * distance,
      ) < 1e-8,
    );
  }
});
