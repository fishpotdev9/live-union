'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { build } = require('../../../src/platforms/douyu/presentation.cjs');
const { fixture, Element } = require('./mock-dom.cjs');
const prefs = { compact: true, chatVisible: true, chatWidthDip: 380 };
const run = (item, values = prefs) => vm.runInContext(build(values), item.context);
const state = item => item.window[Symbol.for('live-union.douyu.presentation.state')];
const diagnostic = item => vm.runInContext('globalThis[Symbol.for("live-union.presentation.result")]', item.context);
const styles = item => item.nodes.map(node => [...node.style.values]);
function move(node, parent) {
  node.parentElement.children.splice(node.parentElement.children.indexOf(node), 1);
  node.parentElement = parent;
  parent.children.push(node);
}

test('native three- and four-layer chat retain measured offsets, instances and original styles across presentation changes', () => {
  for (const depth of [3, 4]) for (const initiallyVisible of [false, true]) {
    const item = fixture(false, depth);
    let width = 703;
    Object.defineProperty(item.document.documentElement, 'clientWidth', { get: () => width });
    Object.defineProperty(item.document.documentElement, 'clientHeight', { get: () => 272 });
    item.list.style.setProperty('color', 'rgb(1, 2, 3)');
    item.input.style.setProperty('background', 'rgb(4, 5, 6)');
    const originals = styles(item);
    const identities = item.nodes.map(node => [node, node.parentElement]);
    const untouched = [item.list, item.input, item.nativeControl, item.danmuMessage].map(node => [...node.style.values]);
    assert.equal(run(item, { ...prefs, chatVisible: initiallyVisible }).status, 'applied');
    const installed = state(item);
    assert.equal(run(item, { ...prefs, chatVisible: false }).status, 'applied');
    assert.equal(item.aside.style.getPropertyValue('display'), 'none');
    // Showing chat must reuse the captured native offsets, not measure the
    // temporarily hidden subtree and replace them with zero-sized gaps.
    assert.equal(run(item).status, 'applied');
    assert.equal(item.aside.style.getPropertyValue('display'), 'block');
    const expectedWidths = depth === 3 ? ['- 0', '- 0', '- 0'] : ['- 0', '- 0', '- 0', '+ 15'];
    const expectedHeights = depth === 3 ? ['- 0', '- 46', '- 0'] : ['- 0', '- 46', '- 0', '+ 15'];
    for (const [index, node] of item.scrollWrappers.entries()) {
      assert.equal(node.style.getPropertyValue('width'), `calc(100% ${expectedWidths[index]}px)`);
      assert.equal(node.style.getPropertyValue('height'), `calc(100% ${expectedHeights[index]}px)`);
    }
    assert.equal(run(item).status, 'applied');
    width = 524;
    item.events.get('window:resize')(); item.flushTimer(); item.flushFrame();
    assert.equal(diagnostic(item).status, 'applied');
    assert.equal(diagnostic(item).playerWidth, 144);
    assert.equal(state(item), installed);
    assert.equal(item.observers.length, 1);
    for (const [node, parent] of identities) assert.equal(node.parentElement, parent);
    assert.deepEqual([item.list, item.input, item.nativeControl, item.danmuMessage].map(node => [...node.style.values]), untouched);
    assert.equal(run(item, { ...prefs, compact: false }).status, 'restored');
    assert.deepEqual(styles(item), originals);
    assert.equal(item.timers.size, 0); assert.equal(item.frames.size, 0);
    assert.equal(item.events.size, 0); assert.equal(item.video.events.size, 0);
    assert(item.observers.every(observer => observer.disconnected));
  }
});

test('three-layer native fractional viewport compensation is preserved', () => {
  const item = fixture(false, 3);
  item.scrollWrappers[1].height = item.scrollWrappers[2].height = 237.5;
  assert.equal(run(item).status, 'applied');
  assert.equal(item.scrollWrappers[1].style.getPropertyValue('height'), 'calc(100% - 45.5px)');
  assert.equal(run(item, { ...prefs, compact: false }).status, 'restored');
  assert(item.nodes.every(node => node.style.values.size === 0));
});

test('unknown chat scroll depths still reject before changing native styles, even when chat is hidden', () => {
  for (const depth of [0, 1, 2, 5, 8, 9]) for (const chatVisible of [false, true]) {
    const item = fixture(false, depth);
    assert.equal(run(item, { ...prefs, chatVisible }).reason, 'native-scroll-geometry');
    assert(item.nodes.every(node => node.style.values.size === 0));
    assert.equal(item.observers.length, 0);
    assert.equal(state(item), undefined);
  }
});

test('both supported chat chains keep finite bounded width and height gap checks', () => {
  const invalid = [
    node => { node.width = 219; }, // widthGap 161
    node => { node.width = 405; }, // widthGap -25
    node => { node.height = 76; }, // heightGap 161 (four-layer parent is also 237)
    node => { node.height = 262; }, // heightGap -25
    node => { node.width = NaN; },
    node => { node.height = Infinity; },
  ];
  for (const depth of [3, 4]) for (const mutate of invalid) for (const chatVisible of [false, true]) {
    const item = fixture(false, depth);
    mutate(item.scrollWrappers.at(-1));
    assert.equal(run(item, { ...prefs, chatVisible }).reason, 'native-scroll-geometry');
    assert(item.nodes.every(node => node.style.values.size === 0));
    assert.equal(item.observers.length, 0);
  }
  for (const depth of [3, 4]) for (const gap of [-24, 160]) {
    const item = fixture(false, depth);
    item.scrollWrappers.at(-1).width = 380 - gap;
    item.scrollWrappers.at(-1).height = 237 - gap;
    assert.equal(run(item).status, 'applied');
    assert.equal(run(item, { ...prefs, compact: false }).status, 'restored');
  }
});

test('connected chat wrapper replacements and reparenting roll back before applying stale geometry', () => {
  const mutations = [
    item => {
      const node = item.scrollWrappers[1];
      const inserted = new Element(node.parentElement, node.width, node.height);
      item.nodes.push(inserted); move(node, inserted);
    },
    item => { move(item.scrollWrappers[1], item.aside); },
    item => {
      const node = item.scrollWrappers[1];
      const replacement = new Element(node.parentElement, node.width, node.height);
      item.nodes.push(replacement);
      for (const child of [...node.children]) move(child, replacement);
      move(node, item.aside); // Old wrappers remain connected and under aside.
    },
    item => { move(item.barrageChain[0], item.aside); },
    item => { move(item.barrage, item.aside); },
    item => { move(item.list, item.scrollWrappers[0]); },
  ];
  for (const depth of [3, 4]) for (const mutate of mutations) for (const asynchronous of [false, true]) {
    const item = fixture(false, depth);
    assert.equal(run(item, { ...prefs, chatVisible: false }).status, 'applied');
    mutate(item);
    assert(item.nodes.every(node => node.isConnected));
    let staleWrites = 0;
    for (const node of [...item.scrollWrappers, ...item.barrageChain, item.barrage]) {
      const original = node.style.setProperty.bind(node.style);
      node.style.setProperty = (...args) => { staleWrites++; original(...args); };
    }
    if (asynchronous) {
      item.observers[0].callback(); item.flushTimer(); item.flushFrame();
      assert.equal(diagnostic(item).reason, 'structure-changed');
    } else assert.equal(run(item).reason, 'structure-changed');
    assert.equal(staleWrites, 0);
    assert.equal(state(item), undefined);
    assert(item.nodes.every(node => node.style.values.size === 0));
    assert.equal(item.events.size, 0); assert.equal(item.video.events.size, 0);
    assert.equal(item.timers.size, 0); assert.equal(item.frames.size, 0);
    assert(item.observers.every(observer => observer.disconnected));
  }
});

test('the old production closure is disposed before installing three-layer compatibility', () => {
  const item = fixture(false, 3);
  let disposed = false;
  item.window[Symbol.for('live-union.douyu.presentation.state')] = {
    version: '2026.11.07.3',
    dispose() { disposed = true; },
    update() { throw Error('Old production version must not handle the new chain'); },
  };
  assert.equal(run(item).status, 'applied');
  assert.equal(disposed, true);
  assert.equal(state(item).version, '2026.11.21.1');
});
