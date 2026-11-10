'use strict';

// Offline behavioral checks only. This deliberately does not emulate browser layout.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { build } = require('./presentation.cjs');

class Node {
  constructor(tag, selectors = [], width = 0, height = 0) {
    this.tagName = tag.toUpperCase();
    this.selectors = selectors;
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.bounds = { width, height };
    this.properties = new Map([['opacity', ['0.97', '']], ['padding-left', ['3px', 'important']]]);
    this.style = {
      getPropertyValue: property => this.properties.get(property)?.[0] || '',
      getPropertyPriority: property => this.properties.get(property)?.[1] || '',
      setProperty: (property, value, priority) => this.properties.set(property, [value, priority]),
      removeProperty: property => this.properties.delete(property),
    };
    this.events = new Map();
    for (const forbidden of ['value', 'textContent', 'innerText', 'src', 'currentSrc', 'muted', 'volume', 'currentTime']) {
      Object.defineProperty(this, forbidden, {
        get() { throw new Error(`Forbidden read: ${forbidden}`); },
        set() { throw new Error(`Forbidden write: ${forbidden}`); },
      });
    }
  }
  add(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.tagName.toLowerCase() === selector || child.selectors.includes(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    return this.tagName.toLowerCase() === selector ? this : this.parentElement?.closest(selector) || null;
  }
  getBoundingClientRect() { return this.bounds; }
  addEventListener(event, callback) { this.events.set(event, callback); }
  removeEventListener(event, callback) { if (this.events.get(event) === callback) this.events.delete(event); }
}

function documentFixture() {
  const doc = new Node('document');
  doc.location = { origin: 'https://live.bilibili.com' };
  doc.ownerDocument = doc;
  doc.documentElement = doc.add(new Node('html'));
  doc.body = doc.documentElement.add(new Node('body'));
  return doc;
}
function fixture({ crossOrigin = false, noList = false, width = 742 } = {}) {
  const main = documentFixture();
  const room = documentFixture();
  const navigation = main.body.add(new Node('header'));
  const script = main.body.add(new Node('script'));
  const shell = main.body.add(new Node('div'));
  shell.style.setProperty('z-index', '0', 'important');
  shell.style.setProperty('isolation', 'isolate', '');
  const activityBanner = shell.add(new Node('div'));
  const frame = shell.add(new Node('iframe'));
  frame.contentDocument = crossOrigin ? null : room;
  frame.contentWindow = { location: { origin: crossOrigin ? 'https://other.example' : room.location.origin } };
  const section = room.body.add(new Node('section'));
  const left = section.add(new Node('div'));
  left.add(new Node('header'));
  const wrap = left.add(new Node('div'));
  const player = wrap.add(new Node('div', ['#live-player'], 1008, 567));
  const video = player.add(new Node('video'));
  wrap.add(new Node('footer'));
  const chat = section.add(new Node('div'));
  chat.add(new Node('header'));
  const panel = chat.add(new Node('div', ['.chat-history-panel'], 300, 498));
  const list = panel.add(new Node('div', noList ? [] : ['.chat-history-list'], 300, 468));
  const send = chat.add(new Node('div', [], 300, 109));
  const input = send.add(new Node('div', ['.chat-input-ctnr']));
  const textarea = input.add(new Node('textarea'));
  const observers = [];
  const events = new Map();
  const context = vm.createContext({ document: main, innerWidth: width, innerHeight: 370,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe(_target, options) { assert.equal(options.subtree, undefined); }
      disconnect() { this.disconnected = true; }
    },
    addEventListener: (event, callback) => events.set(event, callback),
    removeEventListener: (event, callback) => { if (events.get(event) === callback) events.delete(event); },
  });
  const nodes = [main, room, ...main.querySelectorAll('*')];
  function gather(node) { for (const child of node.children) { nodes.push(child); gather(child); } }
  gather(main); gather(room);
  const original = nodes.map(node => ({ node, parent: node.parentElement, properties: new Map(node.properties) }));
  const run = prefs => vm.runInContext(build(prefs), context);
  function unchanged() {
    for (const saved of original) {
      assert.equal(saved.node.parentElement, saved.parent, 'native node identity/parent is retained');
      assert.deepEqual(saved.node.properties, saved.properties, 'original style values and priorities restored');
    }
  }
  return { run, unchanged, frame, navigation, script, shell, activityBanner,
    player, video, chat, list, panel, input, textarea, observers, events };
}

for (const prefs of [{}, { compact: true }, { compact: false }, null,
  { compact: true, chatVisible: false, chatWidthDip: 500 }, { chatWidthDip: Infinity }]) {
  new vm.Script(build(prefs));
}
assert.equal(build({ chatWidthDip: 1 }), build({ chatWidthDip: 140 }));
assert.equal(build({ chatWidthDip: 999 }), build({ chatWidthDip: 500 }));

const sample = fixture();
assert.equal(sample.run({ compact: true }).status, 'applied');
assert.equal(sample.navigation.style.getPropertyValue('display'), 'none');
assert.equal(sample.activityBanner.style.getPropertyValue('display'), 'none');
assert.equal(sample.script.style.getPropertyValue('display'), '', 'outer script is retained');
assert.equal(sample.shell.style.getPropertyValue('z-index'), 'auto');
assert.equal(sample.shell.style.getPropertyValue('isolation'), 'auto');
assert.equal(sample.video.style.getPropertyValue('object-fit'), 'contain');
assert.equal(sample.chat.style.getPropertyValue('display'), 'flex');
assert.equal(sample.run({ compact: true, chatVisible: false }).status, 'applied');
assert.equal(sample.chat.style.getPropertyValue('display'), 'none');
assert.equal(sample.observers[0].disconnected, true, 'reapply tears down previous observer');
assert.equal(sample.run({ compact: false }).status, 'restored');
assert.equal(sample.run({ compact: false }).status, 'restored');
sample.unchanged();
assert(sample.observers.every(observer => observer.disconnected));
assert.equal(sample.events.size, 0);
assert.equal(sample.frame.events.size, 0);

for (const options of [{ crossOrigin: true }, { noList: true }, { width: 400 }]) {
  const unsupported = fixture(options);
  assert.equal(unsupported.run({ compact: true }).status, 'unsupported');
  unsupported.unchanged();
  assert.equal(unsupported.observers.length, 0);
}
const narrow = fixture();
assert.equal(narrow.run({ compact: true, chatWidthDip: 140 }).reason, 'insufficient-control-space');
narrow.unchanged();

const changed = fixture();
assert.equal(changed.run({ compact: true }).status, 'applied');
changed.video.isConnected = false;
changed.observers[0].callback();
changed.unchanged();
assert.equal(changed.observers[0].disconnected, true);
assert.equal(changed.events.size, 0);

console.log('Bilibili offline checks passed: build bounds, same-origin discovery, native-node preservation,');
console.log('style/priority rollback, repeated attach/detach, missing/cross-origin/space fallback, invalidation cleanup.');
console.log('Browser geometry, native controls, playback, chat, audio and platform compatibility remain untested.');
