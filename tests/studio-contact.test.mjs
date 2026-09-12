import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { StudioContact } from '../lib/studio-contact.ts';
import { characterFixture } from './softbody-fixture.mjs';
import { inverseCandyCompression } from '../lib/candy-deformation.ts';

function assertContactFaces(study, body) {
  const p = body.geometry.attributes.position.array,
    index = body.geometry.index.array,
    rim = study.shell.rim,
    candy = study.shell.candy,
    inverse = new THREE.Quaternion().fromArray(candy.rotation).invert(),
    center = new THREE.Vector3().fromArray(candy.position),
    sample = new Float64Array(3);
  let checked = 0;
  for (let j = 0; j < index.length; j += 3) {
    const ids = [index[j], index[j + 1], index[j + 2]];
    if (!ids.some((id) => rim.weight[id] > 0.01)) continue;
    const points = ids.map((id) => new THREE.Vector3().fromArray(p, id * 3));
    const base = points.map((v, k) =>
      v.clone().sub(new THREE.Vector3().fromArray(rim.offset, ids[k] * 3)),
    );
    const q = points[0]
      .clone()
      .add(points[1])
      .add(points[2])
      .multiplyScalar(1 / 3)
      .sub(center);
    inverseCandyCompression(
      q.x,
      q.y,
      q.z,
      candy.compression,
      candy.compressionAxis,
      sample,
    );
    q.fromArray(sample).applyQuaternion(inverse);
    const h = candy.half - candy.radius,
      a = Math.abs(q.x) - h,
      b = Math.abs(q.y) - h,
      c = Math.abs(q.z) - h;
    const sdf =
      Math.hypot(Math.max(a, 0), Math.max(b, 0), Math.max(c, 0)) +
      Math.min(Math.max(a, b, c), 0) -
      candy.radius;
    assert.ok(
      sdf >= -0.002,
      'contact triangle centre must stay outside solid candy: ' + sdf,
    );
    const before = base[1].sub(base[0]).cross(base[2].sub(base[0])).length();
    const after = points[1]
      .sub(points[0])
      .cross(points[2].sub(points[0]))
      .length();
    assert.ok(
      after >= before * 0.1,
      'wrapping cannot collapse a triangle into a crease',
    );
    checked++;
  }
  assert.ok(checked > 100);
}

async function fixture() {
  const f = characterFixture(),
    body = new THREE.Mesh(f.body);
  body.userData.optical_profile = JSON.stringify(f.profile);
  const parts = ['Eye.L', 'Eye.R', 'Smile'].map((name) => {
    const m = new THREE.Mesh(f.geometry(name));
    m.name = name;
    return m;
  });
  const scene = new THREE.Scene();
  scene.add(body, ...parts);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, 2.1, 8);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  let captured = null;
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    setPointerCapture: (id) => {
      captured = id;
    },
    hasPointerCapture: (id) => captured === id,
    releasePointerCapture: () => {
      captured = null;
    },
  };
  const texture = new THREE.Texture();
  const study = new StudioContact(
    canvas,
    camera,
    body,
    parts,
    f.bubbles,
    scene,
    texture,
  );
  await study.solver.accelerate(
    readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
  );
  const tick = (seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) study.update(1 / 60);
  };
  const close = () => {
    study.dispose();
    texture.dispose();
    body.geometry.dispose();
    parts.forEach((p) => p.geometry.dispose());
  };
  return { study, scene, parts, body, camera, canvas, tick, close };
}

test('contact corrections at the patch boundary never write invisible fixed offsets', async () => {
  const { study, body, close } = await fixture();
  try {
    const shell = study.shell,
      rim = shell.rim,
      index = body.geometry.index.array,
      p = body.geometry.attributes.position.array;
    let t = -1;
    for (let i = 0; i < index.length; i += 3) {
      const count =
        rim.movable[index[i]] +
        rim.movable[index[i + 1]] +
        rim.movable[index[i + 2]];
      if (count > 0 && count < 3) {
        t = i;
        break;
      }
    }
    assert.ok(t >= 0, 'a real mixed material boundary exists');
    for (let a = 0; a < 3; a++)
      shell.candy.position[a] =
        (p[index[t] * 3 + a] +
          p[index[t + 1] * 3 + a] +
          p[index[t + 2] * 3 + a]) /
        3;
    shell.candy.target.set(shell.candy.position);
    rim.amount = 1;
    shell.beginStep(1 / 120, study.solver);
    shell.projectFaces(study.solver, 1);
    let changed = 0;
    for (let i = 0; i < rim.movable.length; i++)
      for (let a = 0; a < 3; a++) {
        if (rim.movable[i]) changed += Math.abs(rim.offset[i * 3 + a]);
        else
          assert.equal(
            rim.offset[i * 3 + a],
            0,
            'fixed vertex must not hold unrendered contact displacement',
          );
      }
    assert.ok(changed > 0, 'the boundary contact was actually exercised');
  } finally {
    close();
  }
});

test('visible face progresses through contact and relief; new site waits for actual contact', async () => {
  const { study, parts, tick, close } = await fixture();
  try {
    tick(0.3);
    const initial = parts[2].geometry.attributes.position.array.slice();
    study.configure({ depth: 85 });
    tick(0.8);
    assert.equal(study.stats().face, 'effort');
    assert.ok(
      study.expression.stats().phaseAge > 0.3,
      'held expression timer must advance through delayed mouth channels',
    );
    const mouth = parts[2].geometry.attributes.position.array;
    assert.ok(
      Math.max(...mouth.map((v, i) => Math.abs(v - initial[i]))) > 0.015,
      'mouth changes visibly',
    );
    study.configure({ location: 'crown', depth: 85 });
    study.update(1 / 60);
    assert.equal(study.stats().contacts, 0);
    assert.equal(
      study.stats().face,
      'curious',
      'old front dent must not trigger crown contact',
    );
    tick(0.8);
    assert.equal(study.stats().face, 'effort');
    study.configure({ depth: 0 });
    tick(0.2);
    assert.equal(study.stats().face, 'soothed');
    tick(2);
    assert.equal(study.stats().face, 'curious');
    assert.ok(study.stats().indent < 0.008);
  } finally {
    close();
  }
});

test('visible body wins over candy hidden behind it; cancellation releases pressure', async () => {
  const { study, scene, body, camera, canvas, tick, close } = await fixture();
  try {
    study.configure({ location: 'side' });
    tick(0.1);
    const candy = scene.getObjectByName('ContactStudy.Candy');
    camera.position.set(6, candy.position.y, candy.position.z);
    camera.lookAt(candy.position);
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(), camera);
    assert.ok(
      ray.intersectObject(body)[0].distance <
        ray.intersectObject(candy)[0].distance,
    );
    const event = {
      button: 0,
      buttons: 1,
      pointerId: 7,
      pointerType: 'mouse',
      clientX: 200,
      clientY: 200,
      preventDefault() {},
    };
    assert.equal(study.pointerDown(event), true);
    assert.equal(study.stats().location, 'custom');
    assert.ok(
      study.shell.candy.position[0] > 0,
      'retarget the visible near side',
    );
    assert.equal(canvas.hasPointerCapture(7), true);
    tick(0.3);
    study.pointerMove({ ...event, buttons: 0 });
    assert.equal(study.held, false);
    assert.equal(canvas.hasPointerCapture(7), false);
    assert.equal(study.stats().depth, 0);
    tick(2);
    assert.ok(study.stats().indent < 0.008);
  } finally {
    close();
  }
});

for (const location of ['front', 'side', 'crown'])
  test(`${location}: intake closes skin before eroding a visible internal core`, async () => {
    const { study, tick, scene, body, close } = await fixture();
    try {
      study.configure({ location });
      study.configure({ intake: 'start' });
      assert.equal(
        study.stats().intake?.stage,
        'pressing',
        'start enters the measured absorption flow',
      );
      const seen = new Set();
      let eroded = false,
        maxJump = 0;
      let previous = Array.from(study.shell.candy.position);
      for (let i = 0; i < 1300; i++) {
        study.update(1 / 60);
        const s = study.stats();
        if (s.intake.stage === 'entering' && !seen.has('entering'))
          assertContactFaces(study, body);
        seen.add(s.intake.stage);
        const p = study.shell.candy.position;
        maxJump = Math.max(
          maxJump,
          Math.hypot(...p.map((v, k) => v - previous[k])),
        );
        previous = Array.from(p);
        if (s.intake.dissolve > 0 && !eroded) {
          assert.ok(
            s.indent < 0.03,
            'surface recloses before the sugar erodes',
          );
          assert.equal(
            scene.getObjectByName('ContactStudy.Candy').visible,
            true,
            'internal candy persists after entry',
          );
          eroded = true;
        }
        if (s.intake.stage === 'done') break;
      }
      assert.equal(
        study.stats().intake.stage,
        'done',
        JSON.stringify(study.stats()),
      );
      assert.ok(eroded);
      assert.ok(seen.has('sealing'));
      assert.ok(seen.has('inside'));
      assert.ok(seen.has('dissolving'));
      assert.ok(maxJump < 0.06, 'no pose teleport during entry or closure');
      assert.equal(scene.getObjectByName('ContactStudy.Candy').visible, false);
      assert.ok(study.stats().indent < 0.008);
      if (location === 'front') {
        study.configure({ intake: 'start' });
        tick(0.25);
        assert.equal(study.stats().intake.stage, 'pressing');
        assert.equal(scene.getObjectByName('ContactStudy.Candy').visible, true);
      }
      study.configure({ intake: 'reset' });
      tick(0.2);
      assert.equal(study.stats().intake.stage, 'idle');
      assert.equal(scene.getObjectByName('ContactStudy.Candy').visible, true);
      assert.equal(study.shell.permeability, 0);
    } finally {
      close();
    }
  });

test('pause freezes the contact and expression; resume and mid-entry reset remain usable', async () => {
  const { study, tick, body, parts, scene, close } = await fixture();
  try {
    study.configure({ location: 'crown', angle: 45, intake: 'start' });
    for (let i = 0; i < 360 && study.stats().intake.stage !== 'sealing'; i++)
      study.update(1 / 60);
    assert.equal(study.stats().intake.stage, 'sealing');
    study.configure({ intake: 'pause' });
    const frozen = () => ({
      intake: study.stats().intake,
      body: Array.from(body.geometry.attributes.position.array),
      face: parts.map((p) => Array.from(p.geometry.attributes.position.array)),
      shell: Array.from(study.shell.displacement),
      candy: Array.from(study.shell.candy.position),
    });
    const before = frozen();
    tick(0.5);
    assert.deepEqual(
      frozen(),
      before,
      'pause must freeze geometry as well as the intake clock',
    );
    study.configure({ intake: 'resume' });
    tick(0.4);
    assert.notDeepEqual(frozen().candy, before.candy);
    study.configure({ intake: 'reset' });
    tick(0.5);
    assert.equal(study.stats().intake.stage, 'idle');
    assert.equal(study.stats().intake.paused, false);
    assert.equal(study.shell.permeability, 0);
    assert.equal(scene.getObjectByName('ContactStudy.Candy').visible, true);
    study.configure({ depth: 85 });
    tick(0.5);
    assert.ok(study.stats().indent > 0.02, 'reset restores solid contact');
  } finally {
    close();
  }
});
