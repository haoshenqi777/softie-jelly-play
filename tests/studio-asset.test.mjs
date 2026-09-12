import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function readStudio() {
  const data = readFileSync(
    new URL('../public/models/slime-studio.glb', import.meta.url),
  );
  assert.equal(data.readUInt32LE(0), 0x46546c67);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
  const node = (name) => json.nodes.find((n) => n.name === name);
  const mesh = (name) => json.meshes[node(name)?.mesh];
  const positions = (index) => {
    const accessor = json.accessors[index];
    const view = json.bufferViews[accessor.bufferView];
    assert.equal(accessor.componentType, 5126, 'uncompressed float positions');
    assert.equal(accessor.type, 'VEC3');
    return Array.from({ length: accessor.count }, (_, i) =>
      Array.from({ length: 3 }, (_, axis) =>
        data.readFloatLE(
          28 +
            jsonLength +
            (view.byteOffset || 0) +
            (accessor.byteOffset || 0) +
            i * (view.byteStride || 12) +
            axis * 4,
        ),
      ),
    );
  };
  const posed = (name, pose) => {
    const item = mesh(name);
    const primitive = item.primitives[0];
    const base = positions(primitive.attributes.POSITION);
    if (pose === 'Rest') return base;
    const index = item.extras.targetNames.indexOf(pose);
    assert.ok(index >= 0, `${name} has ${pose}`);
    const delta = positions(primitive.targets[index].POSITION);
    return base.map((p, i) => p.map((value, axis) => value + delta[i][axis]));
  };
  return { json, node, mesh, posed };
}

// Recover the authored cross-sections from the exported vertices. These are
// independent of the Python radius curves and remain valid after fitting them.
function sections(points) {
  const rows = new Map();
  for (const [x, y, z] of points) {
    assert.ok([x, y, z].every(Number.isFinite), 'finite deformed positions');
    const key = y.toFixed(5);
    if (!rows.has(key))
      rows.set(key, { y, minX: x, maxX: x, minZ: z, maxZ: z });
    const row = rows.get(key);
    row.minX = Math.min(row.minX, x);
    row.maxX = Math.max(row.maxX, x);
    row.minZ = Math.min(row.minZ, z);
    row.maxZ = Math.max(row.maxZ, z);
  }
  return [...rows.values()].sort((a, b) => a.y - b.y);
}

function sectionAt(rows, y) {
  assert.ok(
    y >= rows[0].y - 1e-5 && y <= rows.at(-1).y + 1e-5,
    `point at y=${y} is within the body height`,
  );
  let upper = rows.findIndex((row) => row.y >= y);
  if (upper < 0) upper = rows.length - 1;
  const a = rows[Math.max(0, upper - 1)],
    b = rows[upper];
  const t = a === b ? 0 : Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y)));
  const value = (key) => a[key] + (b[key] - a[key]) * t;
  return {
    x: (value('minX') + value('maxX')) / 2,
    z: (value('minZ') + value('maxZ')) / 2,
    rx: (value('maxX') - value('minX')) / 2,
    rz: (value('maxZ') - value('minZ')) / 2,
  };
}

test('resting asset matches the user-approved turnaround dimensions with explicit perspective calibration', () => {
  const { posed } = readStudio();
  const bounds = (p) =>
    [0, 1, 2].map((k) => [
      Math.min(...p.map((v) => v[k])),
      Math.max(...p.map((v) => v[k])),
    ]);
  const body = bounds(posed('Gel', 'Rest'));
  const actualHeight = body[1][1] - body[1][0];
  assert.ok(
    Math.abs(actualHeight - 2.3175) < 0.0001,
    'requested 3% height increase',
  );
  const height = actualHeight / 1.03;
  assert.ok(
    Math.abs((body[0][1] - body[0][0]) / height / 1.075 - 1.3363) < 0.006,
    'approved front width / height',
  );
  assert.ok(
    Math.abs((body[2][1] - body[2][0]) / height / 1.075 - 1.2059) < 0.006,
    'approved side depth / height',
  );
  const left = bounds(posed('Eye.L', 'Rest')),
    right = bounds(posed('Eye.R', 'Rest'));
  assert.ok(
    Math.abs(
      (right[0][0] + right[0][1] - (left[0][0] + left[0][1])) /
        (2 * height) /
        0.94 -
        0.46749,
    ) < 0.004,
    'approved eye spacing',
  );
  assert.ok(
    Math.abs((left[1][0] + left[1][1]) / (2 * actualHeight) - 0.045 - 0.23543) <
      0.004,
    'approved low eye height',
  );
  assert.ok(
    Math.abs((left[0][1] - left[0][0]) / height - 0.11995) < 0.004,
    'approved round bean-eye width',
  );
});

test('exported character records the exact static shape recipe', () => {
  const { node } = readStudio();
  const recipe = readFileSync(
    new URL('../assets/slime-rest-shape.json', import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n');
  assert.equal(node('Gel').extras.shape_revision, JSON.parse(recipe).revision);
  assert.equal(
    node('Gel').extras.shape_recipe_sha256,
    createHash('sha256').update(recipe).digest('hex'),
    're-export the shared asset after changing the authored curves',
  );
});

test('studio GLB contains a volumetric character with a small low face and shared poses', () => {
  const { json, mesh } = readStudio();
  for (const name of ['Gel', 'Eye.L', 'Eye.R', 'Smile']) {
    const item = mesh(name);
    assert.ok(item, name);
    assert.deepEqual(item.extras.targetNames, ['Breathe', 'Squash', 'Puff']);
    const a = json.accessors[item.primitives[0].attributes.POSITION];
    assert.ok([...a.min, ...a.max].every(Number.isFinite));
    assert.equal(item.primitives[0].targets.length, 3);
  }
  const body = json.accessors[mesh('Gel').primitives[0].attributes.POSITION];
  assert.ok(body.count < 25000, 'bounded refined surface density');
  assert.ok(
    Math.abs(body.max[0] + body.min[0]) < 0.002,
    'front silhouette is centered',
  );
  const opticalProfile = JSON.parse(
    json.nodes.find((n) => n.name === 'Gel').extras.optical_profile,
  );
  assert.ok(
    Math.max(...opticalProfile.map((p) => Math.abs(p[2]))) < 0.08,
    'resting crown stays above the contact patch, without a baked leaning pose',
  );
  assert.ok(
    body.max[2] - body.min[2] > 2,
    'a substantial depth, not a flattened disc',
  );
  const eye = json.accessors[mesh('Eye.L').primitives[0].attributes.POSITION];
  assert.ok(eye.max[1] < body.max[1] * 0.37, 'low face');
  assert.ok(
    eye.max[0] - eye.min[0] < (body.max[0] - body.min[0]) * 0.09,
    'small eyes',
  );
});

test('Puff returns every exported cross-section to the same rounded depth/width ratio', () => {
  const { posed } = readStudio();
  const rows = sections(posed('Gel', 'Puff'));
  const rings = rows.filter((row) => row.maxX - row.minX > 0.02);
  assert.ok(
    rings.length >= 20,
    'check the whole meridian, not only its bounds',
  );
  for (const row of rings) {
    const ratio = (row.maxZ - row.minZ) / (row.maxX - row.minX);
    assert.ok(
      Math.abs(ratio - 0.9) < 0.0001,
      `Puff depth/width=${ratio} at y=${row.y}; scale the two rest axes independently`,
    );
  }
});

test('face vertices stay attached to the same body coordinates through all morphs', () => {
  const { posed } = readStudio();
  const restingBody = sections(posed('Gel', 'Rest'));
  const faces = ['Eye.L', 'Eye.R', 'Smile'].map((name) => ({
    name,
    rest: posed(name, 'Rest'),
  }));
  for (const { name, rest } of faces)
    for (const [index, point] of rest.entries()) {
      const row = sectionAt(restingBody, point[1]);
      const u = (point[0] - row.x) / row.rx;
      assert.ok(Math.abs(u) < 1, `${name} vertex ${index} lies over the body`);
      const skin = row.z + row.rz * Math.sqrt(1 - u * u);
      assert.ok(
        Math.abs(point[2] - skin) < 0.12,
        `${name} vertex ${index} no longer hugs the resting surface`,
      );
    }
  for (const pose of ['Breathe', 'Squash', 'Puff']) {
    const body = sections(posed('Gel', pose));
    for (const { name, rest } of faces) {
      const deformed = posed(name, pose);
      for (let i = 0; i < rest.length; i++) {
        const a = sectionAt(restingBody, rest[i][1]);
        const b = sectionAt(body, deformed[i][1]);
        const restU = (rest[i][0] - a.x) / a.rx;
        const restV = (rest[i][2] - a.z) / a.rz;
        const movedU = (deformed[i][0] - b.x) / b.rx;
        const movedV = (deformed[i][2] - b.z) / b.rz;
        // Body rings and face vertices use different heights. Allow their small
        // linear-interpolation error without hiding a wrong depth scale.
        assert.ok(
          Math.abs(restU - movedU) < 0.004 && Math.abs(restV - movedV) < 0.004,
          `${name} vertex ${i} detaches in ${pose}: delta=(${movedU - restU}, ${movedV - restV})`,
        );
      }
    }
  }
});

test('bubble surface samples stay inside the exported body in every authored pose', () => {
  const { node, posed } = readStudio();
  const bubbles = JSON.parse(node('Gel').extras.bubble_data);
  assert.ok(bubbles.length > 0);
  const directions = [];
  for (const x of [-1, 0, 1])
    for (const y of [-1, 0, 1])
      for (const z of [-1, 0, 1]) {
        const length = Math.hypot(x, y, z);
        if (length) directions.push([x / length, y / length, z / length]);
      }
  for (const [poseIndex, pose] of [
    'Rest',
    'Breathe',
    'Squash',
    'Puff',
  ].entries()) {
    const body = sections(posed('Gel', pose));
    for (const [index, bubble] of bubbles.entries()) {
      const center = poseIndex === 0 ? bubble.p : bubble.poses[poseIndex - 1];
      assert.ok(bubble.r > 0 && Number.isFinite(bubble.r));
      assert.ok(center.length === 3 && center.every(Number.isFinite));
      for (const direction of [[0, 0, 0], ...directions]) {
        const point = center.map(
          (value, axis) => value + bubble.r * direction[axis],
        );
        const row = sectionAt(body, point[1]);
        // The GLB connects dense elliptical rings with triangles. A 0.006-unit
        // allowance covers interpolation/tessellation, not a visibly escaped bubble.
        const rho = Math.hypot(
          (point[0] - row.x) / (row.rx + 0.006),
          (point[2] - row.z) / (row.rz + 0.006),
        );
        assert.ok(
          rho <= 1,
          `bubble ${index} protrudes in ${pose} at ${String(point)}: normalized radius=${rho}`,
        );
      }
    }
  }
});
