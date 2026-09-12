import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlimeDynamics } from '../lib/slime-physics.ts';
import { heightAt, radiusAt } from '../lib/slime-shape.ts';
import { SlimeContactSurface } from '../lib/slime-contact.ts';

test('inflated skin is round in all three dimensions, including the former pointed crown', () => {
  const s = new SlimeDynamics();
  s.puff = 1;
  const points = [];
  for (let i = 0; i <= 100; i++) {
    const t = -1 + i / 50;
    for (let j = 0; j < 16; j++) {
      const a = (j * Math.PI) / 8;
      points.push(
        s.deform(
          1.64 * radiusAt(t) * Math.cos(a),
          heightAt(t),
          1.18 * radiusAt(t) * Math.sin(a),
        ),
      );
    }
  }
  const widths = ['x', 'y', 'z'].map(
    (k) =>
      Math.max(...points.map((p) => p[k])) -
      Math.min(...points.map((p) => p[k])),
  );
  assert.ok(
    Math.max(...widths) / Math.min(...widths) < 1.07,
    `round silhouette: ${widths}`,
  );
  const upper = points.filter((p) => p.y > 0.4);
  const radii = upper.map((p) => Math.hypot(p.x, p.y - 1.6, p.z));
  assert.ok(
    Math.max(...radii) - Math.min(...radii) < 0.035,
    'crown and sides follow one soft round envelope',
  );
  assert.ok(Math.min(...points.map((p) => p.y)) >= 0);
});

test('inflation preserves skin continuity and a puffed body still indents locally', () => {
  const s = new SlimeDynamics();
  const sample = [0.45, 1.22, 1.07];
  let previous = s.deform(...sample);
  for (let i = 1; i <= 200; i++) {
    s.puff = i / 200;
    const next = s.deform(...sample);
    assert.ok(
      Math.hypot(
        next.x - previous.x,
        next.y - previous.y,
        next.z - previous.z,
      ) < 0.012,
    );
    previous = next;
  }
  s.pose.puff = 1;
  s.grab(0, 0, { x: sample[0], y: sample[1], z: sample[2] });
  for (let i = 0; i < 60; i++) s.advance(1 / 120);
  assert.ok(s.deform(...sample).z < previous.z - 0.05);
  s.release();
  for (let i = 0; i < 500; i++) s.advance(1 / 120);
  assert.ok(Math.abs(s.deform(...sample).z - previous.z) < 0.02);
});

test('stretched inflated skin still collides beyond its resting depth envelope', () => {
  const s = new SlimeDynamics();
  s.puff = s.pose.puff = 1;
  s.grab(0, 0, { x: 0, y: 1.2, z: 1.17 }, { x: 0, y: 0, z: 1 });
  s.dragTo(0, 0, 1.9);
  for (let i = 0; i < 6; i++) s.advance(1 / 120);
  const samples = Array.from({ length: 101 }, (_, i) => {
    const t = -1 + i / 50;
    return s.deform(0, heightAt(t), 1.18 * radiusAt(t));
  });
  const tip = samples.sort((a, b) => b.z - a.z)[0];
  assert.ok(tip.z > 2.3);
  const contact = new SlimeContactSurface(s).contact(
    { x: tip.x + s.x, y: tip.y + s.y, z: tip.z + s.z },
    0.085,
  );
  assert.ok(
    contact,
    'visible stretched flesh cannot be excluded by a resting-body bound',
  );
});
