'use strict';

// Packaged Bilibili presentation 2026.11.07.4. No Node, IPC or network access.
function presentation(prefs) {
  const version = '2026.11.07.4';
  const key = Symbol.for('live-union.bilibili.presentation.state');
  const resultKey = Symbol.for('live-union.presentation.result');
  const geometryKey = Symbol.for('live-union.bilibili.chat-geometry');
  const host = globalThis;
  const publish = (status, reason) => {
    const value = { status, reason };
    host[resultKey] = value;
    return value;
  };
  const previous = host[key];
  if (previous && typeof previous.dispose === 'function') {
    try { previous.dispose(); } catch { return publish('failed', 'restore-failed'); }
  }
  if (!prefs) return publish('unsupported', 'invalid-preferences');
  if (!prefs.compact) return publish('restored', 'native-page');
  if (!document.body || !document.documentElement) return publish('notReady', 'not-applied');
  if (document.location.origin !== 'https://live.bilibili.com') return publish('unsupported', 'native-structure');

  const candidates = [];
  const documents = [];
  const frameDocuments = new Map();
  let inaccessible = false;
  let frameBudget = 24;
  const single = (root, selector) => {
    const nodes = root.querySelectorAll(selector);
    return nodes.length === 1 ? nodes[0] : null;
  };
  // Bounded, one-shot discovery. Never access a cross-origin frame via a bypass.
  function visit(doc, chain, depth) {
    if (!doc || depth > 2 || candidates.length > 1) return;
    documents.push(doc);
    const player = single(doc, '#live-player');
    const list = single(doc, '.chat-history-list');
    const panel = single(doc, '.chat-history-panel');
    const input = single(doc, '.chat-input-ctnr');
    const video = player && single(player, 'video');
    const textarea = input && single(input, 'textarea');
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
    const frames = doc.querySelectorAll('iframe');
    for (let index = 0; index < Math.min(12, frames.length) && frameBudget > 0; index++) {
      const frame = frames[index];
      frameBudget--;
      try {
        const child = frame.contentDocument;
        if (child && frame.contentWindow.location.origin === doc.location.origin) {
          frameDocuments.set(frame, child);
          visit(child, [...chain, frame], depth + 1);
        } else inaccessible = true;
      } catch { inaccessible = true; }
    }
  }
  try { visit(document, [], 0); } catch {
    return publish('unsupported', 'room-document-unavailable');
  }
  if (candidates.length !== 1) {
    return publish(document.readyState === 'loading' ? 'notReady' : 'unsupported',
      candidates.length > 1 ? 'ambiguous-room' :
        inaccessible ? 'room-missing-or-cross-origin' : 'required-structure-missing');
  }
  const room = candidates[0];
  const { doc, chain, player, video, list, panel, input, textarea, section, left, chat } = room;
  const chatWidth = prefs.chatVisible ? prefs.chatWidthDip : 0;

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
    return publish('unsupported', 'chat-common-root-mismatch');
  }
  // Do not treat zero rectangles from responsive display:none as missing native
  // controls. Measure these same nodes only after reversible ancestor expansion.
  let historyExtras = 0;
  let sendHeight = 0;
  let chatMeasured = false;
  const originals = new Map();
  const listeners = [];
  let observer = null;
  let disposed = false;
  let queued = 0;
  let siblingBudget = 512;
  let diagnosticFailed = false;
  const state = { version, dispose };
  const ancestry = new Map();
  for (const target of [...chain, player, video, list, panel, input, textarea, section, historyRoot, sendRoot]) {
    for (let node = target, depth = 0; node && depth < 24; node = node.parentElement, depth++) {
      ancestry.set(node, node.parentElement);
    }
  }
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
      if (!saved.has(property)) saved.set(property, { value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property), applied: value });
      saved.get(property).applied = value;
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
    if (queued) host.cancelAnimationFrame(queued);
    if (observer) observer.disconnect();
    for (const remove of listeners) remove();
    for (const [element, saved] of [...originals].reverse()) {
      for (const [property, { value, priority, applied }] of saved) {
        // Preserve newer values written by the native page while presentation ran.
        if (element.style.getPropertyValue(property) !== applied || element.style.getPropertyPriority(property) !== 'important') continue;
        if (value) element.style.setProperty(property, value, priority);
        else element.style.removeProperty(property);
      }
    }
    originals.clear();
    if (host[key] === state) delete host[key];
  }
  function fail(reason) {
    // Capture before rollback. Never replace a more specific layout failure
    // with the native-page rectangles produced by disposal.
    if (prefs.chatVisible && !diagnosticFailed) {
      recordGeometry('fallback', reason === 'structure-invalidated' ? 'structure' :
        reason === 'native-overlay' || reason === 'native-fullscreen' ? 'overlay' : 'viewport');
    }
    dispose();
    return publish('unsupported', reason);
  }
  function invalidate() {
    if (!disposed && host[key] === state) fail('structure-invalidated');
  }
  function guard() {
    if ([...ancestry].some(([node, parent]) => !node.isConnected || node.parentElement !== parent) ||
        section.children[0] !== left || section.children[1] !== chat ||
        !player.contains(video) || !panel.contains(list) || !chat.contains(input)) return 'structure-invalidated';
    for (const frame of chain) {
      try { if (!frame.contentDocument || frameDocuments.get(frame) !== frame.contentDocument) return 'structure-invalidated'; }
      catch { return 'structure-invalidated'; }
    }
    for (const targetDoc of documents) {
      if (targetDoc.fullscreenElement) return 'native-fullscreen';
      const overlays = targetDoc.querySelectorAll('dialog,[role="dialog"],[aria-modal="true"]');
      for (let index = 0; index < Math.min(overlays.length, 32); index++) {
        const modal = overlays[index], box = modal.getBoundingClientRect();
        const computed = targetDoc.defaultView.getComputedStyle(modal);
        if (box.width > 0 && box.height > 0 && computed.display !== 'none' && computed.visibility !== 'hidden') return 'native-overlay';
      }
    }
    const width = host.innerWidth, height = host.innerHeight;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return 'insufficient-space';
    if (prefs.chatVisible && (width - chatWidth < 128 ||
        (chatMeasured && height < sendHeight + historyExtras + 120))) return 'insufficient-chat-space';
    return null;
  }
  function rectInside(box, outer) {
    return [box.x, box.y, box.width, box.height, outer.x, outer.y, outer.width, outer.height].every(Number.isFinite) &&
      box.width > 0 && box.height > 0 && box.x >= outer.x - 1 && box.y >= outer.y - 1 &&
      box.x + box.width <= outer.x + outer.width + 1 && box.y + box.height <= outer.y + outer.height + 1;
  }
  function recordGeometry(stage, part, inputChildIndex = -1, overflowDepth = -1) {
    // Fixed selectors/references only; no URL, text, value, account or exception
    // fields. -1 denotes unavailable/non-finite data. All numbers are bounded.
    const bounded = value => Number.isFinite(value) ? Math.max(-1000000, Math.min(1000000, Math.round(value * 100) / 100)) : -1;
    const box = node => {
      try {
        const rect = node.getBoundingClientRect();
        return { x: bounded(rect.x), y: bounded(rect.y), width: bounded(rect.width), height: bounded(rect.height),
          clientWidth: bounded(node.clientWidth), scrollWidth: bounded(node.scrollWidth) };
      } catch { return { x: -1, y: -1, width: -1, height: -1, clientWidth: -1, scrollWidth: -1 }; }
    };
    const ancestors = [];
    for (let node = textarea, depth = 0; node && node !== chat && depth < 8; node = node.parentElement, depth++) ancestors.push(box(node));
    host[geometryKey] = { stage, part, inputChildIndex, overflowDepth,
      viewport: { width: bounded(host.innerWidth), height: bounded(host.innerHeight), chatWidth: bounded(chatWidth) },
      chat: box(chat), panel: box(panel), list: box(list), sendRoot: box(sendRoot), input: box(input), textarea: box(textarea),
      inputChildren: [...input.children].filter(node => !['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)).slice(0, 3).map(box),
      inputAncestors: ancestors };
    diagnosticFailed = part !== 'none';
  }
  function chatFailure(part, index = -1, depth = -1) {
    recordGeometry('layout', part, index, depth);
    return 'chat-layout';
  }
  function chatGeometry() {
    if (!prefs.chatVisible) return null;
    const outer = chat.getBoundingClientRect();
    const viewport = { x: 0, y: 0, width: host.innerWidth, height: host.innerHeight };
    if (!rectInside(outer, viewport) || outer.width < chatWidth - 1 || outer.width > chatWidth + 1) return chatFailure('chat');
    for (const [part, target] of [['history-root', historyRoot], ['panel', panel], ['list', list],
      ['send-root', sendRoot], ['input', input], ['textarea', textarea]]) {
      if (!rectInside(target.getBoundingClientRect(), outer)) return chatFailure(part);
    }
    const inputBranches = [...input.children].filter(node => !['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName));
    if (inputBranches.length < 2) return chatFailure('input-child');
    for (let index = 0; index < Math.min(3, inputBranches.length); index++) {
      if (!rectInside(inputBranches[index].getBoundingClientRect(), input.getBoundingClientRect())) return chatFailure('input-child', index);
    }
    const history = list.getBoundingClientRect(), send = sendRoot.getBoundingClientRect();
    if (history.height < 100 || history.y + history.height > send.y + 1) return chatFailure('list');
    if (!rectInside(input.getBoundingClientRect(), send)) return chatFailure('input');
    if (!rectInside(textarea.getBoundingClientRect(), input.getBoundingClientRect()) ||
        textarea.getBoundingClientRect().width < 24 || textarea.getBoundingClientRect().height < 16) return chatFailure('textarea');
    for (let target = textarea, depth = 0; target && target !== chat && depth < 24; target = target.parentElement, depth++) {
      if (!rectInside(target.getBoundingClientRect(), outer)) return chatFailure('input-ancestor', -1, depth);
      if (!Number.isFinite(target.clientWidth) || !Number.isFinite(target.scrollWidth) ||
          target.clientWidth <= 0 || target.scrollWidth > target.clientWidth + 1) return chatFailure('overflow', -1, depth);
    }
    recordGeometry('layout', 'none');
    return null;
  }
  function schedule() {
    if (disposed || queued || host[key] !== state) return;
    queued = host.requestAnimationFrame(() => {
      queued = 0;
      if (disposed || host[key] !== state) return;
      try {
        const reason = guard() || chatGeometry();
        if (reason) fail(reason);
        else publish('applied', 'candidate-layout');
      } catch { fail('presentation-rolled-back'); }
    });
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
  function hideSiblings(parent, retained) {
    for (const sibling of parent.children) {
      if (--siblingBudget < 0) throw new Error('structure');
      if (!retained.includes(sibling) && !['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT'].includes(sibling.tagName)) {
        patch(sibling, { display: 'none' });
      }
    }
  }
  function hidePathSiblings(element) {
    const body = element.ownerDocument.body;
    let path = element;
    for (let depth = 0; path && path !== body && depth < 24; depth++) {
      const parent = path.parentElement;
      if (!parent) throw new Error('frame-path');
      hideSiblings(parent, [path]);
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
  function revealChatPath(target, stop, inputRow, autoHeight = true) {
    let node = target;
    for (let depth = 0; node && depth < 24; node = node.parentElement, depth++) {
      const computed = doc.defaultView.getComputedStyle(node);
      patch(node, { display: node === inputRow ? 'flex' : computed.display === 'none' ? 'block' : computed.display,
        visibility: 'visible', width: '100%', 'min-width': '0', 'max-width': '100%',
        ...(autoHeight ? { height: 'auto' } : {}),
        'min-height': '0', 'max-height': 'none', 'box-sizing': 'border-box' });
      if (node === stop) return;
    }
    throw new Error('chat-path');
  }
  function measureChat() {
    // All changes use the same property journal and roll back on any failure.
    // Browser layout is flushed by getBoundingClientRect; no second document,
    // event dispatch, native click, media operation or input-value read is used.
    patch(historyRoot, { display: 'block', flex: '1 1 0', width: '100%', height: 'auto',
      'min-height': '0', 'max-height': 'none', position: 'relative', margin: '0' });
    // Keep the native history viewport height rule while its flex parent gains
    // space; height:auto on the list would instead measure arbitrary messages.
    revealChatPath(list, panel, null, false);
    if (panel !== historyRoot) revealChatPath(panel, historyRoot, null, false);
    revealChatPath(textarea, sendRoot, input);
    patch(sendRoot, { flex: '0 0 auto', width: '100%', height: 'auto', 'min-height': '0',
      position: 'relative', margin: '0' });
    const measuredSend = sendRoot.getBoundingClientRect();
    const measuredPanel = panel.getBoundingClientRect(), measuredList = list.getBoundingClientRect();
    const extras = measuredPanel.height - measuredList.height;
    if (![measuredSend.width, measuredSend.height, extras].every(Number.isFinite) ||
        measuredSend.width <= 0 || measuredSend.height < 60 || measuredSend.height > 180 ||
        extras < 0 || extras > 100) {
      recordGeometry('measure', extras < 0 || extras > 100 ? 'panel' : 'send-root');
      return 'native-send-geometry';
    }
    sendHeight = Math.ceil(measuredSend.height);
    historyExtras = Math.ceil(extras);
    chatMeasured = true;
    return guard();
  }
  try {
    host[key] = state;
    const initialReason = guard();
    if (initialReason) return fail(initialReason);
    for (const frame of chain) {
      releaseContainingBlocks(frame, null);
      hidePathSiblings(frame);
      fillDocument(frame.ownerDocument);
      patch(frame, { display: 'block', position: 'fixed', inset: '0', width: '100vw',
        height: '100vh', 'min-width': '0', 'min-height': '0', 'max-width': 'none',
        'max-height': 'none', margin: '0', padding: '0', border: '0', transform: 'none',
        'box-sizing': 'border-box', 'z-index': '2147482000' });
      listen(frame, 'load', invalidate);
    }
    releaseContainingBlocks(section, null);
    hidePathSiblings(section);
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
    // Siblings outside that subtree are presentation chrome in the observed sample.
    for (let path = player, depth = 0; path !== left && depth < 24; depth++) {
      const parent = path.parentElement;
      if (!parent || !left.contains(parent)) throw new Error('structure');
      hideSiblings(parent, [path]);
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
    hideSiblings(chat, [historyRoot, sendRoot]);
    if (prefs.chatVisible) {
      const measurementReason = measureChat();
      if (measurementReason) return fail(measurementReason);
    }
    patch(historyRoot, { flex: '1 1 0', width: '100%', height: 'auto', 'min-height': '0',
      'min-width': '0', position: 'relative', margin: '0', 'box-sizing': 'border-box' });
    if (panel !== historyRoot) patch(panel, { width: '100%', height: '100%', 'min-height': '0' });
    patch(list, { width: '100%', height: `calc(100% - ${historyExtras}px)`, 'min-height': '0',
      'max-height': 'none', 'box-sizing': 'border-box' });
    patch(sendRoot, { flex: `0 0 ${sendHeight}px`, width: '100%', height: `${sendHeight}px`,
      'min-width': '0', 'box-sizing': 'border-box', position: 'relative', margin: '0' });
    patch(input, { width: 'calc(100% - 16px)', 'max-width': '100%', 'box-sizing': 'border-box' });
    const finalReason = guard() || chatGeometry();
    if (finalReason) return fail(finalReason);
    // Observe only fixed structural parents. Chat messages do not cause rescans.
    observer = new MutationObserver(schedule);
    for (const target of new Set([...ancestry.keys()].map(node => node.parentElement))) {
      if (target) observer.observe(target, { childList: true });
    }
    listen(host, 'pagehide', invalidate);
    listen(host, 'resize', schedule);
    listen(video, 'resize', schedule);
    for (const targetDoc of documents) {
      listen(targetDoc, 'fullscreenchange', schedule);
      if (targetDoc.defaultView && targetDoc.defaultView !== host) listen(targetDoc.defaultView, 'resize', schedule);
    }
    return publish('applied', 'candidate-layout');
  } catch {
    return fail('presentation-rolled-back');
  }
}

function build(prefs) {
  const valid = prefs && typeof prefs.compact === 'boolean' && typeof prefs.chatVisible === 'boolean' &&
    typeof prefs.chatWidthDip === 'number' && Number.isFinite(prefs.chatWidthDip) &&
    prefs.chatWidthDip >= 140 && prefs.chatWidthDip <= 500;
  const fixed = valid ? { compact: prefs.compact, chatVisible: prefs.chatVisible, chatWidthDip: prefs.chatWidthDip } : null;
  return `(${presentation.toString()})(${JSON.stringify(fixed)})`;
}

module.exports = { build };
