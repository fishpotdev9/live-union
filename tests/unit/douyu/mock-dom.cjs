'use strict';
// Offline bounded layout arithmetic/rollback checks only. This models the
// observed native sibling relation, not Chromium painting or compatibility.
const vm = require('node:vm');

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
    this.events = new Map();
    this.className = '';
    this.computed = {};
  }
  querySelectorAll(selector) {
    if (this.queries.has(selector)) return this.queries.get(selector);
    const selectors = selector.split(',').map(value => value.trim());
    const matches = node => selectors.some(value => {
      if (value === '[class*="danmu"]') return node.className.includes('danmu');
      if (value === '[class*="Danmu"]') return node.className.includes('Danmu');
      if (value === '[contenteditable="true"]' || value === '[role="textbox"]') return false;
      return value.toUpperCase() === node.tagName;
    });
    const found = [];
    const walk = node => { for (const child of node.children) { if (matches(child)) found.push(child); walk(child); } };
    walk(this);
    return found;
  }
  contains(node) {
    for (let candidate = node; candidate; candidate = candidate.parentElement) if (candidate === this) return true;
    return false;
  }
  addEventListener(name, callback) { this.events.set(name, callback); }
  removeEventListener(name) { this.events.delete(name); }
  getBoundingClientRect() {
    if (this.rectOverride) return this.rectOverride();
    for (let node = this; node; node = node.parentElement) if (node.style.getPropertyValue('display') === 'none' || node.computed.display === 'none') return { x: 0, y: 0, width: 0, height: 0 };
    const parent = this.parentElement?.getBoundingClientRect() || { x: 0, y: 0, width: 1280, height: 720 };
    const measure = (property, fallback, available) => {
      const value = this.style.getPropertyValue(property);
      if (!value) return fallback;
      if (value.endsWith('%')) return parseFloat(value) * available / 100;
      if (value.endsWith('px')) return parseFloat(value);
      return fallback;
    };
    const fixed = this.style.getPropertyValue('position') === 'fixed';
    return {
      x: (fixed ? 0 : parent.x) + measure('left', 0, parent.width),
      y: (fixed ? 0 : parent.y) + measure('top', 0, parent.height),
      width: measure('width', this.width, parent.width), height: measure('height', this.height, parent.height)
    };
  }
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
  const frame = new Element(main, 658, 370);
  const player = new Element(frame, 658, 370);
  const mediaParent = new Element(player, 658, 370);
  const video = new Element(mediaParent, 658, 370);
  video.tagName = 'VIDEO';
  video.videoWidth = 1920;
  video.videoHeight = 1080;
  const sdk = new Element(frame, 658, 370);
  const sdkChain = [];
  for (let parent = sdk, index = 0; index < 5; index++) {
    const wrapper = new Element(parent, 658, 370);
    sdkChain.push(wrapper); parent = wrapper;
  }
  const danmu = new Element(sdkChain.at(-1), 658, 370);
  danmu.className = 'native-danmu-root';
  const fixedDanmu = new Element(sdkChain.at(-1), 658, 370);
  fixedDanmu.className = 'native-Danmu-root';
  const danmuMessage = new Element(danmu, 200, 39.5);
  danmuMessage.className = 'native-danmu-item';
  danmuMessage.computed.transform = 'matrix(1, 0, 0, 1, 20, 0)';
  const nativeControl = new Element(sdk);
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
  input.tagName = 'TEXTAREA';
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
    getComputedStyle: node => {
      const result = { transform: 'none', filter: 'none', perspective: 'none', contain: 'none', willChange: 'auto', position: 'static', display: 'block', visibility: 'visible', opacity: '1', ...node.computed };
      for (const [key, value] of node.style.values) result[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value.value;
      return result;
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
      observe(node, options) { (this.observed ||= []).push({ node, options }); }
      disconnect() { this.disconnected = true; }
    },
    setTimeout(callback) { timers.set(++callbackId, callback); return callbackId; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { frames.set(++callbackId, callback); return callbackId; },
    cancelAnimationFrame(id) { frames.delete(id); }
  });
  const flush = map => { const [id, callback] = map.entries().next().value; map.delete(id); callback(); };
  return { context, window, document, events, observers, timers, frames, frame, player, sdk, sdkChain, danmu, fixedDanmu, danmuMessage, aside, chat, list, input, video, header, main, navAside, nativeControl, resources,
    flushTimer: () => flush(timers), flushFrame: () => flush(frames),
    nodes: [html, body, header, main, navAside, ...resources, frame, player, mediaParent, video, sdk, ...sdkChain, danmu, fixedDanmu, danmuMessage, nativeControl, aside, outer, middle, barrage, branch, wrap, viewport, content, list, chat, input] };
}
module.exports = { fixture, Element };
