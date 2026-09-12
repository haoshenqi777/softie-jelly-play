import test from 'node:test';
import assert from 'node:assert/strict';
import { ContactIntake } from '../lib/contact-intake.ts';

test('floor-supported collar at eight wet sectors can finish wetting without an endless wrap', () => {
  const flow = new ContactIntake({ cohesive: true });
  flow.start(0.18);
  for (let i = 0; i < 360; i++)
    flow.update(1 / 120, {
      contact: true,
      burial: -0.22,
      indent: 0.13,
      coverage: 8 / 12,
      supported: true,
    });
  assert.ok(
    ['entering', 'sealing'].includes(flow.frame().stage),
    JSON.stringify(flow.frame()),
  );
  assert.equal(
    flow.frame().dissolve,
    0,
    'a loaded collar is not a fully buried candy',
  );
});

test('partial collar must be floor supported, loaded and stable before it opens', () => {
  for (const changes of [
    { supported: false },
    { coverage: 5 / 12 },
    { indent: 0.01 },
    { contact: false },
  ]) {
    const flow = new ContactIntake({ cohesive: true });
    flow.releaseContact(-0.1, 1);
    for (let i = 0; i < 600; i++)
      flow.update(1 / 120, {
        contact: true,
        burial: -0.22,
        indent: 0.13,
        coverage: 8 / 12,
        supported: true,
        ...changes,
      });
    assert.equal(flow.frame().stage, 'wrapping');
    assert.equal(flow.frame().permeability, 0);
  }
});

test('deep hand release keeps its existing wrap and never pulls the candy outward', () => {
  const flow = new ContactIntake({ cohesive: true });
  flow.releaseContact(-0.3, 1);
  assert.equal(flow.frame().wrap, 1);
  for (let i = 0; i < 120; i++)
    flow.update(1 / 60, {
      contact: false,
      burial: 0.12,
      indent: 0,
      coverage: 0,
    });
  assert.notEqual(flow.frame().stage, 'wrapping');
  assert.ok(flow.frame().offset <= -0.3);
});

test('gameplay contact resists first and never opens on pressure alone', () => {
  const flow = new ContactIntake({ cohesive: true });
  flow.start(0.18);
  for (let i = 0; i < 24; i++)
    flow.update(1 / 60, {
      contact: true,
      burial: -0.28,
      indent: 0.06,
      coverage: 0,
    });
  assert.equal(flow.frame().stage, 'pressing');
  assert.equal(flow.frame().permeability, 0);
  assert.ok(flow.frame().offset > 0);
  for (let i = 0; i < 180; i++)
    flow.update(1 / 60, {
      contact: true,
      burial: -0.22,
      indent: 0.13,
      coverage: 0,
    });
  assert.equal(flow.frame().stage, 'wrapping');
  assert.equal(flow.frame().permeability, 0);
  assert.equal(flow.frame().dissolve, 0);
});

test('measured wet perimeter gates slow entry; deep candy cannot skip closure', () => {
  for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
    const flow = new ContactIntake({ cohesive: true });
    flow.start(0.18);
    for (let t = 0; t < 2; t += dt)
      flow.update(dt, {
        contact: true,
        burial: -0.22,
        indent: 0.12,
        coverage: 0,
      });
    assert.equal(flow.frame().stage, 'wrapping');
    flow.update(dt, {
      contact: true,
      burial: -0.22,
      indent: 0.12,
      coverage: 0.9,
    });
    assert.equal(flow.frame().stage, 'entering');
    const start = flow.frame().offset;
    for (let t = 0; t < 0.2; t += dt)
      flow.update(dt, {
        contact: true,
        burial: 0.12,
        indent: 0.1,
        coverage: 1,
      });
    assert.ok(start - flow.frame().offset < 0.025, 'bounded entry speed');
    assert.equal(flow.frame().dissolve, 0);
    assert.ok(
      flow.frame().permeability < 0.4,
      'skin healing progresses over time after wetting opens contact',
    );
  }
});
