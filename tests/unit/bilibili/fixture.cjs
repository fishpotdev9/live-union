'use strict';
const vm = require('node:vm');
const { build } = require('../../../src/platforms/bilibili/presentation.cjs');

class Node {
  constructor(tag, selectors = [], width = 0, height = 0) {
    this.tagName = tag.toUpperCase(); this.selectors = selectors;
    this.children = []; this.parentElement = null; this.isConnected = true;
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
    child.parentElement = this; child.ownerDocument = this.ownerDocument;
    this.children.push(child); return child;
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    const choices = selector.split(',').map(value => value.trim());
    return this.children.flatMap(child => [
      ...(choices.some(value => child.tagName.toLowerCase() === value || child.selectors.includes(value)) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.tagName.toLowerCase() === selector ? this : this.parentElement?.closest(selector) || null; }
  getBoundingClientRect() { return this.measure ? this.measure() : { x: 0, y: 0, ...this.bounds }; }
  get clientWidth() { return Math.max(0, Math.floor(this.getBoundingClientRect().width)); }
  get scrollWidth() { return Math.max(this.clientWidth, this.minimumScrollWidth || 0); }
  addEventListener(event, callback) {
    if (!this.events.has(event)) this.events.set(event, new Set());
    this.events.get(event).add(callback);
  }
  removeEventListener(event, callback) { this.events.get(event)?.delete(callback); }
  fire(event) { for (const callback of [...(this.events.get(event) || [])]) callback(); }
}
function documentFixture() {
  const doc = new Node('document');
  doc.location = { origin: 'https://live.bilibili.com' }; doc.readyState = 'complete';
  doc.ownerDocument = doc; doc.documentElement = doc.add(new Node('html'));
  doc.body = doc.documentElement.add(new Node('body'));
  doc.defaultView = new Node('window');
  doc.defaultView.getComputedStyle = node => ({ display: node.style.getPropertyValue('display') || 'block',
    visibility: node.style.getPropertyValue('visibility') || 'visible' });
  return doc;
}
function fixture({ crossOrigin = false, noList = false, width = 900, height = 500, direct = false,
  responsiveHidden = false, brokenSend = false } = {}) {
  const main = documentFixture();
  const room = direct ? main : documentFixture();
  const navigation = main.body.add(new Node('header'));
  const script = main.body.add(new Node('script'));
  const shell = main.body.add(new Node('div'));
  shell.style.setProperty('z-index', '0', 'important'); shell.style.setProperty('isolation', 'isolate', '');
  const activityBanner = shell.add(new Node('div'));
  const frame = direct ? null : shell.add(new Node('iframe'));
  if (frame) {
    frame.contentDocument = crossOrigin ? null : room;
    frame.contentWindow = { location: { origin: crossOrigin ? 'https://other.example' : room.location.origin } };
  }
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
  const sendInner = send.add(new Node('div', [], 300, 109));
  const input = sendInner.add(new Node('div', ['.chat-input-ctnr'], 284, 50));
  const inputPrefix = input.add(new Node('span', [], 63, 36));
  const textareaWrap = input.add(new Node('div', [], 141, 36));
  const textarea = textareaWrap.add(new Node('textarea', [], 141, 36));
  const sendButton = input.add(new Node('button', [], 64, 36));
  const observers = []; const events = new Map(); const animation = new Map(); let sequence = 0;
  const context = vm.createContext({ document: main, innerWidth: width, innerHeight: height,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; this.targets = []; observers.push(this); }
      observe(target, options) { this.targets.push({ target, options }); }
      disconnect() { this.disconnected = true; }
    },
    requestAnimationFrame: callback => { animation.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: id => animation.delete(id),
    addEventListener: (event, callback) => { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(callback); },
    removeEventListener: (event, callback) => events.get(event)?.delete(callback),
  });
  // A small CSS layout fixture, not a browser: native responsive rules hide
  // these branches until the actual ancestor path has an explicit display.
  const responsiveNodes = [chat, panel, list, send, sendInner, input, textareaWrap, textarea];
  function hidden(node) {
    for (let current = node; current; current = current.parentElement) {
      const display = current.style.getPropertyValue('display');
      if (display === 'none' || (responsiveHidden && responsiveNodes.includes(current) && !display)) return true;
    }
    return false;
  }
  const zero = () => ({ x: 0, y: 0, width: 0, height: 0 });
  const chatBox = () => {
    const w = Number.parseFloat(chat.style.getPropertyValue('width')) || 300;
    return { x: context.innerWidth - w, y: 0, width: w, height: context.innerHeight };
  };
  const sendBox = () => {
    const box = chatBox();
    const h = brokenSend ? 0 : send.bounds.height;
    return { x: box.x, y: box.height - h, width: box.width, height: h };
  };
  const inputBox = () => {
    const box = sendBox();
    return { x: box.x + 8, y: box.y + box.height - 61, width: box.width - 16, height: 50 };
  };
  const historyBox = () => {
    const box = chatBox();
    return { x: box.x, y: 0, width: box.width, height: box.height - sendBox().height };
  };
  const textBox = () => {
    const box = inputBox();
    return { x: box.x + 79, y: box.y + 7, width: Math.max(0, box.width - 143), height: 36 };
  };
  const geometries = new Map([[chat, chatBox], [panel, historyBox], [send, sendBox], [sendInner, sendBox],
    [input, inputBox], [textareaWrap, textBox], [textarea, textBox], [list, () => {
      const box = historyBox(); return { ...box, height: Math.max(0, box.height - 30) };
    }], [inputPrefix, () => { const box = inputBox(); return { x: box.x, y: box.y + 7, width: 63, height: 36 }; }],
    [sendButton, () => { const box = inputBox(); return { x: box.x + box.width - 64, y: box.y + 7, width: 64, height: 36 }; }]]);
  for (const [node, geometry] of geometries) node.measure = () => {
    if (hidden(node)) return zero();
    if (!chat.style.getPropertyValue('display')) return { x: 0, y: 0, ...node.bounds };
    return geometry();
  };
  // Native buttons/emoji need the observed 284px row; squeezing the row is a
  // real geometry failure instead of a fixture that always reports success.
  input.minimumScrollWidth = 284;
  const nodes = [];
  function gather(node) { nodes.push(node); for (const child of node.children) gather(child); }
  gather(main); if (!direct) gather(room);
  const original = nodes.map(node => ({ node, parent: node.parentElement, properties: new Map(node.properties) }));
  const run = (prefs = { compact: true, chatVisible: false, chatWidthDip: 300 }) => vm.runInContext(build(prefs), context);
  const result = () => vm.runInContext("globalThis[Symbol.for('live-union.presentation.result')]", context);
  const state = () => vm.runInContext("globalThis[Symbol.for('live-union.bilibili.presentation.state')]", context);
  const fire = event => { for (const callback of [...(events.get(event) || [])]) callback(); };
  const flush = () => { const pending = [...animation.values()]; animation.clear(); for (const callback of pending) callback(); };
  return { run, result, state, context, original, nodes, fire, flush, animation, main, room, navigation,
    script, shell, activityBanner, frame, section, left, wrap, player, video, chat, panel, list, send,
    sendInner, input, inputPrefix, sendButton, textareaWrap, textarea, observers, events, Node };
}
module.exports = { fixture, Node };
