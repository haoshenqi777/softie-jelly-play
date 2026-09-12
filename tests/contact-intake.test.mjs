import test from 'node:test';
import assert from 'node:assert/strict';

import * as intake from '../lib/contact-intake.ts';
const make = () => {
  assert.equal(
    typeof intake.ContactIntake,
    'function',
    'measured intake controller exists',
  );
  return new intake.ContactIntake();
};
test('entry waits for contact and closure waits for actual burial and relaxed skin', () => {
  const a = make();
  a.start(0.3);
  for (let i = 0; i < 120; i++)
    a.update(1 / 60, { contact: false, burial: -0.3, indent: 0 });
  assert.equal(a.frame().stage, 'pressing');
  assert.equal(a.frame().dissolve, 0);
  for (let i = 0; i < 40; i++)
    a.update(1 / 60, { contact: true, burial: -0.15, indent: 0.13 });
  assert.equal(a.frame().stage, 'entering');
  for (let i = 0; i < 180; i++)
    a.update(1 / 60, { contact: true, burial: -0.02, indent: 0.2 });
  assert.equal(
    a.frame().permeability,
    0,
    'clock alone cannot release the skin',
  );
  assert.equal(a.frame().dissolve, 0);
  a.update(1 / 60, { contact: true, burial: 0.1, indent: 0.18 });
  assert.equal(a.frame().stage, 'sealing');
  for (let i = 0; i < 120; i++)
    a.update(1 / 60, { contact: false, burial: 0.13, indent: 0.18 });
  assert.equal(
    a.frame().stage,
    'sealing',
    'wait for the measured shell to close',
  );
  for (let i = 0; i < 60; i++)
    a.update(1 / 60, { contact: false, burial: 0.2, indent: 0 });
  assert.ok(['inside', 'dissolving'].includes(a.frame().stage));
  for (let i = 0; i < 1500; i++)
    a.update(i % 2 ? 0.011 : 0.025, { contact: false, burial: 0.2, indent: 0 });
  assert.equal(a.frame().stage, 'done');
  assert.equal(a.frame().dissolve, 1);
  a.reset();
  assert.equal(a.frame().stage, 'idle');
  assert.equal(a.frame().permeability, 0);
});
test('free-body wetting needs local pressure and partial embedding, then still waits for complete burial', () => {
  const a = new intake.ContactIntake({ wettingOnIndent: true });
  a.start();
  for (let i = 0; i < 30; i++)
    a.update(1 / 60, { contact: true, burial: -0.3, indent: 0.1 });
  assert.equal(
    a.frame().permeability,
    0,
    'remote contact cannot wet the candy',
  );
  for (let i = 0; i < 60; i++)
    a.update(1 / 60, { contact: false, burial: -0.02, indent: 0.2 });
  assert.equal(
    a.frame().permeability,
    0,
    'an old dent alone cannot trigger wetting',
  );
  for (let i = 0; i < 60; i++)
    a.update(1 / 60, { contact: true, burial: -0.02, indent: 0.2 });
  assert.equal(a.frame().stage, 'sealing');
  assert.equal(a.frame().permeability, 1);
  for (let i = 0; i < 120; i++)
    a.update(1 / 60, { contact: false, burial: -0.02, indent: 0 });
  assert.equal(
    a.frame().stage,
    'sealing',
    'no internal dissolve before full burial',
  );
  assert.equal(a.frame().dissolve, 0);
  a.update(1 / 60, { contact: false, burial: 0.1, indent: 0 });
  assert.equal(a.frame().stage, 'inside');
});

test('eroding candy preserves rest vertices and rounds its corners before disappearing', () => {
  assert.equal(
    typeof intake.erodedCandyPoint,
    'function',
    'spatial core erosion exists',
  );
  const points = [
    [0.18, 0, 0],
    [0.161, 0.161, 0.161],
    [0.17, 0.1, 0.03],
  ];
  for (const p of points) {
    assert.deepEqual(intake.erodedCandyPoint(p, 0), p);
    let last = Math.hypot(...p);
    for (let i = 1; i <= 100; i++) {
      const q = intake.erodedCandyPoint(p, i / 100),
        r = Math.hypot(...q);
      assert.ok(q.every(Number.isFinite));
      assert.ok(r <= last + 1e-6, 'surface only erodes');
      last = r;
    }
    assert.ok(last < 1e-8);
  }
  const face = intake.erodedCandyPoint(points[0], 0.65),
    corner = intake.erodedCandyPoint(points[1], 0.65);
  assert.ok(
    Math.hypot(...corner) / Math.hypot(...face) < 1.2,
    'remaining core becomes rounded rather than a scaled cube',
  );
});
