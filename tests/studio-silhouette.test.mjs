import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function asset() {
  const file = readFileSync(
    new URL('../public/models/slime-studio.glb', import.meta.url),
  );
  const size = file.readUInt32LE(12);
  const gltf = JSON.parse(file.subarray(20, 20 + size).toString());
  const node = gltf.nodes.find((n) => n.name === 'Gel');
  const primitive = gltf.meshes[node.mesh].primitives[0];
  const accessor = gltf.accessors[primitive.attributes.POSITION];
  const buffer = gltf.bufferViews[accessor.bufferView];
  const rows = new Map();
  for (let i = 0; i < accessor.count; i++) {
    const offset =
      28 +
      size +
      (buffer.byteOffset || 0) +
      (accessor.byteOffset || 0) +
      i * (buffer.byteStride || 12);
    const x = file.readFloatLE(offset),
      y = file.readFloatLE(offset + 4),
      z = file.readFloatLE(offset + 8);
    const key = y.toFixed(6),
      row = rows.get(key) || { y, x: 0, z: 0 };
    row.x = Math.max(row.x, Math.abs(x));
    row.z = Math.max(row.z, Math.abs(z));
    rows.set(key, row);
  }
  return {
    rows: [...rows.values()].sort((a, b) => a.y - b.y),
    profile: JSON.parse(node.extras.optical_profile),
  };
}

test('exported front and side silhouettes follow approved image measurements', () => {
  const target = JSON.parse(
    readFileSync(
      new URL(
        './fixtures/approved-turnaround-silhouette.json',
        import.meta.url,
      ),
    ),
  );
  const { rows } = asset(),
    height = rows.at(-1).y;
  for (const [name, axis] of [
    ['front', 'x'],
    ['side', 'z'],
  ]) {
    for (const [h, radius] of target.views[name]) {
      const index = rows.findIndex((r) => r.y >= h * height),
        a = rows[index - 1],
        b = rows[index];
      const t = (h * height - a.y) / (b.y - a.y);
      const actual =
        (a[axis] + t * (b[axis] - a[axis])) / (height / 1.03) / 1.075;
      // About 3px at source size; excludes reflection-contaminated bottom 10%.
      assert.ok(
        Math.abs(actual - radius) < 0.007,
        `${name} h=${h}: actual ${actual}, measured ${radius}`,
      );
    }
  }
});

test('crown-to-shoulder transition is continuous and never pinches into a neck', () => {
  const { profile } = asset(),
    height = profile.at(-1)[3];
  for (const axis of [0, 4]) {
    let previous;
    for (let i = 1; i < profile.length - 1; i++) {
      const h = profile[i + 1][3] - profile[i][3],
        y = profile[i][3] / height;
      const first = (profile[i + 1][axis] - profile[i - 1][axis]) / (2 * h);
      const second =
        (profile[i + 1][axis] - 2 * profile[i][axis] + profile[i - 1][axis]) /
        (h * h);
      const curvature = -second / (1 + first * first) ** 1.5;
      assert.ok(Number.isFinite(curvature));
      if (y > 0.4) assert.ok(first < 0, `neck or attached cap at ${y}`);
      // The approved crown has a gentle inflection; global convexity would erase it.
      if (previous !== undefined && y > 0.1 && y < 0.96)
        assert.ok(
          Math.abs(curvature - previous) < 0.18,
          `curvature seam at ${y}`,
        );
      previous = curvature;
    }
  }
});
