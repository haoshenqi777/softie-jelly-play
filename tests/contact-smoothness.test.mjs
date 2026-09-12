import test from 'node:test';
import assert from 'node:assert/strict';
import { auditContact } from '../tools/contact-shape-audit.mjs';

for (const location of ['front', 'side', 'crown'])
  for (const angle of [0, 35]) {
    test(`${location} ${angle}deg keeps a smooth skin through every frame of wetting and closure`, async () => {
      const r = await auditContact(location, angle);
      assert.equal(
        r.final,
        'dissolving',
        'physical wetting must complete, not stall',
      );
      assert.equal(r.worst.folds, 0, JSON.stringify(r.stages));
      assert.ok(
        r.worst.stretch < 2.6,
        'no sixfold local stretch: ' + r.worst.stretch,
      );
      assert.ok(
        r.openingJump < 0.055,
        'no skin jump when wetting opens: ' + r.openingJump,
      );
      assert.ok(
        r.entryMaxStep < 0.055,
        'continuous entry and closure: ' + r.entryMaxStep,
      );
      console.log(JSON.stringify(r));
    });
  }
