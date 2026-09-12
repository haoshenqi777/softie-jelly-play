import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { characterFixture } from '../tests/softbody-fixture.mjs';
import { VolumeInteraction } from '../lib/softbody/interaction.ts';
import { StudioCandies } from '../lib/studio-candies.ts';
import { AbsorptionField } from '../lib/absorption-field.ts';
import { GameIntake } from '../lib/game-intake.ts';
import { shapeAudit } from './contact-shape-audit.mjs';
const bytes = readFileSync(
    new URL('../public/physics/volume.wasm', import.meta.url),
  ),
  skinBytes = readFileSync(
    new URL('../public/physics/contact-skin.wasm', import.meta.url),
  );
const results = [];
for (const native of process.argv.includes('--native') ? [true] : [false, true])
  for (const location of ['front', 'front-flank', 'side', 'crown']) {
    const f = characterFixture(),
      mesh = new THREE.Mesh(f.body);
    const measure = process.argv.includes('--shape')
      ? shapeAudit(f.body)
      : null;
    const shape = { folds: 0, maxAngle: 0, stretch: 0, maxStep: 0 };
    const heldShape = { folds: 0, maxAngle: 0, stretch: 0 };
    let previous = f.body.attributes.position.array.slice();
    mesh.userData.optical_profile = JSON.stringify(f.profile);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
    camera.position.set(0, 2.1, 8);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld();
    const canvas = {
      style: {},
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 400,
        height: 400,
      }),
      setPointerCapture() {},
      hasPointerCapture: () => false,
      releasePointerCapture() {},
      addEventListener() {},
      removeEventListener() {},
    };
    const parts = ['Eye.L', 'Eye.R', 'Smile'].map((name) => {
      const m = new THREE.Mesh(f.geometry(name));
      m.name = name;
      return m;
    });
    const v = new VolumeInteraction(
        canvas,
        camera,
        mesh,
        [mesh, ...parts],
        f.bubbles,
      ),
      scene = new THREE.Scene();
    scene.add(mesh);
    const candies = new StudioCandies(canvas, camera, scene, mesh),
      game = new GameIntake(v, candies, new AbsorptionField(2));
    await v.solver.accelerate(bytes);
    if (process.argv.includes('--240')) v.intake.contactInterval = 1 / 240;
    if (native) await v.intake.shell.skin.accelerate(skinBytes);
    v.setRecoveryEnabled(false);
    const origin =
      location === 'crown'
        ? new THREE.Vector3(0, 5, 0)
        : location === 'side'
          ? new THREE.Vector3(5, 1, 0)
          : new THREE.Vector3(location === 'front-flank' ? 0.85 : 0, 1, 5);
    const dir =
      location === 'crown'
        ? new THREE.Vector3(0, -1, 0)
        : location === 'side'
          ? new THREE.Vector3(-1, 0, 0)
          : new THREE.Vector3(0, 0, -1);
    const hit = new THREE.Raycaster(origin, dir).intersectObject(mesh)[0],
      n = hit.normal.clone().normalize();
    const c = candies.world.spawn(
      '#94dcb9',
      'gummy',
      hit.point.clone().addScaledVector(n, 0.2),
      undefined,
      0.18,
    );
    candies.world.grab(c.id);
    const accepted = candies.onHandContact(c, hit.point, n);
    if (location === 'front') {
      if (accepted)
        throw new Error('Protected face patch accepted hand contact');
      const result = { native, location, blocked: true };
      results.push(result);
      console.log(JSON.stringify(result));
      game.dispose();
      candies.dispose();
      continue;
    }
    if (!accepted) throw new Error('Contact rejected ' + location);
    const costs = [],
      heldCosts = [];
    for (let frame = 0; frame < 300; frame++) {
      if (frame < 140) candies.onHandPressure(Math.min(100, frame * 2));
      if (frame === 140) {
        candies.onHandRelease(true);
        candies.world.release();
      }
      const start = performance.now();
      v.update(1 / 60);
      candies.update(1 / 60);
      game.update();
      const elapsed = performance.now() - start;
      if (frame > 20) costs.push(elapsed);
      if (frame >= 50 && frame < 140) heldCosts.push(elapsed);
      if (measure) {
        const p = mesh.geometry.attributes.position.array;
        const audit = measure(p, v.intake.shell.rim.movable);
        for (const key of ['folds', 'maxAngle', 'stretch'])
          shape[key] = Math.max(shape[key], audit[key]);
        if (frame < 140)
          for (const key of ['folds', 'maxAngle', 'stretch'])
            heldShape[key] = Math.max(heldShape[key], audit[key]);
        for (let i = 0; i < p.length; i += 3)
          if (v.intake.shell.rim.movable[i / 3])
            shape.maxStep = Math.max(
              shape.maxStep,
              Math.hypot(
                p[i] - previous[i],
                p[i + 1] - previous[i + 1],
                p[i + 2] - previous[i + 2],
              ),
            );
        previous.set(p);
      }
    }
    function stats(a) {
      a.sort((a, b) => a - b);
      return {
        mean: a.reduce((s, x) => s + x, 0) / a.length,
        p95: a[Math.floor(a.length * 0.95)],
        max: a.at(-1),
      };
    }
    const result = {
      native,
      location,
      wholeLoop: stats(costs),
      held: stats(heldCosts),
      withdrawal: v.intake.frame().stage,
      finite: v.solver.x.every(Number.isFinite),
      shape: measure ? shape : undefined,
      heldShape: measure ? heldShape : undefined,
    };
    results.push(result);
    console.log(JSON.stringify(result));
    game.dispose();
    candies.dispose();
  }
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(results, null, 2));
