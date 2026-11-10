'use strict';

// Douyu presentation adapter 2026.11.07.3. Fixed packaged source only.
function probe(prefs) {
  'use strict';
  const version = '2026.11.07.3';
  const key = Symbol.for('live-union.douyu.presentation.state');
  const previous = window[key];
  const result = (status, reason, extra = {}) => {
    const value = { status, reason, ...extra };
    globalThis[Symbol.for('live-union.presentation.result')] = value;
    return value;
  };
  if (previous && previous.version !== version && typeof previous.dispose === 'function') previous.dispose();
  if (!prefs.compact) {
    if (previous && previous.version === version && typeof previous.dispose === 'function') previous.dispose();
    return result('restored', 'native-page');
  }
  if (previous && previous.version === version && typeof previous.update === 'function') return previous.update(prefs);

  const single = (root, selector) => {
    const all = root.querySelectorAll(selector);
    return all.length === 1 ? all[0] : null;
  };
  const player = single(document, '#js-player-video');
  const aside = single(document, '#js-player-asideMain');
  const chat = aside && single(aside, '.layout-Player-chat');
  // Candidate must exist inside the independently checked native common root.
  // No assumption that the 89px send panel itself is the chat history.
  const list = aside && single(aside, '#js-barrage-list');
  const barrage = aside && single(aside, '.Barrage');
  const input = chat && single(chat, 'textarea, [contenteditable="true"], [role="textbox"]');
  const videos = player ? [...player.querySelectorAll('video')] : [];
  const media = videos.filter(node => {
    const box = node.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  });
  if (!player || !aside || !chat || !list || !barrage || !barrage.contains(list) || !input || media.length !== 1 ||
      player.contains(aside) || aside.contains(player) || list.contains(chat) || chat.contains(list)) {
    return result('unsupported', 'native-structure');
  }
  const video = media[0];
  const frame = player.parentElement;
  const semanticSelector = '[class*="danmu"], [class*="Danmu"]';
  const editableSelector = 'input, textarea, [contenteditable="true"], [role="textbox"]';
  const finiteBox = box => ['x', 'y', 'width', 'height'].every(name => Number.isFinite(box[name]));
  const aligned = (box, target) => finiteBox(box) && finiteBox(target) &&
    ['x', 'y', 'width', 'height'].every(name => Math.abs(box[name] - target[name]) <= 2);
  const naturallyHidden = (node, boundary) => {
    const own = getComputedStyle(node);
    if (own.visibility === 'hidden' || own.visibility === 'collapse') return true;
    for (let parent = node; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).display === 'none') return true;
      if (parent === boundary) break;
    }
    return false;
  };
  const nativeBox = player.getBoundingClientRect();
  if (!frame || frame === document.body || frame === document.documentElement || frame.contains(aside) ||
      !finiteBox(nativeBox) || nativeBox.width < 1 || nativeBox.height < 1 || frame.children.length > 16) return result('unsupported', 'native-structure');
  // The native SDK (controls and DOM danmu renderers) is a sibling of the video
  // root, not its descendant. Identify only the local, geometrically matching
  // branch; a global class substring is never a visibility instruction.
  const candidates = [];
  for (const branch of frame.children) {
    if (branch === player || /^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT)$/.test(branch.tagName)) continue;
    const semantic = [...branch.querySelectorAll(semanticSelector)];
    if (!semantic.length) continue;
    // The identified SDK also owns native settings and in-player editors.
    // Keep those controls attached; their presence is not a second player.
    if (semantic.length > 512 || branch.contains(aside) || branch.querySelectorAll('video').length ||
        !aligned(branch.getBoundingClientRect(), nativeBox)) return result('unsupported', 'native-structure');
    const fullSize = semantic.filter(node => node.tagName === 'DIV' && aligned(node.getBoundingClientRect(), nativeBox));
    const fullRoots = fullSize.filter(node => !fullSize.some(other => other !== node && other.contains(node)));
    // A native disabled layer has no layout box. Retain its locally identified
    // outer semantic node, without forcing display/visibility or sizing an
    // unproven hidden path. Opening it later must pass the same real-box check.
    const hidden = semantic.filter(node => node.tagName === 'DIV' && naturallyHidden(node, branch));
    const hiddenRoots = hidden.filter(node => !fullRoots.some(root => root.contains(node)) &&
      !hidden.some(other => other !== node && other.contains(node)));
    const roots = [...fullRoots, ...hiddenRoots];
    if (!roots.length || fullRoots.length > 4 || roots.length > 16) return result('unsupported', 'native-structure');
    candidates.push({ branch, roots });
  }
  if (candidates.length !== 1) return result('unsupported', 'native-structure');
  const sdk = candidates[0].branch;
  const frameChildren = [...frame.children].filter(node => !/^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT)$/.test(node.tagName));
  const inertBranches = frameChildren.filter(node => node !== player && node !== sdk);
  const inert = node => {
    const box = node.getBoundingClientRect();
    return finiteBox(box) && (box.width === 0 || box.height === 0) && !node.contains(aside) &&
      !node.querySelectorAll('video, ' + editableSelector + ', ' + semanticSelector).length;
  };
  if (!frameChildren.includes(player) || !frameChildren.includes(sdk) || !inertBranches.every(inert)) return result('unsupported', 'native-structure');
  const danmakuRoots = candidates[0].roots;
  const rootParents = new Map(danmakuRoots.map(node => [node, node.parentElement]));
  const sdkPaths = new Map();
  for (const root of danmakuRoots) {
    if (naturallyHidden(root, sdk) && !aligned(root.getBoundingClientRect(), nativeBox)) continue;
    for (let node = root, depth = 0; node && node !== sdk; node = node.parentElement, depth++) {
      if (depth >= 12 || !sdk.contains(node) || !aligned(node.getBoundingClientRect(), nativeBox)) return result('unsupported', 'native-geometry');
      sdkPaths.set(node, node.parentElement);
    }
  }
  const videoParents = new Map();
  const stackPaths = new Set();
  for (const target of [frame, aside]) {
    for (let parent = target.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) stackPaths.add(parent);
  }
  const nativeSendHeight = Math.ceil(chat.getBoundingClientRect().height);
  if (nativeSendHeight < 60 || nativeSendHeight > 180) return result('unsupported', 'native-send-geometry');
  const barrageChain = [];
  for (let node = barrage.parentElement; node && node !== aside && barrageChain.length < 12; node = node.parentElement) barrageChain.push(node);
  if (!barrageChain.length || barrageChain[barrageChain.length - 1].parentElement !== aside ||
      barrageChain.some(node => node.contains(chat))) return result('unsupported', 'chat-ancestry');
  const scrollChain = [];
  for (let node = list.parentElement; node && node !== barrage && scrollChain.length < 8; node = node.parentElement) {
    const box = node.getBoundingClientRect();
    const parentBox = node.parentElement.getBoundingClientRect();
    scrollChain.push({ node, widthGap: parentBox.width - box.width, heightGap: parentBox.height - box.height });
  }
  if (scrollChain.length !== 4 || scrollChain[3].node.parentElement !== barrage ||
      scrollChain.some(item => !Number.isFinite(item.widthGap) || !Number.isFinite(item.heightGap) ||
        item.widthGap < -24 || item.widthGap > 160 || item.heightGap < -24 || item.heightGap > 160)) return result('unsupported', 'native-scroll-geometry');
  const videoChain = [];
  for (let node = video.parentElement; node && node !== player && videoChain.length < 12; node = node.parentElement) {
    videoChain.push(node);
    videoParents.set(node, node.parentElement);
  }
  if (videoChain.length && videoChain[videoChain.length - 1].parentElement !== player) return result('unsupported', 'player-depth');
  const blockedContainingBlock = node => {
    for (let parent = node.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const computed = getComputedStyle(parent);
      if (computed.transform !== 'none' || computed.filter !== 'none' || computed.perspective !== 'none' ||
          /paint|layout|strict|content/.test(computed.contain) || /transform|filter|perspective/.test(computed.willChange)) return true;
    }
    return false;
  };
  if (blockedContainingBlock(frame) || blockedContainingBlock(aside) || document.fullscreenElement ||
      [sdk, ...sdkPaths.keys()].some(node => getComputedStyle(node).transform !== 'none')) return result('unsupported', 'native-geometry');

  // Each property has an independent original value and priority. Never replace
  // cssText: that would overwrite unrelated inline changes made by the platform.
  const changes = new Map();
  let active = true;
  let queued = 0;
  let queuedTimer = 0;
  let current = prefs;
  let status = result('notReady', 'not-applied');
  let observer;
  function set(node, property, value) {
    let properties = changes.get(node);
    if (!properties) changes.set(node, properties = new Map());
    if (!properties.has(property)) properties.set(property, {
      value: node.style.getPropertyValue(property), priority: node.style.getPropertyPriority(property), applied: null
    });
    const record = properties.get(property);
    if (node.style.getPropertyValue(property) !== value || node.style.getPropertyPriority(property) !== 'important') node.style.setProperty(property, value, 'important');
    // CSSOM normalizes values such as #000 to rgb(0, 0, 0). Track the
    // installed value so ownership checks also restore normalized shorthands.
    record.applied = node.style.getPropertyValue(property);
  }
  function styles(node, values) { for (const [property, value] of Object.entries(values)) set(node, property, value); }
  function dispose() {
    if (!active) return;
    active = false;
    if (queued) cancelAnimationFrame(queued);
    if (queuedTimer) clearTimeout(queuedTimer);
    if (observer) observer.disconnect();
    window.removeEventListener('resize', schedule);
    video.removeEventListener('resize', schedule);
    video.removeEventListener('loadedmetadata', schedule);
    document.removeEventListener('fullscreenchange', onFullscreen);
    for (const [node, properties] of changes) for (const [property, record] of properties) {
      // If the platform took ownership back, preserve its newer value.
      if (node.style.getPropertyValue(property) !== record.applied || node.style.getPropertyPriority(property) !== 'important') continue;
      if (record.value) node.style.setProperty(property, record.value, record.priority);
      else node.style.removeProperty(property);
    }
    changes.clear();
    if (window[key] === state) delete window[key];
  }
  function fail(reason) {
    status = result('unsupported', reason);
    dispose();
    return status;
  }
  function geometryFailure(part, actual, expected, index = 0) {
    const safe = box => Object.fromEntries(['x', 'y', 'width', 'height'].map(name => [name,
      typeof box[name] === 'number' && Number.isFinite(box[name]) && Math.abs(box[name]) <= 1e7 ? box[name] : null
    ]));
    // Fixed enum + bounded numbers only. Preserve the failing boxes before
    // rollback; this remains untrusted page observation, never host authority.
    globalThis[Symbol.for('live-union.douyu.presentation.geometry')] = { part, index, actual: safe(actual), expected: safe(expected) };
    return fail('native-geometry');
  }
  function apply() {
    if (!active) return status;
    const semanticNow = new Set(sdk.querySelectorAll(semanticSelector));
    if (![frame, player, sdk, ...danmakuRoots, aside, chat, list, barrage, input, video].every(node => node.isConnected) ||
        player.parentElement !== frame || sdk.parentElement !== frame || sdk.contains(aside) ||
        frame.children.length > 16 ||
        [...frame.children].some(node => node !== player && node !== sdk &&
          !/^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT)$/.test(node.tagName) && !inert(node)) ||
        sdk.querySelectorAll('video').length ||
        [...rootParents].some(([node, parent]) => node.parentElement !== parent || !sdk.contains(node) || !semanticNow.has(node)) ||
        [...sdkPaths].some(([node, parent]) => !node.isConnected || node.parentElement !== parent) ||
        [...videoParents].some(([node, parent]) => node.parentElement !== parent) ||
        !aside.contains(list) || !aside.contains(chat) || !chat.contains(input) || !player.contains(video) ||
        list.parentElement !== scrollChain[0].node || video.parentElement !== (videoChain[0] || player) ||
        [...barrageChain, ...scrollChain.map(item => item.node), ...videoChain].some(node => !node.isConnected)) return fail('structure-changed');
    if (document.fullscreenElement || blockedContainingBlock(frame) || blockedContainingBlock(aside) ||
        [sdk, ...sdkPaths.keys()].some(node => getComputedStyle(node).transform !== 'none')) return fail('native-geometry');
    // Native account/verification dialogs need their complete page context.
    // This only recognizes semantic dialogs; custom platform portals still
    // require the explicit full-native fallback during real verification.
    const modal = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].some(node => {
      const rect = node.getBoundingClientRect();
      const computed = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && computed.display !== 'none' && computed.visibility !== 'hidden';
    });
    if (modal) return fail('native-overlay');
    // Release the original full-page minimums and scrollbars before measuring.
    // Only the page roots are clipped; native Barrage scrolling stays intact.
    for (const root of [document.documentElement, document.body]) styles(root, {
      'min-width': '0px', 'min-height': '0px', width: '100%', height: '100%',
      'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
      'overflow-x': 'hidden', 'overflow-y': 'hidden'
    });
    const width = Math.floor(document.documentElement.clientWidth);
    const height = Math.floor(document.documentElement.clientHeight);
    const chatWidth = current.chatVisible ? current.chatWidthDip : 0;
    const playerWidth = width - chatWidth;
    // Video-only views keep contain layout at every positive viewport size.
    // Visible native chat needs its observed full-width controls and history.
    if (playerWidth < 1 || height < 1 || (current.chatVisible && (chatWidth < 380 || playerWidth < 128 || height < 240))) return fail('insufficient-space');
    const mediaWidth = video.videoWidth, mediaHeight = video.videoHeight;
    if (!Number.isFinite(mediaWidth) || !Number.isFinite(mediaHeight) || mediaWidth < 1 || mediaHeight < 1 || mediaWidth > 1e6 || mediaHeight > 1e6)
      return geometryFailure('intrinsic', { width: mediaWidth, height: mediaHeight }, { width: 1, height: 1 });
    const scale = Math.min(playerWidth / mediaWidth, height / mediaHeight);
    const contentWidth = mediaWidth * scale, contentHeight = mediaHeight * scale;
    const contentX = (playerWidth - contentWidth) / 2, contentY = (height - contentHeight) / 2;
    // A fixed child cannot escape an ancestor stacking context. Elevate both
    // retained ancestor paths, including static wrappers, instead of assuming
    // that changing the player's z-index alone beats the original header.
    for (const ancestor of stackPaths) {
      if (!ancestor.isConnected || (!ancestor.contains(frame) && !ancestor.contains(aside))) return fail('structure-changed');
      if (getComputedStyle(ancestor).position === 'static') set(ancestor, 'position', 'relative');
      set(ancestor, 'z-index', '2147483000');
    }
    // The page can mount navigation in a separate body aside or in intermediate
    // wrappers. Retain the complete shared native frame, including its SDK
    // sibling branch. Never traverse either retained root's
    // descendants, and preserve executable/style resource elements.
    const retained = new Map();
    for (const target of [frame, aside]) {
      for (let child = target, depth = 0; child.parentElement && depth < 24; child = child.parentElement, depth++) {
        const parent = child.parentElement;
        if (!retained.has(parent)) retained.set(parent, new Set());
        retained.get(parent).add(child);
        if (parent === document.body) break;
      }
    }
    let siblingCount = 0;
    for (const [parent, kept] of retained) for (const sibling of parent.children) {
      if (++siblingCount > 512) return fail('native-structure');
      if (kept.has(sibling) || /^(SCRIPT|STYLE|LINK|META|TEMPLATE|NOSCRIPT)$/.test(sibling.tagName)) continue;
      set(sibling, 'display', 'none');
    }
    styles(frame, {
      position: 'fixed', left: '0px', top: '0px', right: 'auto', bottom: 'auto',
      width: playerWidth + 'px', height: height + 'px', 'min-width': '0px', 'min-height': '0px',
      'max-width': 'none', 'max-height': 'none', margin: '0px', transform: 'none',
      'box-sizing': 'border-box', overflow: 'visible', 'z-index': '2147483000', background: '#000'
    });
    // Both native siblings use the same contain rectangle. Do not raise the
    // video above the SDK, detach nodes, or change native danmaku configuration.
    for (const node of [player, sdk]) styles(node, {
      position: 'absolute', left: contentX + 'px', top: contentY + 'px', right: 'auto', bottom: 'auto',
      width: contentWidth + 'px', height: contentHeight + 'px', 'min-width': '0px', 'min-height': '0px',
      'max-width': 'none', 'max-height': 'none', margin: '0px', padding: '0px', 'box-sizing': 'border-box'
    });
    for (const node of videoChain) styles(node, {
      width: '100%', height: '100%', 'min-width': '0px', 'min-height': '0px',
      'max-width': 'none', 'max-height': 'none', 'box-sizing': 'border-box'
    });
    styles(video, { width: '100%', height: '100%', 'object-fit': 'contain', 'object-position': '50% 50%' });
    for (const node of sdkPaths.keys()) styles(node, {
      position: 'absolute', left: '0px', top: '0px', right: 'auto', bottom: 'auto',
      width: '100%', height: '100%', 'min-width': '0px', 'min-height': '0px',
      'max-width': 'none', 'max-height': 'none', margin: '0px', padding: '0px', 'box-sizing': 'border-box'
    });
    styles(aside, {
      position: 'fixed', left: playerWidth + 'px', top: '0px', right: 'auto', bottom: 'auto',
      width: Math.max(chatWidth, 380) + 'px', height: height + 'px', 'min-width': '0px', 'min-height': '0px',
      'max-width': 'none', 'max-height': 'none', margin: '0px', transform: 'none',
      'box-sizing': 'border-box', display: current.chatVisible ? 'block' : 'none', 'z-index': '2147483000', background: '#fff'
    });
    if (current.chatVisible) {
      // Reserve the original native send region. Do not inspect or change its value.
      const sendHeight = nativeSendHeight;
      if (sendHeight > height - 100) return fail('insufficient-chat-space');
      styles(chat, {
        position: 'absolute', left: '0px', right: 'auto', top: 'auto', bottom: '0px',
        width: '100%', height: sendHeight + 'px', 'min-width': '0px', 'max-width': 'none',
        margin: '0px', 'box-sizing': 'border-box', 'z-index': '2'
      });
      // Keep every native component attached. The outer list branch fills the
      // space above the existing send panel; its inner ancestors fill that branch.
      for (let index = 0; index < barrageChain.length; index++) styles(barrageChain[index], {
        position: 'absolute', left: '0px', top: '0px', right: 'auto', bottom: 'auto',
        width: '100%', height: index === barrageChain.length - 1 ? height - sendHeight + 'px' : '100%',
        'min-width': '0px', 'min-height': '0px', 'max-width': 'none', 'max-height': 'none',
        margin: '0px', 'box-sizing': 'border-box', overflow: 'visible'
      });
      styles(barrage, {
        position: 'absolute', left: '0px', top: '0px', right: 'auto', bottom: 'auto',
        width: '100%', height: '100%', 'min-width': '0px', 'min-height': '0px',
        'max-width': 'none', 'max-height': 'none', margin: '0px', 'box-sizing': 'border-box',
        'z-index': '1', background: '#fff'
      });
      // Preserve the measured native scroll viewport offsets (including its 15px
      // scrollbar compensation). Never size/translate the message UL itself.
      for (const item of scrollChain) styles(item.node, {
        width: 'calc(100% ' + (item.widthGap < 0 ? '+ ' : '- ') + Math.abs(item.widthGap) + 'px)',
        height: 'calc(100% ' + (item.heightGap < 0 ? '+ ' : '- ') + Math.abs(item.heightGap) + 'px)',
        'min-width': '0px', 'min-height': '0px', 'max-width': 'none', 'max-height': 'none'
      });
    }
    const expected = { x: contentX, y: contentY, width: contentWidth, height: contentHeight };
    // This is a layout/visibility check, not a claim that messages were painted.
    // Native root visibility/opacity/display values are never changed here.
    for (const [part, node, target] of [
      ['frame', frame, { x: 0, y: 0, width: playerWidth, height }],
      ['player', player, expected], ['sdk', sdk, expected], ['video', video, expected]
    ]) {
      const box = node.getBoundingClientRect();
      if (!aligned(box, target)) return geometryFailure(part, box, target);
    }
    for (let index = 0; index < danmakuRoots.length; index++) {
      const node = danmakuRoots[index], box = node.getBoundingClientRect();
      if (!naturallyHidden(node, sdk) && !aligned(box, expected)) return geometryFailure('danmu', box, expected, index);
    }
    globalThis[Symbol.for('live-union.douyu.presentation.geometry')] = { part: 'aligned', index: 0 };
    status = result('applied', playerWidth<320?'controls-need-zoom':'candidate-layout', {
      chatVisible: current.chatVisible, width, height, playerWidth, chatWidth,
      contentX, contentY, contentWidth, contentHeight, sdkAligned: true, danmakuRoots: danmakuRoots.length
    });
    return status;
  }
  function schedule() {
    if (!active || queued || queuedTimer) return;
    queuedTimer = setTimeout(() => {
      queuedTimer = 0;
      if (!active) return;
      queued = requestAnimationFrame(() => { queued = 0; try { apply(); } catch (_) { fail('probe-error'); } });
    }, 120);
  }
  function onFullscreen() { if (document.fullscreenElement) fail('native-fullscreen'); }
  const state = { version, dispose, update(next) { current = next; try { return apply(); } catch (_) { return fail('probe-error'); } } };
  window[key] = state;
  try {
    const first = apply();
    if (!active) return first;
    // Watch direct parent structure, never chat message descendants or text.
    const parents = new Set();
    for (const target of [frame, player, ...danmakuRoots, aside, chat, list, input]) {
      for (let parent = target.parentElement, depth = 0; parent && depth < 12; parent = parent.parentElement, depth++) parents.add(parent);
    }
    observer = new MutationObserver(schedule);
    for (const parent of parents) observer.observe(parent, {
      childList: true,
      ...(parent === sdk || sdkPaths.has(parent) ? { attributes: true, attributeFilter: ['style', 'class', 'hidden'] } : {})
    });
    for (const root of danmakuRoots) observer.observe(root, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    window.addEventListener('resize', schedule);
    video.addEventListener('resize', schedule);
    video.addEventListener('loadedmetadata', schedule);
    document.addEventListener('fullscreenchange', onFullscreen);
    return first;
  } catch (_) {
    return fail('probe-error');
  }
}

module.exports.build = function build(prefs) {
  if (!prefs || typeof prefs.compact !== 'boolean' || typeof prefs.chatVisible !== 'boolean' ||
      typeof prefs.chatWidthDip !== 'number' || !Number.isFinite(prefs.chatWidthDip) ||
      prefs.chatWidthDip < 140 || prefs.chatWidthDip > 500) throw new TypeError('Invalid Douyu presentation preferences');
  const safe = { compact: prefs.compact, chatVisible: prefs.chatVisible, chatWidthDip: Math.round(prefs.chatWidthDip) };
  return '(' + probe.toString() + ')(' + JSON.stringify(safe) + ')';
};
