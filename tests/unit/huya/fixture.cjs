'use strict';
// Deliberately small DOM/RAF model for lifecycle tests, not a CSS engine or a
// platform compatibility fixture. No page body, message or account is included.
module.exports.fixture = function fixture(width = 742, height = 370, extra = 0) {
  const listeners = new Map();
  const observers = [];
  const frames = new Map();
  const timers = new Map();
  let time = 0;
  let nextTimer = 0;
  let styleWrites = 0;
  let nextFrame = 0;
  const box = (x, y, w, h) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
  let html;
  let head;
  let body;
  const path = node => {
    if (node === html) return 'html';
    if (node === body) return 'body';
    const parts = [];
    while (node && node !== body) {
      if (!node.parentElement) return null;
      parts.unshift(':nth-child(' + (node.parentElement.children.indexOf(node) + 1) + ')');
      node = node.parentElement;
    }
    return node === body ? 'body > ' + parts.join(' > ') : null;
  };
  const activeStyle = () => head.children.find(node => node.tag === 'style');
  const properties = node => {
    const css = activeStyle()?.textContent || '';
    const selector = path(node);
    const result = {};
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (match[1].trim() !== selector) continue;
      for (const property of match[2].split(';')) {
        const colon = property.indexOf(':');
        if (colon > 0) result[property.slice(0, colon)] = property.slice(colon + 1).replace('!important', '');
      }
    }
    if (node.style) for (const [name, record] of node.style.entries) {
      if (record.priority === 'important' || result[name] === undefined) result[name] = record.value;
    }
    return result;
  };
  const match = (node, selector) => selector.split(',').some(part => {
    const item = part.trim();
    if (item === 'video' || item === 'textarea') return node.tag === item;
    if (item === '[contenteditable="true"]') return false;
    if (item === '[aria-expanded="true"]') return node.expanded === true;
    if (item === '[aria-hidden="true"]') return node.ariaHidden === true;
    if (item === '[hidden]') return node.hidden === true;
    if (item === ':hover') return node.hovered === true;
    if (item === '[role="menu"]') return node.semanticRole === 'menu';
    if (item === '[role="listbox"]') return node.semanticRole === 'listbox';
    if (item === '[role="dialog"]') return node.semanticRole === 'dialog';
    if (item.startsWith('#')) return node.id === item.slice(1);
    if (item.startsWith('.')) return node.className === item.slice(1);
    return false;
  });
  class Element {
    constructor(tag = 'div', role = '') {
      this.tag = tag; this.role = role; this.children = []; this.parentElement = null;
      this.id = ''; this.className = ''; this.events = new Map();
      if (tag === 'style') {
        let content = '';
        Object.defineProperty(this, 'textContent', { get() { return content; }, set(value) { content = value; styleWrites++; } });
      }
      this.base = box(0, 0, 0, 0);
      this.style = {
        entries: new Map(),
        getPropertyValue(name) { return this.entries.get(name)?.value || ''; },
        getPropertyPriority(name) { return this.entries.get(name)?.priority || ''; },
        setProperty(name, value, priority = '') { this.entries.set(name, { value, priority }); },
        removeProperty(name) { this.entries.delete(name); },
      };
    }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    get isConnected() { return html.contains(this); }
    querySelectorAll(selector) {
      return this.children.flatMap(child => [...(match(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    matches(selector) { return match(this, selector); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    addEventListener(name, listener) { this.events.set(name, listener); }
    removeEventListener(name, listener) { if (this.events.get(name) === listener) this.events.delete(name); }
    getBoundingClientRect() {
      if (!activeStyle() && this.style.getPropertyValue('display') === 'none') return box(0, 0, 0, 0);
      if (!activeStyle()) return this.base;
      const css = properties(this);
      const number = (key, fallback = 0) => css[key] === undefined ? fallback : parseFloat(css[key]);
      if (css.display === 'none') return box(0, 0, 0, 0);
      if (['player', 'stage', 'controls', 'chat'].includes(this.role)) {
        const w = number('width', this.base.width), h = number('height', this.base.height);
        if (this.role === 'controls') {
          const top = css.top !== undefined && css.top !== 'auto' ? parseFloat(css.top) : env.window.innerHeight - h - number('bottom');
          const matrix = css.transform?.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
          return box(number('left') + (matrix?.[4] || 0), top + (matrix?.[5] || 0), w, h);
        }
        return box(this.role === 'chat' ? env.window.innerWidth - w : number('left'),
          number('top'), w, h);
      }
      if (this.role === 'video') return stage.getBoundingClientRect();
      if (['list', 'room', 'input', 'sender'].includes(this.role)) {
        const c = chat.getBoundingClientRect();
        if (!c.width) return box(0, 0, 0, 0);
        if (this.role === 'sender') return box(c.x, c.height - 99, c.width, 99);
        if (this.role === 'input') return box(c.x + 10, c.height - 60, c.width - 20, 48);
        return box(c.x, 0, c.width, c.height - 99);
      }
      return this.base;
    }
    get clientWidth() { return this.getBoundingClientRect().width; }
    get scrollWidth() { return this.clientWidth; }
  }
  html = new Element('html'); head = html.appendChild(new Element('head')); body = html.appendChild(new Element('body'));
  const core = body.appendChild(new Element()); core.className = 'room-core';
  const player = core.appendChild(new Element('div', 'player')); player.id = 'J_playerMain';
  const layer = player.appendChild(new Element()); layer.id = 'J_roomPlayerLayer';
  const parent = player.appendChild(new Element()); parent.base = box(90, 628, 850, 538);
  const stage = parent.appendChild(new Element('div', 'stage')); stage.className = 'player-wrap'; stage.base = box(90, 628, 850, 478);
  const video = stage.appendChild(new Element('video', 'video')); video.base = stage.base; video.videoWidth = 1920; video.videoHeight = 1080;
  for (const name of ['src', 'currentSrc', 'muted', 'volume', 'currentTime', 'play', 'pause', 'load']) {
    Object.defineProperty(video, name, {
      get() { throw new Error('media control or source access'); },
      set() { throw new Error('media mutation'); },
    });
  }
  for (let i = 0; i < extra; i++) parent.appendChild(new Element());
  const controls = parent.appendChild(new Element('div', 'controls')); controls.base = box(90, 1106, 850, 44);
  for (let i = 0; i < 9; i++) controls.appendChild(new Element('button'));
  const gift = parent.appendChild(new Element('div', 'gift')); gift.base = box(90, 1106, 850, 60);
  for (let i = 0; i < 4; i++) gift.appendChild(new Element());
  const chat = core.appendChild(new Element('div', 'chat')); chat.base = box(951, 681, 339, 485);
  const room = chat.appendChild(new Element('div', 'room')); room.id = 'chatRoom';
  const list = room.appendChild(new Element('div', 'list')); list.id = 'chat-room__list';
  const sender = chat.appendChild(new Element('div', 'sender'));
  sender.base = box(951, 1066, 339, 99);
  const input = sender.appendChild(new Element('textarea', 'input')); input.base = box(1042, 1106, 187, 48);
  // Access to any message/input text is a test failure, not just an empty value.
  for (const node of [input, list, room, chat]) for (const name of ['value', 'textContent', 'innerHTML', 'innerText']) {
    Object.defineProperty(node, name, { get() { throw new Error('private content read'); } });
  }
  const env = {
    document: {
      body, head, documentElement: html,
      activeElement: body,
      hasFocus: () => true,
      querySelectorAll: selector => html.querySelectorAll(selector),
      getElementById: id => html.querySelector('#' + id),
      elementFromPoint: () => properties(controls)['pointer-events'] === 'none' ||
        properties(controls).display === 'none' || properties(controls).visibility === 'hidden' ? video : controls.children[0],
      createElement: tag => new Element(tag),
    },
    window: {
      innerWidth: width, innerHeight: height,
      getComputedStyle(node) { return { getPropertyValue(name) {
        return properties(node)[name] || (name === 'width' ? node.getBoundingClientRect().width + 'px' : name === 'display' ? 'block' :
          name === 'opacity' ? '1' : name === 'visibility' ? 'visible' : '0px');
      } }; },
      setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, due: time + delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
      observe() { this.connected = true; }
      disconnect() { this.connected = false; }
    },
    requestAnimationFrame(callback) { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  return { env, nodes: { html, head, body, core, player, layer, parent, stage, video, controls, gift, chat, room, list, sender, input },
    listeners, observers, frames, timers, properties, Element,
    styleWrites: () => styleWrites,
    emit(name, event = {}) { listeners.get(name)?.({ target: video, ...event }); },
    advance(milliseconds) {
      const target = time + milliseconds;
      for (let count = 0; count < 1000; count++) {
        const next = [...timers].filter(([, task]) => task.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); time = next[1].due; next[1].callback();
      }
      time = target;
    },
    styles: () => head.children.filter(node => node.tag === 'style'),
    resize(w, h) { env.window.innerWidth = w; env.window.innerHeight = h; listeners.get('resize')?.(); },
    flush() { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); },
    mutate(target, type = 'childList') { for (const observer of observers) if (observer.connected) observer.callback([{ target, type }]); },
  };
};
