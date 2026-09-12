import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ContactSkin } from '../lib/softbody/contact-skin.ts';
import { characterFixture } from './softbody-fixture.mjs';
import * as THREE from 'three/webgpu';
import { ContactShell } from '../lib/softbody/contact-shell.ts';
import { VolumeSoftBody } from '../lib/softbody/solver.ts';

test('accelerated skin preserves every correction and fixed boundary through repeated rebinds', async () => {
  const f = characterFixture(),
    rest = f.body.attributes.position.array,
    index = f.body.index.array;
  const js = new ContactSkin(rest, index),
    native = new ContactSkin(rest, index);
  assert.equal(typeof native.accelerate, 'function');
  await native.accelerate(
    readFileSync(
      new URL('../public/physics/contact-skin.wasm', import.meta.url),
    ),
  );
  for (const height of [0.8, 2, 0.8]) {
    const mask = Float64Array.from({ length: rest.length / 3 }, (_, i) =>
      Math.hypot(rest[i * 3], rest[i * 3 + 1] - height, rest[i * 3 + 2] - 0.7) <
      0.8
        ? 1
        : 0,
    );
    for (const skin of [js, native]) {
      skin.bind(mask);
      skin.prepare((i, out) => {
        for (let a = 0; a < 3; a++) out[a] = rest[i * 3 + a];
      });
    }
    const a = Float64Array.from(rest, (_, i) =>
        mask[Math.floor(i / 3)] ? Math.sin(i * 0.73) * 0.012 : 0,
      ),
      b = a.slice();
    for (let pass = 0; pass < 12; pass++) {
      js.solve(a);
      native.solve(b);
      let error = 0;
      for (let i = 0; i < a.length; i++)
        error = Math.max(error, Math.abs(a[i] - b[i]));
      assert.ok(error < 1e-8, `height ${height} pass ${pass} error ${error}`);
      for (let i = 0; i < a.length; i++)
        if (!mask[Math.floor(i / 3)]) assert.equal(b[i], 0);
    }
  }
});

test('native wet contact preserves rotated gummy collision, fixed boundary, and coverage', async () => {
  const f = characterFixture(),
    p = f.body.attributes.position.array,
    n = f.body.attributes.normal.array,
    index = f.body.index.array;
  const hit = new THREE.Raycaster(
    new THREE.Vector3(0, 1, 5),
    new THREE.Vector3(0, 0, -1),
  ).intersectObject(new THREE.Mesh(f.body))[0];
  const states = [0, 1].map(() => ({
    shell: new ContactShell(f.cage, p, n, index, { supported: false }),
    solver: new VolumeSoftBody(f.cage),
  }));
  for (const { shell, solver } of states) {
    shell.setRegion(hit.point.toArray());
    shell.rim.bind(p, hit.point.toArray(), [0, 0, 1], 0.18);
    shell.skin.bind(shell.rim.movable);
    shell.candy.position.set(hit.point.toArray());
    shell.candy.target.set(shell.candy.position);
    shell.candy.compression = 0.18;
    shell.candy.compressionAxis.set([0.6, 0.8, 0]);
    shell.candy.rotation.set([0, Math.sin(0.3), 0, Math.cos(0.3)]);
    shell.rim.point.set(hit.point.toArray());
    shell.rim.normal.set([0, 0, 1]);
    shell.rim.amount = 0.8;
    for (let i = 0; i < shell.rim.offset.length; i++)
      if (shell.rim.movable[Math.floor(i / 3)])
        shell.rim.offset[i] = Math.sin(i * 0.73) * 0.007;
    shell.beginStep(1 / 240, solver);
  }
  // Activation after a bind/step must also synchronize all native buffers.
  await states[1].shell.skin.accelerate(
    readFileSync(
      new URL('../public/physics/contact-skin.wasm', import.meta.url),
    ),
  );
  for (let tick = 0; tick < 8; tick++) {
    for (const { shell, solver } of states)
      shell.regularize(1 / 240, solver, 1);
    const [a, b] = states.map((s) => s.shell);
    let error = 0;
    for (let i = 0; i < a.rim.offset.length; i++)
      error = Math.max(error, Math.abs(a.rim.offset[i] - b.rim.offset[i]));
    assert.ok(error < 1e-10, `projection error ${error}`);
    assert.equal(a.rim.coverage, b.rim.coverage);
    assert.equal(a.stats().contacts, b.stats().contacts);
    assert.ok(b.stats().contacts > 0);
  }
});
