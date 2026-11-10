'use strict';
// Offline checks only; no browser, real DOM, platform or session is accessed.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { build } = require('./presentation.cjs');
let compiled = 0;
for (const compact of [false, true]) {
  for (const chatVisible of [false, true]) {
    for (const chatWidthDip of [140, 240, 320, 340, 500]) {
      const prefs = { compact, chatVisible, chatWidthDip };
      const script = build(prefs);
      assert.equal(typeof script, 'string');
      assert.equal(script, build({ ...prefs, ignored: 'not serialized' }));
      new vm.Script(script);
      compiled++;
    }
  }
}
for (const bad of [null, {}, { compact: true, chatVisible: true, chatWidthDip: NaN },
  { compact: true, chatVisible: true, chatWidthDip: 139 },
  { compact: true, chatVisible: true, chatWidthDip: 501 },
  { compact: true, chatVisible: true, chatWidthDip: '340);throw 1;' }]) {
  const result = vm.runInNewContext(build(bad));
  assert.equal(result.status, 'unsupported');
  assert.equal(result.reason, 'invalid-preferences');
}
// Restoring does not even require the document to exist. Repetition is harmless.
const key = Symbol.for('live-union.g0.huya.presentation.v1');
let disposals = 0;
const restoreContext = vm.createContext({ [key]: { dispose() { disposals++; delete restoreContext[key]; } } });
const restore = build({ compact: false, chatVisible: true, chatWidthDip: 340 });
assert.equal(vm.runInContext(restore, restoreContext).status, 'restored');
assert.equal(vm.runInContext(restore, restoreContext).status, 'restored');
assert.equal(disposals, 1);
// Missing structure cannot create or hide anything, or read page contents.
const missingContext = { document: {
  getElementById() { return null; },
  querySelectorAll() { return []; },
  createElement() { throw new Error('must not mutate an unsupported page'); }
} };
const result = vm.runInNewContext(build({ compact: true, chatVisible: true, chatWidthDip: 340 }), missingContext);
assert.equal(result.status, 'unsupported');
assert.equal(result.reason, 'structure');
console.log(JSON.stringify({ status: 'passed', compiled, invalidPreferences: 6, restoreIdempotent: true, missingStructureUnchanged: true }));
