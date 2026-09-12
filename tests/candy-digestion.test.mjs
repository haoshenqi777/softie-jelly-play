import test from 'node:test';
import assert from 'node:assert/strict';
import { ContactIntake } from '../lib/contact-intake.ts';

const buried = { contact: false, burial: 0.2, indent: 0 };
function inside() {
  const flow = new ContactIntake();
  flow.releaseContact(-0.3);
  for (let i = 0; i < 240 && flow.frame().stage !== 'inside'; i++)
    flow.update(1 / 120, buried);
  assert.equal(flow.frame().stage, 'inside');
  return flow;
}
test('newly enclosed candy remains intact for at least one second', () => {
  const flow = inside();
  for (let i = 0; i < 120; i++) flow.update(1 / 120, buried);
  assert.equal(flow.frame().dissolve, 0);
  assert.equal(flow.frame().stage, 'inside');
});
test('internal digestion meters released sugar gradually and completes after 12–14 seconds', () => {
  const flow = inside();
  let previous = 0,
    end = 0;
  for (let i = 0; i < 14 * 120; i++) {
    const f = flow.update(1 / 120, buried);
    assert.ok(
      Number.isFinite(f.released),
      'mass release is an explicit shared signal',
    );
    assert.ok(f.released >= previous && f.released - previous < 0.004);
    previous = f.released;
    if (i === 3 * 120)
      assert.ok(f.released < 0.3, 'most of the candy is still present early');
    if (i === 6 * 120) assert.ok(f.released < 0.9 && f.dissolve < 0.6);
    if (f.stage === 'done') {
      end = (i + 1) / 120;
      break;
    }
  }
  assert.ok(
    end >= 12 && end <= 14,
    'complete internal sequence is deliberate but bounded',
  );
  assert.equal(flow.frame().released, 1);
});
