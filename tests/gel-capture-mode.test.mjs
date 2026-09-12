import test from 'node:test';
import assert from 'node:assert/strict';
import { prefersLinearGelCapture } from '../lib/gel-capture-mode.ts';

test('Apple phones and desktop-identifying iPads select the verified path', () => {
  assert.equal(
    prefersLinearGelCapture({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile MicroMessenger',
      platform: 'iPhone',
      maxTouchPoints: 5,
    }),
    true,
  );
  assert.equal(
    prefersLinearGelCapture({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    }),
    true,
  );
});

test('unaffected desktops and Android retain their current sampler', () => {
  assert.equal(
    prefersLinearGelCapture({
      userAgent: 'Macintosh AppleWebKit/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 0,
    }),
    false,
  );
  assert.equal(
    prefersLinearGelCapture({
      userAgent: 'Windows Chrome',
      platform: 'Win32',
      maxTouchPoints: 10,
    }),
    false,
  );
  assert.equal(
    prefersLinearGelCapture({
      userAgent: 'Linux; Android Chrome Mobile',
      platform: 'Linux',
      maxTouchPoints: 5,
    }),
    false,
  );
});
