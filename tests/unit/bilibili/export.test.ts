import test from 'node:test';
import assert from 'node:assert/strict';
import { adapter } from '../../../src/platforms/bilibili/index.ts';
import type { PlatformPresentation } from '../../../src/shared/app-contracts.ts';

test('bilibili adapter implements frozen contract 1.0 without spike dependencies', () => {
  const presentation: PlatformPresentation = adapter;
  assert.equal(presentation.id, 'bilibili');
  assert.equal(presentation.version, '2026.11.07.4');
  const source = presentation.build({ compact: false, chatVisible: false, chatWidthDip: 300 });
  assert.equal(typeof source, 'string');
  assert(source.includes('live-union.presentation.result'));
  assert(!source.includes('live-union.g0.'));
  assert(!source.includes('spikes/'));
});
