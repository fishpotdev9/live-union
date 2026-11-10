'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { build } = require('../../../src/platforms/douyu/presentation.cjs');
const { fixture, Element } = require('./mock-dom.cjs');
const prefs = { compact: true, chatVisible: true, chatWidthDip: 380 };
const run = (item, values = prefs) => vm.runInContext(build(values), item.context);
const diagnostic = item => vm.runInContext('globalThis[Symbol.for("live-union.presentation.result")]', item.context);
const state = item => item.window[Symbol.for('live-union.douyu.presentation.state')];

test('CSSOM-normalized values retain ownership and restore original styles', () => {
  const item = fixture();
  const originalSet = item.frame.style.setProperty.bind(item.frame.style);
  item.frame.style.setProperty = (name, value, priority) => originalSet(name,
    name === 'background' && value === '#000' ? 'rgb(0, 0, 0)' : value, priority);
  assert.equal(run(item).status, 'applied');
  assert.equal(item.frame.style.getPropertyValue('background'), 'rgb(0, 0, 0)');
  assert.equal(run(item, { ...prefs, compact: false }).status, 'restored');
  assert.equal(item.frame.style.getPropertyValue('background'), '');
});

test('build only serializes validated presentation preferences and publishes finite failure', () => {
  for (const compact of [false, true]) for (const chatVisible of [false, true]) for (const chatWidthDip of [140, 240, 380, 500]) {
    const source = build({ compact, chatVisible, chatWidthDip, arbitrary: 'UNTRUSTED_EXTRA' });
    assert(!source.includes('UNTRUSTED_EXTRA'));
    const context = vm.createContext({ window: {}, document: { querySelectorAll: () => [] } });
    const returned = vm.runInContext(source, context);
    assert.equal(returned.status, compact ? 'unsupported' : 'restored');
    assert.equal(diagnostic({ context }), returned);
  }
  for (const chatWidthDip of [NaN, Infinity, 139, 501, '380', null]) assert.throws(() => build({ ...prefs, chatWidthDip }), TypeError);
  for (const compact of [null, 'true', 1]) assert.throws(() => build({ ...prefs, compact }), TypeError);
});

test('same version is idempotent; chat toggles preserve native identities and do not access media APIs or values', () => {
  const item = fixture();
  const videoParent = item.video.parentElement;
  const listParent = item.list.parentElement;
  assert.equal(run(item).status, 'applied');
  const installed = state(item);
  assert.equal(run(item).status, 'applied');
  assert.equal(state(item), installed);
  assert.equal(item.observers.length, 1);
  assert.equal(run(item, { ...prefs, chatVisible: false }).playerWidth, 1280);
  assert.equal(item.aside.style.getPropertyValue('display'), 'none');
  assert.equal(run(item).playerWidth, 900);
  assert.equal(item.video.parentElement, videoParent);
  assert.equal(item.list.parentElement, listParent);
  for (const node of [item.list, item.input, item.nativeControl]) assert.equal(node.style.values.size, 0);
  assert.equal(item.video.style.getPropertyValue('object-fit'), 'contain');
  assert.equal(item.video.style.getPropertyValue('display'), '');
  assert.equal(item.header.style.getPropertyValue('display'), 'none');
  assert.equal(item.navAside.style.getPropertyValue('display'), 'none');
  assert(item.resources.every(node => node.style.values.size === 0));
  assert.equal(item.main.style.getPropertyValue('z-index'), '2147483000');
});

test('video-only small viewports remain compact without showing a native full-page crop', () => {
  for (const [width, height] of [[220, 140], [220, 180], [220, 120], [160, 90]]) {
    const item = fixture();
    Object.defineProperty(item.document.documentElement, 'clientWidth', { get: () => width });
    Object.defineProperty(item.document.documentElement, 'clientHeight', { get: () => height });
    const returned = run(item, { ...prefs, chatVisible: false });
    assert.equal(returned.status, 'applied');
    assert.equal(returned.playerWidth, width);
    assert.equal(returned.height, height);
    assert.equal(item.frame.style.getPropertyValue('width'), width + 'px');
    assert.equal(item.frame.style.getPropertyValue('height'), height + 'px');
    assert.equal(item.video.style.getPropertyValue('object-fit'), 'contain');
    assert.equal(item.nativeControl.style.values.size, 0);
    run(item, { ...prefs, compact: false });
    assert(item.nodes.every(node => node.style.values.size === 0));
  }
});

test('native chat width and height constraints return unsupported without silently changing preferences', () => {
  const narrow = fixture();
  assert.equal(run(narrow, { ...prefs, chatWidthDip: 240 }).reason, 'insufficient-space');
  assert(narrow.nodes.every(node => node.style.values.size === 0));
  assert.equal(diagnostic(narrow).status, 'unsupported');
  const short = fixture();
  Object.defineProperty(short.document.documentElement, 'clientHeight', { get: () => 180 });
  assert.equal(run(short).status, 'unsupported');
  assert(short.nodes.every(node => node.style.values.size === 0));
});

test('outer scrollbars are released before measuring; repeated layout is stable and root styles restore', () => {
  const item = fixture(true);
  item.document.body.style.setProperty('overflow-x', 'auto');
  item.document.body.style.setProperty('margin-left', '7px');
  assert.equal(item.document.documentElement.clientWidth, 1265);
  const returned = run(item);
  assert.equal(returned.width, 1280);
  assert.equal(returned.height, 720);
  assert.equal(run(item).width, 1280);
  assert.equal(run(item, { ...prefs, compact: false }).status, 'restored');
  assert.equal(item.document.body.style.getPropertyValue('overflow-x'), 'auto');
  assert.equal(item.document.body.style.getPropertyValue('margin-left'), '7px');
  assert.equal(item.document.documentElement.clientWidth, 1265);
});

test('dynamic off-path siblings are throttled; disposal restores styles and cancels pending work', () => {
  const item = fixture();
  run(item);
  const portal = new Element(item.document.body, 1280, 60);
  for (let index = 0; index < 5; index++) item.observers[0].callback();
  assert.equal(item.timers.size, 1);
  item.flushTimer();
  assert.equal(item.frames.size, 1);
  item.flushFrame();
  assert.equal(portal.style.getPropertyValue('display'), 'none');
  assert.equal(diagnostic(item).status, 'applied');
  item.observers[0].callback();
  assert.equal(item.timers.size, 1);
  assert.equal(run(item, { ...prefs, compact: false }).status, 'restored');
  assert.equal(item.timers.size, 0);
  assert.equal(item.frames.size, 0);
  assert.equal(item.events.size, 0);
  assert(item.observers.every(observer => observer.disconnected));
  assert(item.nodes.every(node => node.style.values.size === 0));
  assert.equal(portal.style.values.size, 0);
  assert.equal(run(item, { ...prefs, compact: false }).status, 'restored');
});

test('platform-owned newer inline styles survive adapter restoration', () => {
  const item = fixture();
  run(item);
  item.player.style.setProperty('width', '777px');
  run(item, { ...prefs, compact: false });
  assert.equal(item.player.style.getPropertyValue('width'), '777px');
});

test('version changes dispose the old closure and install the packaged implementation', () => {
  const item = fixture();
  let disposed = 0;
  let updated = 0;
  item.window[Symbol.for('live-union.douyu.presentation.state')] = {
    version: '2026.11.06.9',
    dispose() { disposed++; },
    update() { updated++; throw new Error('old closure must not run'); },
  };
  assert.equal(run(item).status, 'applied');
  assert.equal(disposed, 1);
  assert.equal(updated, 0);
  assert.equal(state(item).version, '2026.11.07.3');
  const original = state(item);
  original.version = '2026.11.06.9';
  assert.equal(run(item).status, 'applied');
  assert.notEqual(state(item), original);
  assert.equal(item.observers.length, 2);
  assert.equal(item.observers[0].disconnected, true, 'real old listener state must be disposed');
  assert.equal(item.observers[1].disconnected, false);
  assert.equal(item.events.size, 2, 'new installation must have exactly one listener per window/document event');
  assert.equal(item.video.events.size, 2);
});

test('packed secondary preview keeps full native 380px chat without changing media or control nodes',()=>{
  const item=fixture();
  Object.defineProperty(item.document.documentElement,'clientWidth',{get:()=>524});
  Object.defineProperty(item.document.documentElement,'clientHeight',{get:()=>272});
  const input=item.input,control=item.nativeControl,result=run(item);
  assert.equal(result.status,'applied');assert.equal(result.playerWidth,144);
  assert.equal(item.video.style.getPropertyValue('object-fit'),'contain');
  assert.equal(item.input,input);assert.equal(item.nativeControl,control);assert.equal(control.style.values.size,0);
  run(item,{...prefs,compact:false});assert(item.nodes.every(node=>node.style.values.size===0));
});

test('asynchronous structure loss updates diagnostics and restores full native page', () => {
  const item = fixture();
  run(item);
  item.list.isConnected = false;
  item.observers[0].callback();
  item.flushTimer();
  item.flushFrame();
  assert.equal(diagnostic(item).reason, 'structure-changed');
  assert.equal(diagnostic(item).status, 'unsupported');
  assert.equal(state(item), undefined);
  assert.equal(item.events.size, 0);
  assert(item.nodes.every(node => node.style.values.size === 0));
});

test('asynchronous resize failure and native dialog/fullscreen synchronize unsupported diagnostics', () => {
  const resized = fixture();
  run(resized);
  Object.defineProperty(resized.document.documentElement, 'clientWidth', { get: () => 500 });
  resized.events.get('window:resize')();
  resized.flushTimer();
  resized.flushFrame();
  assert.equal(diagnostic(resized).reason, 'insufficient-space');
  assert(resized.nodes.every(node => node.style.values.size === 0));
  const modal = fixture();
  run(modal);
  modal.document.modals = [new Element(modal.document.body, 400, 300)];
  assert.equal(run(modal).reason, 'native-overlay');
  assert(modal.nodes.every(node => node.style.values.size === 0));
  const fullscreen = fixture();
  run(fullscreen);
  fullscreen.document.fullscreenElement = fullscreen.player;
  fullscreen.events.get('document:fullscreenchange')();
  assert.equal(diagnostic(fullscreen).reason, 'native-fullscreen');
  assert(fullscreen.nodes.every(node => node.style.values.size === 0));
});

test('observed SDK sibling and DOM danmu identities survive while unrelated outer branches are hidden', () => {
  const item = fixture();
  const identities = item.nodes.map(node => [node, node.parentElement]);
  // An unrelated global substring match must never become a retained root.
  const outside = new Element(item.document.body, 658, 370);
  outside.className = 'unrelated-Danmu-panel';
  const outcome = run(item);
  assert.equal(outcome.status, 'applied');
  assert.equal(outcome.sdkAligned, true);
  assert.equal(outcome.danmakuRoots, 2);
  assert.equal(item.player.parentElement, item.sdk.parentElement);
  assert.equal(item.sdk.style.getPropertyValue('display'), '');
  assert.equal(item.danmu.style.getPropertyValue('display'), '');
  assert.equal(item.player.style.getPropertyValue('z-index'), '');
  assert.equal(item.sdk.style.getPropertyValue('z-index'), '');
  assert.equal(outside.style.getPropertyValue('display'), 'none');
  for (const [node, parent] of identities) assert.equal(node.parentElement, parent);
  for (const node of [item.nativeControl, item.danmuMessage, item.list, item.input]) assert.equal(node.style.values.size, 0);
  assert.equal(item.danmuMessage.computed.transform, 'matrix(1, 0, 0, 1, 20, 0)');
  assert(item.observers[0].observed.every(({ node, options }) => node !== item.danmuMessage && node !== item.list && options.subtree !== true));
  assert(item.observers[0].observed.filter(({ node }) => node === item.danmu || node === item.fixedDanmu)
    .every(({ options }) => options.attributes === true && options.childList !== true));
  run(item, { ...prefs, compact: false });
  assert.equal(outside.style.values.size, 0);
  assert(item.nodes.every(node => node.style.values.size === 0));
  assert.equal(item.video.events.size, 0);
});

test('video, SDK and outer DOM renderers share the complete contain rectangle for chat, small and non-16:9 cases', () => {
  const cases = [
    { viewport: [703, 272], source: [1920, 1080], chat: false, box: [109.7222222222, 0, 483.5555555556, 272] },
    { viewport: [524, 272], source: [1920, 1080], chat: true, box: [0, 95.5, 144, 81] },
    { viewport: [220, 120], source: [1920, 1080], chat: false, box: [3.3333333333, 0, 213.3333333333, 120] },
    { viewport: [160, 90], source: [1920, 1080], chat: false, box: [0, 0, 160, 90] },
    { viewport: [1280, 720], source: [1920, 1080], chat: true, box: [0, 106.875, 900, 506.25] },
    { viewport: [1200, 900], source: [1440, 1080], chat: false, box: [0, 0, 1200, 900] },
    { viewport: [703, 272], source: [1080, 1920], chat: false, box: [275, 0, 153, 272] }
  ];
  for (const sample of cases) {
    const item = fixture();
    Object.defineProperty(item.document.documentElement, 'clientWidth', { get: () => sample.viewport[0] });
    Object.defineProperty(item.document.documentElement, 'clientHeight', { get: () => sample.viewport[1] });
    [item.video.videoWidth, item.video.videoHeight] = sample.source;
    assert.equal(run(item, { ...prefs, chatVisible: sample.chat }).status, 'applied');
    for (const node of [item.player, item.sdk, item.video, item.danmu, item.fixedDanmu]) {
      const box = node.getBoundingClientRect();
      for (const [index, key] of ['x', 'y', 'width', 'height'].entries()) assert(Math.abs(box[key] - sample.box[index]) < 1e-6, `${key}: ${box[key]} != ${sample.box[index]}`);
    }
    assert.equal(item.nativeControl.style.values.size, 0);
    assert.equal(item.danmuMessage.style.values.size, 0);
  }
});

test('unknown or ambiguous SDK structures fail before modifying any native styles', () => {
  const variants = [
    item => { item.danmu.className = ''; item.fixedDanmu.className = ''; item.danmuMessage.className = ''; },
    item => { const peer = new Element(item.frame, 658, 370); const root = new Element(peer, 658, 370); root.className = 'another-danmu'; },
    item => { const foreignVideo = new Element(item.sdk); foreignVideo.tagName = 'VIDEO'; },
    item => { item.sdk.width = 500; },
    item => { item.sdkChain[0].height = 100; },
    item => { item.sdkChain[0].computed.transform = 'matrix(1, 0, 0, 1, 10, 0)'; },
    item => { new Element(item.frame, 658, 370); }
  ];
  for (const change of variants) {
    const item = fixture(); change(item);
    assert.equal(run(item).status, 'unsupported');
    assert(item.nodes.every(node => node.style.values.size === 0));
    assert.equal(item.observers.length, 0);
    assert.equal(item.video.events.size, 0);
  }
});

test('a real geometry postcheck failure restores owned styles instead of reporting applied', () => {
  const item = fixture();
  item.danmu.rectOverride = function () {
    if (item.frame.style.getPropertyValue('position') === 'fixed') return { x: 0, y: 0, width: 0, height: 0 };
    return { x: 0, y: 0, width: 658, height: 370 };
  };
  const returned = run(item);
  assert.equal(returned.status, 'unsupported');
  assert.equal(returned.reason, 'native-geometry');
  const boxes = vm.runInContext('globalThis[Symbol.for("live-union.douyu.presentation.geometry")]', item.context);
  assert.equal(boxes.part, 'danmu');
  assert.equal(boxes.actual.width, 0);
  assert.equal(boxes.expected.width, 900);
  assert.equal(diagnostic(item).status, 'unsupported');
  assert.equal(state(item), undefined);
  assert(item.nodes.every(node => node.style.values.size === 0));
});

test('SDK path loss or new native frame branches roll back without touching messages', () => {
  for (const mutation of [
    item => { item.sdk.isConnected = false; },
    item => { item.danmu.parentElement = item.sdk; },
    item => { item.danmu.className = ''; },
    item => { new Element(item.frame, 658, 370); }
  ]) {
    const item = fixture();
    assert.equal(run(item).status, 'applied');
    mutation(item);
    item.observers[0].callback(); item.flushTimer(); item.flushFrame();
    assert.equal(diagnostic(item).reason, 'structure-changed');
    assert.equal(state(item), undefined);
    assert(item.nodes.every(node => node.style.values.size === 0));
    assert.equal(item.video.events.size, 0);
    assert.equal(item.events.size, 0);
    assert.equal(item.timers.size, 0);
    assert.equal(item.frames.size, 0);
    assert(item.observers.every(observer => observer.disconnected));
  }
});

test('metadata/aspect resize reuses the native instances and cleans its listeners on restore', () => {
  const item = fixture();
  assert.equal(run(item).status, 'applied');
  const installed = state(item);
  item.video.videoWidth = 1440;
  item.video.events.get('resize')();
  item.flushTimer(); item.flushFrame();
  assert.equal(state(item), installed);
  assert.equal(diagnostic(item).contentWidth, 900);
  assert.equal(diagnostic(item).contentHeight, 675);
  assert.deepEqual(item.video.getBoundingClientRect(), item.danmu.getBoundingClientRect());
  item.video.events.get('loadedmetadata')();
  assert.equal(item.timers.size, 1);
  run(item, { ...prefs, compact: false });
  assert.equal(item.timers.size, 0);
  assert.equal(item.video.events.size, 0);
  assert.equal(item.danmuMessage.style.values.size, 0);
});

test('unavailable intrinsic media geometry is an honest full-page fallback', () => {
  for (const dimension of [0, NaN, Infinity, 1e8]) {
    const item = fixture(); item.video.videoWidth = dimension;
    assert.equal(run(item).reason, 'native-geometry');
    assert(item.nodes.every(node => node.style.values.size === 0));
  }
});

test('native display/visibility switches remain independent of chat and are never forcibly enabled', () => {
  const item = fixture();
  item.fixedDanmu.computed.visibility = 'hidden';
  item.fixedDanmu.computed.opacity = '0.4';
  assert.equal(run(item).status, 'applied');
  item.danmu.style.setProperty('display', 'none');
  item.observers[0].callback(); item.flushTimer(); item.flushFrame();
  assert.equal(diagnostic(item).status, 'applied');
  assert.equal(item.danmu.style.getPropertyValue('display'), 'none');
  assert.equal(run(item, { ...prefs, chatVisible: false }).status, 'applied');
  assert.equal(item.danmu.style.getPropertyValue('display'), 'none');
  assert.equal(item.fixedDanmu.style.getPropertyValue('visibility'), '');
  assert.equal(item.fixedDanmu.style.getPropertyValue('opacity'), '');
  item.danmu.style.removeProperty('display');
  item.fixedDanmu.computed.visibility = 'visible';
  item.observers[0].callback(); item.flushTimer(); item.flushFrame();
  assert.equal(diagnostic(item).status, 'applied');
  assert.deepEqual(item.video.getBoundingClientRect(), item.danmu.getBoundingClientRect());
  assert.deepEqual(item.video.getBoundingClientRect(), item.fixedDanmu.getBoundingClientRect());
  assert.equal(item.danmuMessage.style.values.size, 0);
});

test('initially disabled native roots retain their disabled state, and reopening stale geometry falls back', () => {
  const item = fixture();
  item.danmu.style.setProperty('display', 'none');
  item.fixedDanmu.style.setProperty('display', 'none');
  assert.equal(run(item).status, 'applied');
  assert.equal(item.danmu.style.values.size, 1, 'do not size or enable an unproven hidden root');
  assert.equal(item.fixedDanmu.style.values.size, 1);
  assert(item.sdkChain.every(node => node.style.values.size === 0));
  item.danmu.style.removeProperty('display');
  item.observers[0].callback(); item.flushTimer(); item.flushFrame();
  assert.equal(diagnostic(item).status, 'unsupported');
  assert.equal(diagnostic(item).reason, 'native-geometry');
  assert.equal(state(item), undefined);
  assert.equal(item.fixedDanmu.style.getPropertyValue('display'), 'none');
  assert.equal(item.video.events.size, 0);
  assert.equal(item.danmuMessage.style.values.size, 0);
});

test('observed zero-area frame sibling branches are retained inert and fail if they grow active', () => {
  const item = fixture();
  const inertA = new Element(item.frame, 658, 0);
  const inertB = new Element(item.frame, 658, 0);
  new Element(inertA, 0, 0); new Element(inertB, 0, 0);
  assert.equal(run(item).status, 'applied');
  assert.equal(inertA.style.values.size, 0);
  assert.equal(inertB.style.values.size, 0);
  inertA.height = 100;
  item.observers[0].callback(); item.flushTimer(); item.flushFrame();
  assert.equal(diagnostic(item).reason, 'structure-changed');
  assert.equal(state(item), undefined);
});

test('native SDK inputs and in-player editors remain attached without reading values', () => {
  const item = fixture();
  const controls = ['INPUT', 'TEXTAREA'].map(tagName => {
    const node = new Element(item.nativeControl); node.tagName = tagName;
    Object.defineProperty(node, 'value', { get() { throw Error('Native value must not be read'); } });
    return node;
  });
  assert.equal(run(item).status, 'applied');
  for (const node of controls) {
    assert.equal(node.parentElement, item.nativeControl);
    assert.equal(node.style.values.size, 0);
  }
  assert.equal(run(item, { ...prefs, compact: false }).status, 'restored');
  assert(item.nodes.every(node => node.style.values.size === 0));
});

test('native zero-area placeholders may be added and removed; active branches still roll back', () => {
  const item = fixture();
  const placeholder = new Element(item.frame, 658, 0);
  assert.equal(run(item).status, 'applied');
  item.frame.children.splice(item.frame.children.indexOf(placeholder), 1);
  placeholder.isConnected = false; placeholder.parentElement = null;
  const replacement = new Element(item.frame, 658, 0);
  assert.equal(run(item).status, 'applied');
  replacement.height = 20;
  assert.equal(run(item).reason, 'structure-changed');
  assert(item.nodes.every(node => node.style.values.size === 0));
});
