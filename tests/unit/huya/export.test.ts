import test from 'node:test';
import assert from 'node:assert/strict';
import { adapter } from '../../../src/platforms/huya/index.ts';
import type { PlatformPresentation } from '../../../src/shared/app-contracts.ts';

test('huya adapter exports the frozen presentation contract and has no spike dependency', () => {
  const presentation: PlatformPresentation = adapter;
  assert.equal(presentation.id, 'huya');
  assert.equal(presentation.version, '2026.11.08.2');
  const script = presentation.build({ compact: false, chatVisible: false, chatWidthDip: 340 });
  assert.equal(typeof script, 'string');
  assert.ok(script.includes('live-union.presentation.result'));
  assert.ok(!script.includes('live-union.g0.'));
});
