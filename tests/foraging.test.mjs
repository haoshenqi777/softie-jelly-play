import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlimeForaging } from '../lib/slime-foraging.ts';
import { SlimeDynamics } from '../lib/slime-physics.ts';

function step(f, s, seconds, bound = 1.3) {
  let caught = false;
  for (let i = 0; i < seconds * 120; i++) {
    const mouth = s.deform(0, 1.025, 1.18);
    f.advance(1 / 120, {
      x: s.x,
      y: s.y,
      mouthX: s.x + mouth.x,
      mouthY: s.y + mouth.y,
      bound,
    });
    s.drive = f.drive;
    if (f.hop) s.hopTo(f.hop.x, f.hop.height);
    Object.assign(s.pose, f.pose);
    s.advance(1 / 120);
    caught ||= f.ready;
  }
  return caught;
}
test('food to either side makes the body approach before contact', () => {
  for (const side of [-1, 1]) {
    const f = new SlimeForaging(),
      s = new SlimeDynamics();
    f.offer(side * 1.45, 1.35);
    assert.equal(step(f, s, 0.1), false);
    assert.equal(step(f, s, 5), true);
    assert.ok(
      s.x * side > 0.6,
      'body must approach, not merely stretch in place',
    );
  }
});
test('approach uses a little hop and keeps lateral facial stretching small', () => {
  const f = new SlimeForaging(),
    s = new SlimeDynamics();
  f.offer(1.1, 1.25);
  let height = 0,
    reach = 0;
  for (let i = 0; i < 480; i++) {
    step(f, s, 1 / 120);
    height = Math.max(height, s.y);
    reach = Math.max(reach, Math.abs(s.reachX));
  }
  assert.ok(
    height > 0.08 && height < 0.4,
    'a short hop must lift the entire soft body',
  );
  assert.ok(reach < 0.23, 'do not pull the face into a long sideways snout');
});
test('taking candy away before contact prevents eating and lets it try again', () => {
  const f = new SlimeForaging(),
    s = new SlimeDynamics();
  f.offer(0.3, 1.15);
  step(f, s, 0.2);
  f.move(4, 3);
  assert.equal(step(f, s, 3), false);
  assert.ok(s.x <= 1.32);
  f.move(-0.7, 1.15);
  assert.equal(step(f, s, 7), true);
});
test('cancelled food stops driving and does not leave a stale bite', () => {
  const f = new SlimeForaging(),
    s = new SlimeDynamics();
  f.offer(1.4, 1.2);
  step(f, s, 0.8);
  f.cancel();
  step(f, s, 3);
  assert.equal(f.ready, false);
  assert.equal(f.drive, null);
  assert.ok(Math.abs(s.reachX) < 0.002);
});
test('accepted low/high treats at both travel limits remain reachable with different spring settings', () => {
  for (const side of [-1, 1])
    for (const y of [0.8, 1.25, 1.65]) {
      for (const [stiffness, damping] of [
        [0, 0],
        [35, 45],
        [100, 100],
      ]) {
        const f = new SlimeForaging(),
          s = new SlimeDynamics();
        s.stiffness = stiffness;
        s.damping = damping;
        f.offer(side * 2.48, y);
        assert.ok(
          step(f, s, 12, 2.3),
          'treat at ' + side + ',' + y + ' with ' + stiffness + '/' + damping,
        );
        assert.ok(Math.abs(s.x) <= 2.4);
      }
    }
});
test('a candy just above the small reach is eaten instead of waiting in a height gap', () => {
  for (const y of [1.39, 1.43, 1.45]) {
    const f = new SlimeForaging(),
      s = new SlimeDynamics();
    f.offer(0, y);
    assert.ok(step(f, s, 8), 'height ' + y + ' must be reachable');
  }
});
