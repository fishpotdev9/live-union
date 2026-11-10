import test from 'node:test';
import assert from 'node:assert/strict';
import { adapter } from '../../../src/platforms/douyu/index.ts';

test('Douyu exports the frozen production adapter and fixed local presentation builder', () => {
  assert.equal(adapter.id, 'douyu');
  assert.equal(adapter.version, '2026.11.07.3');
  assert(Object.isFrozen(adapter));
  const script = adapter.build({ compact: false, chatVisible: false, chatWidthDip: 380 });
  assert(script.includes('live-union.presentation.result'));
  assert(!script.includes('live-union.g0.presentation.result'));
  assert(!script.includes('spikes/'));
});
