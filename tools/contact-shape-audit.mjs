import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { StudioContact } from '../lib/studio-contact.ts';
import { characterFixture } from '../tests/softbody-fixture.mjs';

export function shapeAudit(geometry) {
  const index = geometry.index.array,
    rest = geometry.attributes.position.array.slice(),
    edges = new Map();
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = index[t + k],
        b = index[t + ((k + 1) % 3)],
        lo = Math.min(a, b),
        hi = Math.max(a, b),
        key = lo + ':' + hi;
      const e = edges.get(key);
      if (e) e.t2 = t;
      else edges.set(key, { a: lo, b: hi, t1: t, t2: -1 });
    }
  function normal(p, t, out) {
    const a = index[t] * 3,
      b = index[t + 1] * 3,
      c = index[t + 2] * 3;
    const ux = p[b] - p[a],
      uy = p[b + 1] - p[a + 1],
      uz = p[b + 2] - p[a + 2],
      vx = p[c] - p[a],
      vy = p[c + 1] - p[a + 1],
      vz = p[c + 2] - p[a + 2];
    out[0] = uy * vz - uz * vy;
    out[1] = uz * vx - ux * vz;
    out[2] = ux * vy - uy * vx;
    const n = Math.hypot(...out);
    for (let j = 0; j < 3; j++) out[j] /= n || 1;
    return n;
  }
  const n0 = new Float64Array(3),
    n1 = new Float64Array(3);
  const pairs = [...edges.values()].filter((e) => {
    if (e.t2 < 0) return false;
    const a = normal(rest, e.t1, n0),
      b = normal(rest, e.t2, n1);
    e.length = Math.hypot(
      rest[e.a * 3] - rest[e.b * 3],
      rest[e.a * 3 + 1] - rest[e.b * 3 + 1],
      rest[e.a * 3 + 2] - rest[e.b * 3 + 2],
    );
    return (
      a > 1e-7 &&
      b > 1e-7 &&
      n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] > 0.94
    );
  });
  return (p, weight) => {
    let folds = 0,
      maxAngle = 0,
      stretch = 0,
      roughness = 0,
      count = 0;
    for (const e of pairs) {
      if (weight && weight[e.a] <= 0.001 && weight[e.b] <= 0.001) continue;
      const a = normal(p, e.t1, n0),
        b = normal(p, e.t2, n1);
      if (a < 1e-9 || b < 1e-9) continue;
      const angle =
        (Math.acos(
          Math.max(
            -1,
            Math.min(1, n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]),
          ),
        ) *
          180) /
        Math.PI;
      maxAngle = Math.max(maxAngle, angle);
      if (angle > 65) folds++;
      const len = Math.hypot(
        p[e.a * 3] - p[e.b * 3],
        p[e.a * 3 + 1] - p[e.b * 3 + 1],
        p[e.a * 3 + 2] - p[e.b * 3 + 2],
      );
      stretch = Math.max(stretch, len / e.length);
      roughness += angle * angle;
      count++;
    }
    return {
      folds,
      maxAngle,
      stretch,
      rmsAngle: Math.sqrt(roughness / count),
      count,
    };
  };
}

export async function auditContact(location = 'front', angle = 35) {
  const f = characterFixture(),
    body = new THREE.Mesh(f.body),
    measure = shapeAudit(f.body),
    scene = new THREE.Scene();
  body.userData.optical_profile = JSON.stringify(f.profile);
  scene.add(body);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, 2.1, 8);
  camera.lookAt(0, 1, 0);
  camera.updateMatrixWorld();
  const canvas = {
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    setPointerCapture() {},
    hasPointerCapture: () => false,
    releasePointerCapture() {},
  };
  const parts = ['Eye.L', 'Eye.R', 'Smile'].map((name) => {
    const m = new THREE.Mesh(f.geometry(name));
    m.name = name;
    scene.add(m);
    return m;
  });
  const study = new StudioContact(
    canvas,
    camera,
    body,
    parts,
    f.bubbles,
    scene,
    new THREE.Texture(),
  );
  await study.solver.accelerate(
    readFileSync(new URL('../public/physics/volume.wasm', import.meta.url)),
  );
  if (process.env.CONTACT_SKIN_WASM === '1')
    await study.shell.skin.accelerate(readFileSync(new URL('../public/physics/contact-skin.wasm', import.meta.url)));
  study.configure({ location, angle, intake: 'start' });
  const stages = {},
    worst = { folds: 0, maxAngle: 0, stretch: 0, rmsAngle: 0 },
    baseWorst = { folds: 0, maxAngle: 0 },
    cost = {};
  const previous = body.geometry.attributes.position.array.slice();
  let openingJump = 0,
    entryMaxStep = 0,
    previousOpen = false;
  for (let frame = 0; frame < 600; frame++) {
    study.update(1 / 60);
    const stats = measure(
        body.geometry.attributes.position.array,
        study.shell.rim.movable,
      ),
      stage = study.intake.frame().stage;
    const current = body.geometry.attributes.position.array,
      open = study.intake.frame().permeability > 0;
    let jump = 0;
    for (let j = 0; j < current.length; j += 3)
      if (study.shell.rim.movable[j / 3])
        jump = Math.max(
          jump,
          Math.hypot(
            current[j] - previous[j],
            current[j + 1] - previous[j + 1],
            current[j + 2] - previous[j + 2],
          ),
        );
    if (open && !previousOpen) openingJump = jump;
    if (stage === 'entering' || stage === 'sealing')
      entryMaxStep = Math.max(entryMaxStep, jump);
    previous.set(current);
    previousOpen = open;
    (cost[stage] ??= []).push(study.stats().physicsMs);
    const base = Float32Array.from(
      body.geometry.attributes.position.array,
      (v, i) => v - study.shell.rim.offset[i],
    );
    const bs = measure(base, study.shell.rim.movable);
    baseWorst.folds = Math.max(baseWorst.folds, bs.folds);
    baseWorst.maxAngle = Math.max(baseWorst.maxAngle, bs.maxAngle);
    const record = (stages[stage] ??= {
      folds: 0,
      maxAngle: 0,
      stretch: 0,
      rmsAngle: 0,
    });
    for (const key of Object.keys(worst)) {
      record[key] = Math.max(record[key], stats[key]);
      worst[key] = Math.max(worst[key], stats[key]);
    }
  }
  const physics = {};
  for (const [stage, values] of Object.entries(cost)) {
    values.sort((a, b) => a - b);
    physics[stage] = {
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      p95: values[Math.floor(values.length * 0.95)],
    };
  }
  const result = {
    location,
    angle,
    worst,
    baseWorst,
    stages,
    openingJump,
    entryMaxStep,
    physics,
    final: study.intake.frame().stage,
    coverage: study.shell.rim.coverage,
    candy: [...study.shell.candy.position],
    contact: study.stats(),
  };
  study.dispose();
  return result;
}

if (process.argv[1]?.endsWith('contact-shape-audit.mjs')) {
  const result = [];
  for (const location of process.argv.includes('--front')
    ? ['front']
    : process.argv.includes('--crown')
      ? ['crown']
      : ['front', 'side', 'crown']) {
    const r = await auditContact(location);
    result.push(r);
    console.log(JSON.stringify(r));
  }
  if (process.argv[2] && !process.argv[2].startsWith('--'))
    writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
}
