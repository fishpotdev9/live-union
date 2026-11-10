'use strict';

// G0 only: observed on the same-origin /blanc room document, not a production adapter.
function presentation(prefs) {
  const key = '__liveUnionBilibiliPresentationV1';
  const host = globalThis;
  const previous = host[key];
  if (previous && typeof previous.dispose === 'function') {
    try { previous.dispose(); } catch { return { status: 'failed', reason: 'restore-failed' }; }
  }
  if (!prefs.compact) return { status: 'restored', reason: 'native-page' };

  const candidates = [];
  let inaccessible = false;
  // Bounded, one-shot discovery. Never access a cross-origin frame via a bypass.
  function visit(doc, chain, depth) {
    if (!doc || depth > 2 || candidates.length > 1) return;
    const player = doc.querySelector('#live-player');
    const list = doc.querySelector('.chat-history-list');
    const panel = doc.querySelector('.chat-history-panel');
    const input = doc.querySelector('.chat-input-ctnr');
    const video = player && player.querySelector('video');
    const textarea = input && input.querySelector('textarea');
    if (player && video && list && panel && input && textarea) {
      const section = player.closest('section');
      const left = section && section.children[0];
      const chat = section && section.children[1];
      if (left && chat && left.contains(player) && chat.contains(panel) &&
          panel.contains(list) && chat.contains(input) && !chat.contains(video)) {
        candidates.push({ doc, chain, player, video, list, panel, input, textarea, section, left, chat });
      }
    }
    if (depth === 2) return;
    for (const frame of [...doc.querySelectorAll('iframe')].slice(0, 12)) {
      try {
        const child = frame.contentDocument;
        if (child && frame.contentWindow.location.origin === doc.location.origin) {
          visit(child, [...chain, frame], depth + 1);
        } else inaccessible = true;
      } catch { inaccessible = true; }
    }
  }
  try { visit(document, [], 0); } catch {
    return { status: 'unsupported', reason: 'room-document-unavailable' };
  }
  if (candidates.length !== 1) {
    return { status: 'unsupported', reason: candidates.length > 1 ? 'ambiguous-room' :
      inaccessible ? 'room-missing-or-cross-origin' : 'required-structure-missing' };
  }
  const room = candidates[0];
  const { doc, chain, player, video, list, panel, input, textarea, section, left, chat } = room;
  const viewportWidth = host.innerWidth;
  const viewportHeight = host.innerHeight;
  const chatWidth = prefs.chatVisible ? prefs.chatWidthDip : 0;
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) ||
      viewportWidth - chatWidth < 180 || viewportHeight < 220 ||
      (prefs.chatVisible && chatWidth < 220)) {
    return { status: 'unsupported', reason: 'insufficient-control-space' };
  }

  function directChild(root, node) {
    let current = node;
    for (let depth = 0; current && depth < 24; depth++, current = current.parentElement) {
      if (current.parentElement === root) return current;
    }
    return null;
  }
  const historyRoot = directChild(chat, panel);
  const sendRoot = directChild(chat, input);
  if (!historyRoot || !sendRoot || historyRoot === sendRoot ||
      historyRoot.contains(textarea) || sendRoot.contains(list)) {
    return { status: 'unsupported', reason: 'chat-common-root-mismatch' };
  }
  const nativePanel = panel.getBoundingClientRect();
  const nativeList = list.getBoundingClientRect();
  const nativeSend = sendRoot.getBoundingClientRect();
  // Known sample: panel 498, list 468, send root 109 CSS px. Keep native toolbar space.
  const historyExtras = Math.max(0, Math.min(100, nativePanel.height - nativeList.height));
  const sendHeight = Math.max(100, Math.min(160, nativeSend.height));
  const originals = new Map();
  const listeners = [];
  let observer = null;
  let disposed = false;
  const state = { dispose };
  function patch(element, declarations) {
    let saved = originals.get(element);
    if (!saved) { saved = new Map(); originals.set(element, saved); }
    const expanded = {};
    for (const [property, value] of Object.entries(declarations)) {
      // Write longhands so rollback also preserves original shorthand priorities.
      if (['margin', 'padding'].includes(property)) {
        for (const side of ['top', 'right', 'bottom', 'left']) expanded[`${property}-${side}`] = value;
      } else if (property === 'inset') {
        for (const side of ['top', 'right', 'bottom', 'left']) expanded[side] = value;
      } else if (property === 'overflow') {
        expanded['overflow-x'] = value; expanded['overflow-y'] = value;
      } else if (property === 'gap') {
        expanded['row-gap'] = value; expanded['column-gap'] = value;
      } else if (property === 'border') {
        for (const side of ['top', 'right', 'bottom', 'left']) expanded[`border-${side}-width`] = value;
      } else if (property === 'background') expanded['background-color'] = value;
      else if (property === 'flex') {
        const parts = value.split(' ');
        expanded['flex-grow'] = parts[0]; expanded['flex-shrink'] = parts[1]; expanded['flex-basis'] = parts[2];
      } else if (property === 'grid-column' || property === 'grid-row') {
        expanded[`${property}-start`] = value; expanded[`${property}-end`] = 'auto';
      } else expanded[property] = value;
    }
    for (const [property, value] of Object.entries(expanded)) {
      if (!saved.has(property)) saved.set(property, [element.style.getPropertyValue(property),
        element.style.getPropertyPriority(property)]);
      element.style.setProperty(property, value, 'important');
    }
  }
  function listen(target, event, callback) {
    target.addEventListener(event, callback);
    listeners.push(() => target.removeEventListener(event, callback));
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (observer) observer.disconnect();
    for (const remove of listeners) remove();
    for (const [element, saved] of [...originals].reverse()) {
      for (const [property, [value, priority]] of saved) {
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    }
    originals.clear();
    if (host[key] === state) delete host[key];
  }
  function invalidate() {
    dispose();
    host[Symbol.for('live-union.g0.presentation.result')] = {
      status: 'unsupported', reason: 'structure-invalidated',
    };
  }
  function releaseContainingBlocks(element, stop) {
    for (let ancestor = element.parentElement, depth = 0;
      ancestor && ancestor !== stop && depth < 24; ancestor = ancestor.parentElement, depth++) {
      patch(ancestor, { transform: 'none', filter: 'none', perspective: 'none', contain: 'none',
        overflow: 'visible', 'clip-path': 'none', 'will-change': 'auto',
        'z-index': 'auto', isolation: 'auto', opacity: '1', 'mix-blend-mode': 'normal',
        'backdrop-filter': 'none' });
    }
  }
  function hideOuterSiblings(frame) {
    const body = frame.ownerDocument.body;
    let path = frame;
    for (let depth = 0; path && path !== body && depth < 24; depth++) {
      const parent = path.parentElement;
      if (!parent) throw new Error('frame-path');
      for (const sibling of parent.children) {
        if (sibling !== path && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) {
          patch(sibling, { display: 'none' });
        }
      }
      path = parent;
    }
    if (path !== body) throw new Error('frame-path');
  }
  function fillDocument(targetDoc) {
    for (const element of [targetDoc.documentElement, targetDoc.body]) {
      patch(element, { margin: '0', padding: '0', width: '100%', height: '100%',
        'min-width': '0', 'min-height': '0', overflow: 'hidden' });
    }
  }
  try {
    host[key] = state;
    for (const frame of chain) {
      releaseContainingBlocks(frame, null);
      hideOuterSiblings(frame);
      fillDocument(frame.ownerDocument);
      patch(frame, { display: 'block', position: 'fixed', inset: '0', width: '100vw',
        height: '100vh', 'min-width': '0', 'min-height': '0', 'max-width': 'none',
        'max-height': 'none', margin: '0', padding: '0', border: '0', transform: 'none',
        'box-sizing': 'border-box', 'z-index': '2147482000' });
      listen(frame, 'load', invalidate);
    }
    releaseContainingBlocks(section, null);
    fillDocument(doc);
    patch(section, { position: 'fixed', inset: '0', width: '100vw', height: '100vh',
      'min-width': '0', 'min-height': '0', 'max-width': 'none', 'max-height': 'none',
      margin: '0', padding: '0', display: 'grid', gap: '0',
      'grid-template-columns': `minmax(0, 1fr) ${chatWidth}px`,
      'grid-template-rows': 'minmax(0, 1fr)', 'box-sizing': 'border-box',
      overflow: 'visible', transform: 'none', 'z-index': '2147481000' });
    patch(left, { position: 'relative', width: '100%', height: '100%', 'min-width': '0',
      'min-height': '0', margin: '0', padding: '0', overflow: 'visible', background: '#000',
      'grid-column': '1', 'grid-row': '1' });
    // Retain the entire native #live-player subtree (controls, canvases, menus, video).
    // Only siblings outside that subtree are presentation chrome in this G0 sample.
    for (let path = player, depth = 0; path !== left && depth < 24; depth++) {
      const parent = path.parentElement;
      if (!parent || !left.contains(parent)) throw new Error('structure');
      for (const sibling of parent.children) {
        if (sibling !== path && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) {
          patch(sibling, { display: 'none' });
        }
      }
      if (parent !== left) patch(parent, { position: 'static', transform: 'none',
        contain: 'none', filter: 'none', perspective: 'none', 'will-change': 'auto',
        margin: '0', padding: '0', width: '100%', height: '100%', 'min-width': '0',
        'min-height': '0', 'max-width': 'none', 'max-height': 'none', overflow: 'visible' });
      path = parent;
    }
    patch(player, { position: 'absolute', left: '50%', top: '50%', right: 'auto', bottom: 'auto',
      transform: 'translate(-50%, -50%)',
      width: 'min(100%, calc(100vh * 16 / 9))',
      height: `min(100vh, calc((100vw - ${chatWidth}px) * 9 / 16))`,
      'aspect-ratio': '16 / 9', 'min-width': '0', 'min-height': '0', 'max-width': '100%',
      'max-height': '100%', margin: '0', padding: '0', 'box-sizing': 'border-box', overflow: 'visible' });
    patch(video, { width: '100%', height: '100%', 'max-width': '100%', 'max-height': '100%',
      'object-fit': 'contain', 'object-position': 'center', transform: 'none' });
    patch(chat, { display: prefs.chatVisible ? 'flex' : 'none', 'flex-direction': 'column',
      position: 'relative', inset: 'auto', width: `${chatWidth}px`, height: '100%',
      'min-width': '0', 'min-height': '0', 'max-width': 'none', 'max-height': 'none',
      margin: '0', padding: '0', 'box-sizing': 'border-box', overflow: 'visible',
      'grid-column': '2', 'grid-row': '1' });
    for (const sibling of chat.children) {
      if (sibling !== historyRoot && sibling !== sendRoot &&
          !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) patch(sibling, { display: 'none' });
    }
    patch(historyRoot, { flex: '1 1 0', width: '100%', height: 'auto', 'min-height': '0',
      'min-width': '0', position: 'relative', margin: '0', 'box-sizing': 'border-box' });
    if (panel !== historyRoot) patch(panel, { width: '100%', height: '100%', 'min-height': '0' });
    patch(list, { width: '100%', height: `calc(100% - ${historyExtras}px)`, 'min-height': '0',
      'max-height': 'none', 'box-sizing': 'border-box' });
    patch(sendRoot, { flex: `0 0 ${sendHeight}px`, width: '100%', height: `${sendHeight}px`,
      'min-width': '0', 'box-sizing': 'border-box', position: 'relative', margin: '0' });
    patch(input, { width: 'calc(100% - 16px)', 'max-width': '100%', 'box-sizing': 'border-box' });
    // Observe only fixed structural parents. Chat messages do not cause rescans.
    observer = new MutationObserver(() => {
      if (![...chain, player, video, list, panel, input, textarea, section].every(element => element.isConnected) ||
          !player.contains(video) || !panel.contains(list) || !chat.contains(input)) invalidate();
    });
    for (const target of new Set([...chain.map(frame => frame.parentElement),
      section.parentElement, section, player, player.parentElement, chat, input])) {
      if (target) observer.observe(target, { childList: true });
    }
    listen(host, 'pagehide', invalidate);
    const bounds = player.getBoundingClientRect();
    const finite = value => Number.isFinite(value) ? Math.max(0, Math.min(20000, Math.round(value))) : 0;
    return { status: 'applied', reason: 'g0-probe-only', inFrame: chain.length > 0,
      parentAccessible: true, chatVisible: prefs.chatVisible, playerWidth: finite(bounds.width),
      playerHeight: finite(bounds.height), chatWidth: finite(chatWidth) };
  } catch {
    dispose();
    return { status: 'unsupported', reason: 'presentation-rolled-back' };
  }
}

function build(prefs = {}) {
  const source = prefs && typeof prefs === 'object' ? prefs : {};
  const fixed = {
    compact: source.compact === true,
    chatVisible: source.chatVisible !== false,
    chatWidthDip: Number.isFinite(source.chatWidthDip) ? Math.max(140, Math.min(500, source.chatWidthDip)) : 240,
  };
  return `(() => { const result = (${presentation.toString()})(${JSON.stringify(fixed)}); ` +
    `globalThis[Symbol.for('live-union.g0.presentation.result')] = result; return result; })()`;
}

module.exports = { build };
