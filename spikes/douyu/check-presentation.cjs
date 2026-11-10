'use strict';
// Offline control/rollback checks only: this deliberately is not a browser mock
// capable of proving CSS layout or Douyu compatibility.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { build } = require('./presentation.cjs');

class InlineStyle {
  constructor() { this.values = new Map(); }
  getPropertyValue(name) { return this.values.get(name)?.value || ''; }
  getPropertyPriority(name) { return this.values.get(name)?.priority || ''; }
  setProperty(name, value, priority = '') { this.values.set(name, { value, priority }); }
  removeProperty(name) { this.values.delete(name); }
}
class Element {
  constructor(parent, width = 380, height = 283) {
    this.parentElement = parent;
    this.children = [];
    this.tagName = 'DIV';
    if (parent) parent.children.push(this);
    this.style = new InlineStyle();
    this.isConnected = true;
    this.width = width;
    this.height = height;
    this.queries = new Map();
  }
  querySelectorAll(selector) { return this.queries.get(selector) || []; }
  contains(node) {
    for (let candidate = node; candidate; candidate = candidate.parentElement) if (candidate === this) return true;
    return false;
  }
  getBoundingClientRect() { return { x: 0, y: 0, width: this.width, height: this.height }; }
}
function fixture(scrollbars = false) {
  const html = new Element(null, 1280, 720);
  html.clientWidth = 1280;
  html.clientHeight = 720;
  const body = new Element(html);
  const header = new Element(body, 1280, 60);
  const main = new Element(body, 1280, 720);
  const navAside = new Element(body, 1280, 720);
  const resources = ['SCRIPT', 'STYLE', 'LINK'].map(tagName => {
    const node = new Element(body);
    node.tagName = tagName;
    return node;
  });
  Object.defineProperty(html, 'clientWidth', { get() {
    return scrollbars && (html.style.getPropertyValue('overflow-y') !== 'hidden' || body.style.getPropertyValue('overflow-y') !== 'hidden') ? 1265 : 1280;
  } });
  Object.defineProperty(html, 'clientHeight', { get() {
    return scrollbars && (html.style.getPropertyValue('overflow-x') !== 'hidden' || body.style.getPropertyValue('overflow-x') !== 'hidden') ? 705 : 720;
  } });
  const player = new Element(main, 658, 370);
  const mediaParent = new Element(player, 658, 370);
  const video = new Element(mediaParent, 658, 370);
  const nativeControl = new Element(player);
  for (const property of ['muted', 'volume', 'src', 'currentTime', 'paused', 'play', 'pause', 'load']) Object.defineProperty(video, property, {
    get() { throw new Error('Unexpected media state read'); }, set() { throw new Error('Unexpected media mutation'); }
  });
  const aside = new Element(main, 380, 596);
  const outer = new Element(aside, 380, 507);
  const middle = new Element(outer, 380, 283);
  const barrage = new Element(middle, 380, 283);
  const branch = new Element(barrage, 380, 283);
  const wrap = new Element(branch, 380, 237);
  const viewport = new Element(wrap, 380, 237);
  const content = new Element(viewport, 395, 252);
  const list = new Element(content, 380, 956);
  const chat = new Element(aside, 380, 89);
  const input = new Element(chat, 237, 42);
  Object.defineProperty(input, 'value', { get() { throw new Error('Unexpected input read'); }, set() { throw new Error('Unexpected input mutation'); } });
  player.queries.set('video', [video]);
  aside.queries.set('.layout-Player-chat', [chat]);
  aside.queries.set('#js-barrage-list', [list]);
  aside.queries.set('.Barrage', [barrage]);
  chat.queries.set('textarea, [contenteditable="true"], [role="textbox"]', [input]);
  const events = new Map();
  const observers = [];
  const timers = new Map();
  const frames = new Map();
  let callbackId = 0;
  const window = {
    addEventListener(name, callback) { events.set('window:' + name, callback); },
    removeEventListener(name) { events.delete('window:' + name); }
  };
  const document = {
    documentElement: html,
    body,
    fullscreenElement: null,
    modals: [],
    querySelectorAll(selector) {
      if (selector === '#js-player-video') return [player];
      if (selector === '#js-player-asideMain') return [aside];
      if (selector === 'body > header') return [header];
      if (selector === '[role="dialog"], [aria-modal="true"]') return this.modals;
      return [];
    },
    addEventListener(name, callback) { events.set('document:' + name, callback); },
    removeEventListener(name) { events.delete('document:' + name); }
  };
  const context = vm.createContext({
    window, document,
    getComputedStyle: () => ({ transform: 'none', filter: 'none', perspective: 'none', contain: 'none', willChange: 'auto', position: 'static', display: 'block', visibility: 'visible' }),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    setTimeout(callback) { timers.set(++callbackId, callback); return callbackId; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { frames.set(++callbackId, callback); return callbackId; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  const flush = map => { const [id, callback] = map.entries().next().value; map.delete(id); callback(); };
  return { context, window, document, events, observers, timers, frames, player, aside, chat, list, input, video, header, main, navAside, nativeControl, resources,
    flushTimer: () => flush(timers), flushFrame: () => flush(frames),
    nodes: [html, body, header, main, navAside, ...resources, player, mediaParent, video, nativeControl, aside, outer, middle, barrage, branch, wrap, viewport, content, list, chat, input] };
}
const prefs = { compact: true, chatVisible: true, chatWidthDip: 380 };
const run = (item, values) => vm.runInContext(build(values), item.context);

for (const compact of [false, true]) for (const chatVisible of [false, true]) for (const chatWidthDip of [140, 240, 380, 500]) {
  const source = build({ compact, chatVisible, chatWidthDip });
  new vm.Script(source);
  const returned = vm.runInNewContext(source, { window: {}, document: { querySelectorAll: () => [] } });
  assert.equal(returned.status, compact ? 'unsupported' : 'restored');
}
for (const chatWidthDip of [NaN, Infinity, 139, 501, '380']) assert.throws(() => build({ ...prefs, chatWidthDip }), TypeError);
assert(!build({ ...prefs, extra: 'UNTRUSTED_EXTRA' }).includes('UNTRUSTED_EXTRA'));

const item = fixture();
const listParent = item.list.parentElement;
const videoParent = item.video.parentElement;
assert.equal(run(item, prefs).status, 'applied');
assert.equal(item.header.style.getPropertyValue('display'), 'none', 'known off-path navigation must not cover source pixels');
assert.equal(item.navAside.style.getPropertyValue('display'), 'none', 'navigation portals outside retained paths must be hidden');
assert(item.resources.every(node => node.style.values.size === 0), 'script/style/link resources must remain untouched');
assert.equal(item.nativeControl.style.values.size, 0, 'player-internal controls must remain untouched');
assert.equal(item.main.style.getPropertyValue('position'), 'relative');
assert.equal(item.main.style.getPropertyValue('z-index'), '2147483000', 'retained ancestor stacking path must be elevated');
assert.equal(item.video.style.getPropertyValue('display'), '', 'native media must not be hidden');
assert.equal(item.observers.length, 1);
assert.equal(run(item, prefs).status, 'applied');
assert.equal(item.observers.length, 1, 'repeated install must reuse its observer');
assert.equal(run(item, { ...prefs, chatVisible: false }).playerWidth, 1280);
assert.equal(item.aside.style.getPropertyValue('display'), 'none');
assert.equal(run(item, prefs).playerWidth, 900);
assert.equal(item.list.parentElement, listParent);
assert.equal(item.video.parentElement, videoParent);
assert.equal(item.list.style.values.size, 0, 'message content must retain native inline layout');
assert.equal(item.input.style.values.size, 0, 'native input must remain untouched');
assert.equal(run(item, { ...prefs, compact: false }).status, 'restored');
assert(item.nodes.every(node => node.style.values.size === 0));
assert(item.observers.every(observer => observer.disconnected));
assert.equal(item.events.size, 0);
assert.equal(run(item, { ...prefs, compact: false }).status, 'restored');

const newer = fixture();
assert.equal(run(newer, prefs).status, 'applied');
newer.player.style.setProperty('width', '777px');
run(newer, { ...prefs, compact: false });
assert.equal(newer.player.style.getPropertyValue('width'), '777px', 'restore must preserve newer platform-owned styles');
const changed = fixture();
assert.equal(run(changed, prefs).status, 'applied');
changed.list.isConnected = false;
assert.equal(run(changed, prefs).reason, 'structure-changed');
assert.equal(changed.events.size, 0);
assert(changed.nodes.every(node => node.style.values.size === 0));
const narrow = fixture();
assert.equal(run(narrow, { ...prefs, chatWidthDip: 240 }).status, 'unsupported');
assert(narrow.nodes.every(node => node.style.values.size === 0));
const scrolled = fixture(true);
scrolled.document.body.style.setProperty('overflow-x', 'auto');
scrolled.document.body.style.setProperty('margin-left', '7px');
assert.equal(scrolled.document.documentElement.clientWidth, 1265);
const fullViewport = run(scrolled, prefs);
assert.equal(fullViewport.width, 1280, 'measure after releasing outer vertical scrollbar');
assert.equal(fullViewport.height, 720, 'measure after releasing outer horizontal scrollbar');
assert.equal(fullViewport.playerWidth, 900);
assert.equal(run(scrolled, prefs).width, 1280, 'repeated application must not progressively shrink');
assert.equal(scrolled.list.style.values.size, 0);
run(scrolled, { ...prefs, compact: false });
assert.equal(scrolled.document.body.style.getPropertyValue('overflow-x'), 'auto');
assert.equal(scrolled.document.body.style.getPropertyValue('margin-left'), '7px');
assert.equal(scrolled.document.documentElement.clientWidth, 1265);
const modal = fixture();
assert.equal(run(modal, prefs).status, 'applied');
modal.document.modals = [new Element(modal.document.body, 400, 300)];
assert.equal(run(modal, prefs).reason, 'native-overlay');
assert.equal(modal.events.size, 0);
assert(modal.nodes.every(node => node.style.values.size === 0), 'semantic dialog must recover the full native page');
const dynamic = fixture();
assert.equal(run(dynamic, prefs).status, 'applied');
const newPortal = new Element(dynamic.document.body, 1280, 60);
for (let index = 0; index < 5; index++) dynamic.observers[0].callback();
assert.equal(dynamic.timers.size, 1, 'mutation bursts must share one throttle timer');
assert.equal(dynamic.frames.size, 0);
dynamic.flushTimer();
assert.equal(dynamic.frames.size, 1);
dynamic.flushFrame();
assert.equal(newPortal.style.getPropertyValue('display'), 'none', 'new off-path siblings must be handled');
dynamic.observers[0].callback();
assert.equal(dynamic.timers.size, 1);
run(dynamic, { ...prefs, compact: false });
assert.equal(dynamic.timers.size, 0, 'restore must cancel pending throttled work');
assert.equal(dynamic.frames.size, 0);
assert.equal(newPortal.style.values.size, 0);
console.log('PASS: build boundaries, unknown structure, idempotence, independent chat toggle, identity preservation, rollback, observer cleanup, newer style ownership, structure-loss fallback. CSS/media/platform behavior NOT tested.');
console.log('PASS: root scrollbar release precedes viewport measurement; repeated geometry remains stable; root overflow and margin restore.');
console.log('PASS: off-path header hide/restore, ancestor stacking path elevation/restore, semantic dialog full-page fallback. Actual pixel occlusion NOT tested.');
console.log('PASS: ordinary body/nav siblings hidden and restored, script/style/link and native controls preserved, newly mounted siblings handled, mutations throttled and timers cleaned, no media API/state access.');
