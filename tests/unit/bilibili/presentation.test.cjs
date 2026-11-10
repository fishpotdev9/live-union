'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { build } = require('../../../src/platforms/bilibili/presentation.cjs');
const { fixture } = require('./fixture.cjs');
const prefs = { compact: true, chatVisible: false, chatWidthDip: 300 };
const native = { ...prefs, compact: false };
function restored(sample) {
  for (const saved of sample.original) {
    assert.equal(saved.node.parentElement, saved.parent, 'native parent unchanged');
    assert.deepEqual(saved.node.properties, saved.properties, 'style value and priority restored');
  }
  assert(sample.observers.every(observer => observer.disconnected));
  assert.equal(sample.animation.size, 0);
  for (const set of sample.events.values()) assert.equal(set.size, 0);
  for (const node of sample.nodes) for (const set of node.events.values()) assert.equal(set.size, 0);
}

test('build reconstructs only valid fixed preferences and rejects executable extra input', () => {
  assert.equal(build({ ...prefs, payload: 'throw new Error("injected")' }), build(prefs));
  assert(!build(prefs).includes('live-union.g0.'));
  for (const value of [null, {}, { ...prefs, compact: 'true' }, { ...prefs, chatVisible: 1 },
    ...[139, 501, Infinity, NaN, '300'].map(chatWidthDip => ({ ...prefs, chatWidthDip }))]) {
    const sample = fixture();
    const result = vm.runInContext(build(value), sample.context);
    assert.equal(result.status, 'unsupported'); assert.equal(result.reason, 'invalid-preferences');
    restored(sample);
  }
});

test('same-origin iframe, outer navigation and native component identities survive apply/restore', () => {
  const sample = fixture();
  assert.equal(sample.run().status, 'applied');
  assert.equal(sample.navigation.style.getPropertyValue('display'), 'none');
  assert.equal(sample.activityBanner.style.getPropertyValue('display'), 'none');
  assert.equal(sample.script.style.getPropertyValue('display'), '');
  assert.equal(sample.shell.style.getPropertyValue('z-index'), 'auto');
  assert.equal(sample.shell.style.getPropertyValue('isolation'), 'auto');
  assert.equal(sample.video.style.getPropertyValue('object-fit'), 'contain');
  assert.equal(sample.state().version, '2026.11.07.4');
  for (const record of sample.original) assert.equal(record.node.parentElement, record.parent);
  assert.equal(sample.run(native).status, 'restored');
  assert.equal(sample.run(native).status, 'restored');
  restored(sample);
});

test('a packed secondary preview preserves the native sender at a 380px requested sidebar width',()=>{
  const sample=fixture({width:524,height:272,responsiveHidden:true}),textarea=sample.textarea;
  assert.equal(sample.run({...prefs,chatVisible:true,chatWidthDip:380}).status,'applied');
  assert.equal(sample.textarea,textarea);assert(sample.input.scrollWidth<=sample.input.clientWidth+1);
  assert.equal(sample.video.style.getPropertyValue('object-fit'),'contain');
  sample.run(native);restored(sample);
});

test('every positive small video-only viewport keeps contain instead of rejecting for chat thresholds', () => {
  for (const [width, height] of [[1, 1], [130, 50], [220, 120], [300, 180], [900, 100]]) {
    const sample = fixture({ width, height });
    assert.equal(sample.run().status, 'applied');
    assert.equal(sample.chat.style.getPropertyValue('display'), 'none');
    assert.equal(sample.video.style.getPropertyValue('object-fit'), 'contain');
    assert.equal(sample.player.style.getPropertyValue('height'), 'min(100vh, calc((100vw - 0px) * 9 / 16))');
    sample.run(native); restored(sample);
  }
});

test('visible chat retains full native send/history branches and refuses insufficient space', () => {
  const sample = fixture();
  assert.equal(sample.run({ ...prefs, chatVisible: true }).status, 'applied');
  assert.equal(sample.chat.style.getPropertyValue('display'), 'flex');
  assert.equal(sample.send.style.getPropertyValue('height'), '109px');
  assert.equal(sample.panel.contains(sample.list), true);
  assert.equal(sample.send.contains(sample.textarea), true);
  sample.run(native); restored(sample);
  for (const options of [{ width: 400 }, { height: 200 }]) {
    const narrow = fixture(options);
    const result = narrow.run({ ...prefs, chatVisible: true });
    assert.equal(result.status, 'unsupported'); assert.equal(result.reason, 'insufficient-chat-space');
    restored(narrow);
  }
  for (const chatWidthDip of [140, 240, 298]) {
    const narrow = fixture();
    assert.equal(narrow.run({ ...prefs, chatVisible: true, chatWidthDip }).reason, 'chat-layout');
    restored(narrow);
  }
});

test('native responsive zero-size chat does not block tiny video-only contain', () => {
  const sample = fixture({ width: 130, height: 50 });
  sample.send.bounds = { width: 0, height: 0 };
  sample.panel.bounds = { width: 0, height: 0 };
  sample.list.bounds = { width: 0, height: 0 };
  assert.equal(sample.run().status, 'applied');
  assert.equal(sample.video.style.getPropertyValue('object-fit'), 'contain');
  sample.run(native); restored(sample);
  assert.equal(sample.run({ ...prefs, chatVisible: true }).reason, 'insufficient-chat-space');
  restored(sample);
});

test('nine-room responsive zero rectangles are revealed and measured at 702x272 without replacing inputs', () => {
  const sample = fixture({ width: 702, height: 272, responsiveHidden: true });
  const textarea = sample.textarea;
  assert.equal(sample.send.getBoundingClientRect().height, 0);
  assert.equal(sample.input.getBoundingClientRect().width, 0);
  assert.equal(sample.run({ ...prefs, chatVisible: false, chatWidthDip: 320 }).status, 'applied');
  const result = sample.run({ ...prefs, chatVisible: true, chatWidthDip: 320 });
  assert.equal(result.status, 'applied');
  assert.equal(sample.send.style.getPropertyValue('height'), '109px');
  assert.equal(sample.textarea, textarea);
  assert(sample.list.getBoundingClientRect().height >= 120);
  assert(sample.input.scrollWidth <= sample.input.clientWidth + 1);
  sample.run(native); restored(sample);
  assert.equal(sample.send.getBoundingClientRect().height, 0);
});

test('responsive reveal must measure real send height and roll back failed geometry instead of supplying a minimum', () => {
  for (const broken of ['zero-height', 'overflow', 'offscreen-input']) {
    const sample = fixture({ width: 702, height: 272, responsiveHidden: true, brokenSend: broken === 'zero-height' });
    if (broken === 'overflow') sample.input.minimumScrollWidth = 900;
    if (broken === 'offscreen-input') sample.textarea.measure = () => ({ x: 900, y: 900, width: 141, height: 36 });
    const result = sample.run({ ...prefs, chatVisible: true, chatWidthDip: 320 });
    assert.equal(result.status, 'unsupported');
    assert.equal(result.reason, broken === 'zero-height' ? 'native-send-geometry' : 'chat-layout');
    restored(sample);
  }
});

test('cross-origin, duplicate native targets and missing native history never become synthetic chat', () => {
  for (const options of [{ crossOrigin: true }, { noList: true }]) {
    const sample = fixture(options);
    assert.equal(sample.run().status, 'unsupported'); restored(sample);
  }
  const duplicate = fixture();
  duplicate.left.add(new duplicate.Node('div', ['#live-player']));
  assert.equal(duplicate.run().status, 'unsupported'); restored(duplicate);
  const direct = fixture({ direct: true });
  assert.equal(direct.run().status, 'applied');
  assert.equal(direct.navigation.style.getPropertyValue('display'), 'none');
  direct.run(native); restored(direct);
});

test('resize keeps video-only contain but restores native chat when it becomes too small', () => {
  const sample = fixture();
  assert.equal(sample.run().status, 'applied');
  sample.context.innerWidth = 100; sample.context.innerHeight = 80;
  sample.fire('resize'); sample.flush();
  assert.equal(sample.result().status, 'applied'); sample.run(native); restored(sample);
  const chat = fixture();
  assert.equal(chat.run({ ...prefs, chatVisible: true }).status, 'applied');
  chat.context.innerWidth = 350;
  chat.fire('resize'); chat.flush();
  assert.equal(chat.result().status, 'unsupported');
  assert.equal(chat.result().reason, 'insufficient-chat-space'); restored(chat);
});

test('structural replacement and iframe load restore styles and publish dynamic degradation', () => {
  for (const event of ['video', 'frame', 'ancestry']) {
    const sample = fixture(); sample.run();
    if (event === 'video') sample.video.isConnected = false;
    if (event === 'frame') sample.frame.fire('load');
    if (event === 'ancestry') sample.section.children.reverse();
    if (event !== 'frame') { sample.observers[0].callback(); sample.flush(); }
    assert.equal(sample.result().status, 'unsupported');
    assert.equal(sample.result().reason, 'structure-invalidated');
    if (event === 'ancestry') sample.section.children.reverse();
    restored(sample);
  }
});

test('visible native semantic overlay and native fullscreen trigger full native fallback', () => {
  const overlay = fixture();
  overlay.main.body.add(new overlay.Node('div', ['[role="dialog"]'], 400, 300));
  assert.equal(overlay.run().reason, 'native-overlay'); restored(overlay);
  const fullscreen = fixture(); fullscreen.run();
  fullscreen.room.fullscreenElement = fullscreen.player;
  fullscreen.room.fire('fullscreenchange'); fullscreen.flush();
  assert.equal(fullscreen.result().reason, 'native-fullscreen'); restored(fullscreen);
});

test('version replacement disposes old closures, cancels queued work and leaves G0 untouched', () => {
  const sample = fixture(); let oldDisposed = 0;
  const stateKey = Symbol.for('live-union.bilibili.presentation.state');
  const g0 = { dispose() { throw new Error('G0 must remain untouched'); } };
  sample.context.__liveUnionBilibiliPresentationV1 = g0;
  sample.context[stateKey] = { version: '2026.11.06.1', dispose() { oldDisposed++; } };
  sample.run(); assert.equal(oldDisposed, 1);
  const first = sample.state(); sample.fire('resize');
  assert.equal(sample.animation.size, 1);
  sample.run(); assert.notEqual(sample.state(), first); assert.equal(sample.animation.size, 0);
  assert.equal(sample.context.__liveUnionBilibiliPresentationV1, g0);
  first.dispose(); sample.flush(); assert.equal(sample.result().status, 'applied');
  sample.run(native); restored(sample);
});

test('restore preserves newer platform styles and failure/status output stays finite and whitelisted', () => {
  const sample = fixture(); sample.run();
  sample.video.style.setProperty('object-fit', 'scale-down', '');
  sample.run(native);
  assert.equal(sample.video.style.getPropertyValue('object-fit'), 'scale-down');
  const failure = fixture();
  failure.context[Symbol.for('live-union.bilibili.presentation.state')] = { dispose() { throw new Error('secret'); } };
  assert.equal(failure.run().reason, 'restore-failed');
  const allowedStatus = new Set(['applied', 'restored', 'unsupported', 'notReady', 'failed']);
  const allowedReason = new Set(['candidate-layout', 'native-page', 'restore-failed', 'invalid-preferences',
    'not-applied', 'native-structure', 'room-document-unavailable', 'ambiguous-room',
    'room-missing-or-cross-origin', 'required-structure-missing', 'chat-common-root-mismatch',
    'native-send-geometry', 'structure-invalidated', 'native-fullscreen', 'native-overlay',
    'insufficient-space', 'insufficient-chat-space', 'presentation-rolled-back', 'chat-layout']);
  for (const result of [sample.result(), failure.result(), fixture().run(), fixture({ noList: true }).run()]) {
    assert(allowedStatus.has(result.status)); assert(allowedReason.has(result.reason));
    assert.deepEqual(Object.keys(result).sort(), ['reason', 'status']);
    assert(!JSON.stringify(result).includes('secret'));
  }
});

const geometry = sample => vm.runInContext("globalThis[Symbol.for('live-union.bilibili.chat-geometry')]", sample.context);

test('diagnostic retains pre-rollback overflow geometry with a fixed failure part', () => {
  const sample = fixture({ width: 702, height: 272, responsiveHidden: true });
  sample.input.minimumScrollWidth = 900;
  assert.equal(sample.run({ ...prefs, chatVisible: true, chatWidthDip: 320 }).reason, 'chat-layout');
  const captured = geometry(sample);
  assert.equal(captured.stage, 'layout'); assert.equal(captured.part, 'overflow');
  assert.equal(captured.viewport.width, 702); assert.equal(captured.viewport.height, 272);
  assert.equal(captured.input.width, 304); assert.equal(captured.input.scrollWidth, 900);
  assert.equal(captured.input.clientWidth, 304); assert.equal(captured.overflowDepth, 2);
  assert.equal(sample.input.getBoundingClientRect().width, 0, 'native hidden state has already been restored');
  restored(sample);
  sample.run(native);
  assert.equal(geometry(sample), captured, 'native fallback does not overwrite failure geometry');
});

test('diagnostic identifies the original native input child without hiding it or relaxing checks', () => {
  const sample = fixture({ width: 702, height: 272, responsiveHidden: true });
  sample.sendButton.measure = () => ({ x: 0, y: 0, width: 0, height: 0 });
  assert.equal(sample.run({ ...prefs, chatVisible: true, chatWidthDip: 320 }).reason, 'chat-layout');
  const captured = geometry(sample);
  assert.equal(captured.part, 'input-child'); assert.equal(captured.inputChildIndex, 2);
  assert.equal(captured.inputChildren[2].width, 0);
  assert.equal(sample.sendButton.style.getPropertyValue('display'), '');
  restored(sample);
});

test('diagnostic consists only of bounded numeric boxes and fixed stage/part enums', () => {
  for (const invalid of [false, true]) {
    const sample = fixture({ width: 702, height: 272, responsiveHidden: true });
    if (invalid) sample.textarea.measure = () => ({ x: 0, y: 0, width: Infinity, height: 36 });
    sample.run({ ...prefs, chatVisible: true, chatWidthDip: 320 });
    const captured = geometry(sample);
    assert(['measure', 'layout', 'fallback'].includes(captured.stage));
    assert(['none', 'viewport', 'chat', 'history-root', 'panel', 'list', 'send-root', 'input', 'textarea',
      'input-child', 'input-ancestor', 'overflow', 'structure', 'overlay'].includes(captured.part));
    assert(captured.inputChildren.length <= 3); assert(captured.inputAncestors.length <= 8);
    function numeric(value) {
      if (typeof value === 'object') for (const child of Object.values(value)) numeric(child);
      else { assert.equal(typeof value, 'number'); assert(Number.isFinite(value)); assert(Math.abs(value) <= 1000000); }
    }
    const { stage, part, ...numbers } = captured; numeric(numbers);
    if (invalid) assert.equal(captured.textarea.width, -1);
    else assert.equal(captured.part, 'none');
    sample.run(native); restored(sample);
  }
});
