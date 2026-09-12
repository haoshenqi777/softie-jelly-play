import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { STUDIO_TARGET_Y, studioCameraDistance } from '../lib/studio-camera.ts';

test('all authored poses stay inside narrow and desktop viewports while orbiting', () => {
  const file = readFileSync(
    new URL('../public/models/slime-studio.glb', import.meta.url),
  );
  const jsonLength = file.readUInt32LE(12);
  const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
  const binaryStart = 28 + jsonLength;
  const primitive =
    gltf.meshes[gltf.nodes.find((n) => n.name === 'Gel').mesh].primitives[0];
  const readPosition = (index) => {
    const a = gltf.accessors[index],
      b = gltf.bufferViews[a.bufferView];
    return Array.from({ length: a.count }, (_, i) =>
      Array.from({ length: 3 }, (_, k) =>
        file.readFloatLE(
          binaryStart +
            (b.byteOffset || 0) +
            (a.byteOffset || 0) +
            i * (b.byteStride || 12) +
            k * 4,
        ),
      ),
    );
  };
  const base = readPosition(primitive.attributes.POSITION);
  const deltas = primitive.targets.map((t) => readPosition(t.POSITION));
  const point = new Vector3();
  for (const aspect of [284 / 360, 311 / 370, 1.07, 1.5]) {
    const camera = new PerspectiveCamera(30, aspect, 0.1, 40);
    const distance = studioCameraDistance(aspect);
    for (const pitch of [-0.01, 0.12, 0.55])
      for (let step = 0; step < 16; step++) {
        const yaw = (step * Math.PI) / 8;
        camera.position.set(
          Math.sin(yaw) * Math.cos(pitch) * distance,
          STUDIO_TARGET_Y + Math.sin(pitch) * distance,
          Math.cos(yaw) * Math.cos(pitch) * distance,
        );
        camera.lookAt(0, STUDIO_TARGET_Y, 0);
        camera.updateMatrixWorld();
        for (const weights of [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
          [0, 0, 1],
          [1, 0, 1],
        ])
          for (let i = 0; i < base.length; i++) {
            point.fromArray(base[i]);
            for (let m = 0; m < 3; m++)
              if (weights[m]) {
                point.x += deltas[m][i][0];
                point.y += deltas[m][i][1];
                point.z += deltas[m][i][2];
              }
            point.project(camera);
            assert.ok(
              Math.abs(point.x) < 0.95 && Math.abs(point.y) < 0.95,
          `cropped pose: aspect=${aspect}, pitch=${pitch}, yaw=${yaw}, weights=${String(weights)}`,
            );
          }
      }
  }
});
