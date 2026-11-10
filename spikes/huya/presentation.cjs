'use strict';

// G0 only. This script has no Node, IPC, network, media or input-value access.
function probe(prefs) {
  const key = Symbol.for('live-union.g0.huya.presentation.v1');
  const styleId = 'live-union-g0-huya-presentation-v1';
  const previous = globalThis[key];
  if (previous && typeof previous.dispose === 'function') previous.dispose();
  if (!prefs.compact) return { status: 'restored', compact: false };
  const unsupported = reason => ({ status: 'unsupported', reason, compact: false });
  if (document.getElementById(styleId)) return unsupported('style-collision');
  const unique = selector => {
    const nodes = document.querySelectorAll(selector);
    return nodes.length === 1 ? nodes[0] : null;
  };
  const player = unique('#J_playerMain');
  const layer = unique('#J_roomPlayerLayer');
  const list = unique('#chat-room__list');
  const room = unique('#chatRoom');
  const core = unique('.room-core');
  if (!player || !layer || !list || !room || !core ||
      !core.contains(player) || !core.contains(room) ||
      !room.contains(list) || !player.contains(layer)) return unsupported('structure');
  const stageNodes = player.querySelectorAll('.player-wrap');
  const videoNodes = player.querySelectorAll('video');
  const inputs = core.querySelectorAll('textarea, [contenteditable="true"]');
  if (stageNodes.length !== 1 || videoNodes.length !== 1 || inputs.length !== 1) {
    return unsupported('structure');
  }
  const stage = stageNodes[0];
  const video = videoNodes[0];
  const input = inputs[0];
  if (!stage.contains(video) || player.contains(input)) return unsupported('structure');
  // G0 fixed structural fingerprint sampled by the coordinator on 2026-11-07:
  // stage-parent child 1 = video stage, child 3 = 44px native controls,
  // child 5 = 60px gift/recharge strip. Never hide arbitrary player siblings.
  const stageParent = stage.parentElement;
  if (!stageParent || stageParent.children.length !== 15 || stageParent.children[0] !== stage) {
    return unsupported('structure');
  }
  const controls = stageParent.children[2];
  const giftStrip = stageParent.children[4];
  const giftRect = giftStrip.getBoundingClientRect();
  const controlsRect = controls.getBoundingClientRect();
  if (giftStrip.children.length !== 4 || controls.children.length !== 9 ||
      giftStrip.contains(stage) || stage.contains(giftStrip) ||
      giftStrip.querySelector('video, textarea, [contenteditable="true"]') ||
      giftRect.height < 50 || giftRect.height > 100 || controlsRect.height < 20 || controlsRect.height > 80) {
    return unsupported('structure');
  }
  // Lowest common ancestor of the actual native list and native send input.
  // #chatRoom itself is NOT assumed to include the sender.
  let chat = list.parentElement;
  for (let depth = 0; chat && !chat.contains(input) && depth < 24; depth++) chat = chat.parentElement;
  if (!chat || chat === core || chat === document.body || !core.contains(chat) ||
      chat.contains(player) || player.contains(chat) || !chat.contains(input)) return unsupported('structure');
  const childOnPath = (parent, target) => {
    let node = target;
    for (let depth = 0; node && node.parentElement !== parent && depth < 32; depth++) node = node.parentElement;
    return node && node.parentElement === parent ? node : null;
  };
  const listBranch = childOnPath(chat, list);
  const inputBranch = childOnPath(chat, input);
  if (!listBranch || !inputBranch || listBranch === inputBranch) return unsupported('structure');
  // Require a real rendered native input before changing presentation. Never read its value.
  if (input.getBoundingClientRect().height <= 0) return unsupported('input-not-ready');
  if (prefs.chatVisible && prefs.chatWidthDip < 320) return unsupported('chat-too-narrow');
  const path = element => {
    if (element === document.documentElement) return 'html';
    if (element === document.body) return 'body';
    const parts = [];
    let node = element;
    for (let depth = 0; node && node !== document.body && depth < 32; depth++) {
      const parent = node.parentElement;
      if (!parent) return null;
      parts.unshift(':nth-child(' + (Array.prototype.indexOf.call(parent.children, node) + 1) + ')');
      node = parent;
    }
    return node === document.body ? 'body > ' + parts.join(' > ') : null;
  };
  const tracked = [player, layer, stage, video, controls, giftStrip, chat, room, list, input, listBranch, inputBranch];
  if (tracked.some(node => !path(node))) return unsupported('structure');
  // Generated CSS paths are invalidated if native siblings are inserted above
  // a target. Observe only structural path dependencies, never list messages.
  const pathNodes = new Set(tracked);
  for (const target of tracked) {
    for (let node = target.parentElement; node && node !== document.body; node = node.parentElement) pathNodes.add(node);
  }
  const pathParents = new Set(Array.from(pathNodes, node => node.parentElement));
  const originalPaths = new Map(Array.from(pathNodes, node => [node, path(node)]));
  const style = document.createElement('style');
  style.id = styleId;
  let disposed = false;
  let frame = 0;
  let observer;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', dispose);
    if (frame) cancelAnimationFrame(frame);
    if (observer) observer.disconnect();
    style.remove(); // Only our own node; no native component or inline style is changed.
    if (globalThis[key] === state) delete globalThis[key];
  };
  const state = { dispose };
  const layout = () => {
    if (disposed || tracked.some(node => !node.isConnected) ||
        !chat.contains(list) || !chat.contains(input) || !player.contains(video)) return false;
    const width = Math.floor(window.innerWidth);
    const height = Math.floor(window.innerHeight);
    const chatWidth = prefs.chatVisible ? prefs.chatWidthDip : 0;
    const available = width - chatWidth;
    if (width > 16000 || height > 16000 || available < 320 || height < 300) return false;
    const sourceRatio = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
    const ratio = Number.isFinite(sourceRatio) && sourceRatio >= 0.3 && sourceRatio <= 4 ? sourceRatio : 16 / 9;
    // 60px below the video is reserved for the native lower controls/gift strip.
    const videoWidth = Math.min(available, (height - 60) * ratio);
    const videoHeight = videoWidth / ratio;
    const left = (available - videoWidth) / 2;
    const top = (height - 60 - videoHeight) / 2;
    const rules = [];
    const rule = (node, properties) => rules.push(path(node) + '{' + properties + '}');
    // Neutralize fixed-position containing blocks on the two paths only.
    // Do not hide body siblings: login dialogs outside the room stay available.
    const ancestors = new Set();
    for (const root of [player, chat]) {
      for (let node = root.parentElement; node; node = node.parentElement) ancestors.add(node);
    }
    for (const node of ancestors) rule(node,
      'transform:none!important;filter:none!important;perspective:none!important;contain:none!important;' +
      'content-visibility:visible!important;overflow:visible!important;isolation:auto!important;z-index:auto!important;');
    for (const node of [document.documentElement, document.body]) rule(node,
      'min-width:0!important;min-height:0!important;width:100%!important;height:100%!important;' +
      'margin:0!important;padding:0!important;overflow:hidden!important;');
    rule(player, 'position:fixed!important;inset:auto!important;left:0!important;top:0!important;' +
      'width:' + available + 'px!important;height:' + height + 'px!important;min-width:0!important;min-height:0!important;' +
      'max-width:none!important;max-height:none!important;margin:0!important;box-sizing:border-box!important;' +
      'transform:none!important;overflow:visible!important;z-index:10000!important;background:#000!important;');
    for (let node = stage.parentElement; node && node !== player; node = node.parentElement) rule(node,
      'position:static!important;width:100%!important;height:100%!important;min-width:0!important;' +
      'min-height:0!important;max-width:none!important;max-height:none!important;margin:0!important;overflow:visible!important;' +
      'transform:none!important;contain:none!important;');
    rule(stage, 'position:absolute!important;inset:auto!important;left:' + left + 'px!important;top:' + top + 'px!important;' +
      'width:' + videoWidth + 'px!important;height:' + videoHeight + 'px!important;' +
      'min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;' +
      'margin:0!important;box-sizing:border-box!important;overflow:visible!important;');
    rule(giftStrip, 'display:none!important;');
    for (let node = video.parentElement; node && node !== stage; node = node.parentElement) rule(node,
      'width:100%!important;height:100%!important;min-width:0!important;min-height:0!important;' +
      'max-width:none!important;max-height:none!important;box-sizing:border-box!important;');
    rule(video, 'width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;' +
      'object-fit:contain!important;object-position:center!important;');
    rule(chat, 'position:fixed!important;inset:auto!important;right:0!important;top:0!important;' +
      'width:' + prefs.chatWidthDip + 'px!important;height:' + height + 'px!important;min-width:0!important;min-height:0!important;' +
      'max-width:none!important;max-height:none!important;margin:0!important;box-sizing:border-box!important;' +
      'transform:none!important;overflow:visible!important;z-index:10001!important;background:#fff!important;' +
      'display:' + (prefs.chatVisible ? 'flex' : 'none') + '!important;flex-direction:column!important;');
    // Keep native sender, toolbar and list in place; stretch only the list branch.
    for (const child of chat.children) rule(child, 'flex:0 0 auto!important;min-width:0!important;max-width:100%!important;box-sizing:border-box!important;');
    for (let node = listBranch; node && node !== list; node = childOnPath(node, list)) rule(node,
      'display:flex!important;flex-direction:column!important;flex:1 1 0!important;position:relative!important;' +
      'top:auto!important;bottom:auto!important;width:100%!important;height:auto!important;min-height:0!important;' +
      'max-height:none!important;margin:0!important;box-sizing:border-box!important;');
    rule(list, 'position:relative!important;inset:auto!important;flex:1 1 0!important;width:100%!important;' +
      'height:auto!important;min-height:80px!important;max-height:none!important;margin:0!important;box-sizing:border-box!important;');
    style.textContent = rules.join('\n');
    const inside = rect => rect.width > 0 && rect.height > 0 && rect.x >= -1 && rect.y >= -1 &&
      rect.right <= width + 1 && rect.bottom <= height + 1;
    const videoRect = video.getBoundingClientRect();
    const nativeControlsRect = controls.getBoundingClientRect();
    const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 &&
      a.top < b.bottom - 1 && a.bottom > b.top + 1;
    if (!inside(stage.getBoundingClientRect()) || !inside(videoRect) ||
        !inside(nativeControlsRect) || intersects(videoRect, nativeControlsRect)) return false;
    if (prefs.chatVisible && (!inside(list.getBoundingClientRect()) || !inside(input.getBoundingClientRect()) ||
        !inside(inputBranch.getBoundingClientRect()) || inputBranch.scrollWidth > inputBranch.clientWidth + 1)) return false;
    return true;
  };
  function onResize() {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!layout()) dispose();
    });
  }
  try {
    (document.head || document.documentElement).appendChild(style);
    if (!layout()) {
      dispose();
      return unsupported('space-or-layout');
    }
    // No mutation values or contents are read; chat-list insertions are ignored.
    observer = new MutationObserver(records => {
      if (tracked.some(node => !node.isConnected) || !chat.contains(list) || !chat.contains(input)) {
        dispose();
        return;
      }
      if (records.some(record => pathParents.has(record.target)) &&
          Array.from(originalPaths).some(([node, original]) => path(node) !== original)) dispose();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('pagehide', dispose);
    globalThis[key] = state;
    return { status: 'applied', compact: true, chatVisible: prefs.chatVisible, chatWidthDip: prefs.chatWidthDip };
  } catch {
    dispose();
    return unsupported('layout-error');
  }
}

module.exports.build = function build(prefs) {
  if (!prefs || typeof prefs.compact !== 'boolean' || typeof prefs.chatVisible !== 'boolean' ||
      !Number.isFinite(prefs.chatWidthDip) || prefs.chatWidthDip < 140 || prefs.chatWidthDip > 500) {
    return '({status:"unsupported",reason:"invalid-preferences",compact:false})';
  }
  const safe = { compact: prefs.compact, chatVisible: prefs.chatVisible, chatWidthDip: prefs.chatWidthDip };
  return '(() => { const result = (' + probe.toString() + ')(' + JSON.stringify(safe) + ');' +
    'globalThis[Symbol.for("live-union.g0.presentation.result")] = result; return result; })()';
};
