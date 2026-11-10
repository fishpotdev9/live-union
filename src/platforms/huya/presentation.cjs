'use strict';

// Serialized fixed presentation logic; no Node, IPC, network or input-value access.
function present(prefs) {
  const version = '2026.11.08.2';
  const key = Symbol.for('live-union.huya.presentation.v1');
  const resultKey = Symbol.for('live-union.presentation.result');
  const geometryKey = Symbol.for('live-union.huya.geometry');
  const styleId = 'live-union-huya-presentation-v1';
  const publish = (status, reason) => {
    const result = reason ? { status, reason } : { status };
    globalThis[resultKey] = result;
    return result;
  };
  const previous = globalThis[key];
  // Keep the already identified native components across layout updates. A
  // naturally hidden bar cannot be safely re-identified by its current height.
  if (prefs && prefs.compact && previous && previous.version === version && typeof previous.update === 'function') {
    return previous.update(prefs);
  }
  if (previous && typeof previous.dispose === 'function') previous.dispose();
  // Each application starts a fresh observation. A failed layout below keeps
  // its finite pre-rollback rectangles for the restricted host inspector.
  delete globalThis[geometryKey];
  if (!prefs) return publish('unsupported', 'invalid-preferences');
  if (!prefs.compact) return publish('restored');
  const unsupported = reason => publish('unsupported', reason);
  if (!document.body || !document.head) return publish('notReady', 'document-not-ready');
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
  const stages = player.querySelectorAll('.player-wrap');
  const videos = player.querySelectorAll('video');
  const inputs = core.querySelectorAll('textarea, [contenteditable="true"]');
  if (stages.length !== 1 || videos.length !== 1 || inputs.length !== 1) return unsupported('structure');
  const stage = stages[0];
  const video = videos[0];
  const input = inputs[0];
  if (!stage.contains(video) || player.contains(input)) return unsupported('structure');

  // The live G0 sample confirmed these two sibling branches outside the stage:
  // native controls (44px) then gift/recharge (60px). Permit extra inert branches
  // and changed child counts, but never guess when the candidates are ambiguous.
  const stageParent = stage.parentElement;
  if (!stageParent || !player.contains(stageParent) || stageParent.children.length > 40) return unsupported('player-structure');
  const branches = Array.from(stageParent.children);
  const sourceStage = stage.getBoundingClientRect();
  const sourceParent = stageParent.getBoundingClientRect();
  if (sourceStage.width <= 0 || sourceStage.height <= 0 || sourceParent.width <= 0) return publish('notReady', 'player-not-ready');
  const candidates = branches.filter(node => {
    if (node === stage || node.contains(stage) || stage.contains(node) ||
        node.querySelector('video, textarea, [contenteditable="true"]')) return false;
    const box = node.getBoundingClientRect();
    // Width can still describe the preceding viewport. It is a presentation
    // result to validate later, not the identity of this native component.
    return Number.isFinite(box.width) && box.width > 0 && box.width <= 16000;
  });
  const controlCandidates = candidates.filter(node => {
    const height = node.getBoundingClientRect().height;
    return height >= 24 && height <= 54 && node.children.length >= 4;
  });
  const giftCandidates = candidates.filter(node => {
    const height = node.getBoundingClientRect().height;
    return height >= 56 && height <= 96 && node.children.length >= 2;
  });
  let controls = controlCandidates[0];
  let giftStrip = giftCandidates[0];
  let nativeControlsHeight;
  if (controlCandidates.length !== 1 || giftCandidates.length !== 1) {
    // Only the exact all-hidden structure independently sampled in G0 and
    // room 138297 may be measured without positive initial rectangles.
    const safePeer = node => node && !node.contains(stage) && !stage.contains(node) &&
      !node.querySelector('video, textarea, [contenteditable="true"]');
    const hiddenControls = branches[2];
    const hiddenGift = branches[4];
    const display = node => window.getComputedStyle(node).getPropertyValue('display');
    if (controlCandidates.length || giftCandidates.length || branches.length !== 15 || branches[0] !== stage ||
        stage.children.length !== 9 || !safePeer(hiddenControls) || !safePeer(hiddenGift) ||
        hiddenControls.children.length !== 9 || hiddenGift.children.length !== 4 ||
        branches.filter(node => node !== stage && safePeer(node) && node.children.length === 9).length !== 1 ||
        branches.filter(node => safePeer(node) && node.children.length === 4).length !== 1 ||
        display(hiddenControls) !== 'none' || display(hiddenGift) !== 'none') return unsupported('player-structure');
    const naturalBox = node => {
      const value = node.style.getPropertyValue('display');
      const priority = node.style.getPropertyPriority('display');
      try {
        node.style.setProperty('display', 'block', 'important');
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      } finally {
        if (value) node.style.setProperty('display', value, priority);
        else node.style.removeProperty('display');
      }
    };
    let controlBox, giftBox;
    try { controlBox = naturalBox(hiddenControls); giftBox = naturalBox(hiddenGift); }
    catch { return unsupported('player-structure'); }
    if (![controlBox.width, controlBox.height, giftBox.width, giftBox.height].every(Number.isFinite) ||
        controlBox.width <= 0 || giftBox.width <= 0 || controlBox.width > 16000 || giftBox.width > 16000 ||
        controlBox.height < 24 || controlBox.height > 54 || giftBox.height < 56 || giftBox.height > 96) {
      return unsupported('player-structure');
    }
    controls = hiddenControls; giftStrip = hiddenGift; nativeControlsHeight = controlBox.height;
  } else nativeControlsHeight = controls.getBoundingClientRect().height;
  if (!(branches.indexOf(stage) < branches.indexOf(controls) && branches.indexOf(controls) < branches.indexOf(giftStrip))) {
    return unsupported('player-structure');
  }
  // An additional visible peer might be a new native feature or overlay: leave
  // the complete page available instead of hiding an unrecognized component.
  if (branches.some(node => {
    if (node === stage || node === controls || node === giftStrip) return false;
    const box = node.getBoundingClientRect();
    return box.width > 8 && box.height > 8;
  })) return unsupported('player-structure');
  // DIP conversion can report 44.000003 for a 44px native bar. Repeated SDK
  // feedback must not turn that into 45, 46, ... on each presentation.
  const controlsHeight = Math.ceil(nativeControlsHeight - 0.01);
  const controlsMinimumWidth = Math.max(640, Math.min(1600, Math.ceil(controls.scrollWidth || sourceParent.width)));
  const nativeControlsDisplay = window.getComputedStyle(controls).getPropertyValue('display');
  const controlsDisplay = nativeControlsDisplay === 'none' ? 'block' : nativeControlsDisplay;
  if (!['block', 'flex', 'inline-flex', 'grid', 'inline-grid'].includes(controlsDisplay)) return unsupported('player-structure');

  // #chatRoom is only the list branch on the current Huya page. The sender is
  // retained by identifying its actual lowest common ancestor with the list.
  let chat = list.parentElement;
  for (let depth = 0; chat && !chat.contains(input) && depth < 24; depth++) chat = chat.parentElement;
  if (!chat || chat === core || chat === document.body || !core.contains(chat) ||
      chat.contains(player) || player.contains(chat) || !chat.contains(input)) return unsupported('chat-structure');
  const childOnPath = (parent, target) => {
    let node = target;
    for (let depth = 0; node && node.parentElement !== parent && depth < 32; depth++) node = node.parentElement;
    return node && node.parentElement === parent ? node : null;
  };
  const listBranch = childOnPath(chat, list);
  const inputBranch = childOnPath(chat, input);
  if (!listBranch || !inputBranch || listBranch === inputBranch) return unsupported('chat-structure');
  if (prefs.chatVisible && input.getBoundingClientRect().height <= 0) return publish('notReady', 'input-not-ready');
  if (prefs.chatVisible && prefs.chatWidthDip < 320) return unsupported('chat-too-narrow');
  const senderHeight = Math.max(input.getBoundingClientRect().height, inputBranch.getBoundingClientRect().height);
  if (prefs.chatVisible && (!Number.isFinite(senderHeight) || senderHeight <= 0 || senderHeight > 10000)) {
    return publish('notReady', 'input-not-ready');
  }
  // Confirmed empty 60px lower spacer beside the native layer/player branch.
  // Remove only its paint/hit surface; keep the original node and geometry.
  const playerBranch = childOnPath(player, stage);
  const spacer = player.children.length === 3 && player.children[0].children.length === 0 &&
    player.children[1] === layer && player.children[2] === playerBranch &&
    player.children[0].getBoundingClientRect().height >= 56 && player.children[0].getBoundingClientRect().height <= 96
    ? player.children[0] : null;

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
  if (spacer) tracked.push(spacer);
  if (tracked.some(node => !path(node))) return unsupported('structure');
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
  let viewportWidth = 0;
  let viewportHeight = 0;
  let controlsRepairs = 0;
  let visibilityRepairs = 0;
  const ownedControlStyles = new Map();
  const ownedVisibilityStyles = new Map();
  const activityBindings = [];
  let geometryCss = '';
  let controlsShown = false;
  let overControls = false;
  let overBottom = false;
  let draggingControls = false;
  let idleTimer = 0;
  let suppressMenus = false;
  const nativeBarVisible = () => {
    const computed = window.getComputedStyle(controls);
    return computed.getPropertyValue('display') !== 'none' &&
      !['hidden', 'collapse'].includes(computed.getPropertyValue('visibility'));
  };
  const controlsMatch = () => {
    // Native responsive/idle display changes are not geometry competition.
    if (!nativeBarVisible()) return true;
    const propertiesMatch = Array.from(ownedControlStyles).every(([name, record]) => {
      // With explicit left/top and width/height, the native SDK may rewrite the
      // redundant right/bottom insets on every hover. They do not compete while
      // the real anchored rectangle below is unchanged. Counting these writes
      // exhausted the repair budget and unnecessarily removed compact styling.
      if (name === 'right' || name === 'bottom') return true;
      const current = controls.style.getPropertyValue(name);
      const important = controls.style.getPropertyPriority(name) === 'important';
      // Harmless SDK/DIP feedback must not consume the repair budget. Still
      // compare the actual box below: an equal inline value alone is insufficient.
      const nearPixels = current.endsWith('px') && record.applied.endsWith('px') &&
        Math.abs(parseFloat(current) - parseFloat(record.applied)) <= 0.01;
      return (current === record.applied && important) || nearPixels;
    });
    if (!propertiesMatch) return false;
    const rect = controls.getBoundingClientRect();
    return [['width', 'width'], ['height', 'height'], ['left', 'x'], ['top', 'y']].every(([name, field]) =>
      !ownedControlStyles.has(name) || Math.abs(rect[field] - parseFloat(ownedControlStyles.get(name).applied)) <= 1);
  };
  const setOwnedStyle = (records, name, value) => {
    const current = controls.style.getPropertyValue(name);
    const priority = controls.style.getPropertyPriority(name);
    let record = records.get(name);
    if (!record) {
      record = { original: current, priority, applied: value };
      records.set(name, record);
    } else if (current !== record.applied || priority !== 'important') {
      // Keep the latest SDK update as the restore baseline before overriding it.
      record.original = current;
      record.priority = priority;
    }
    record.applied = value;
    if (current !== value || priority !== 'important') controls.style.setProperty(name, value, 'important');
  };
  const setControlStyle = (name, value) => setOwnedStyle(ownedControlStyles, name, value);
  const idleClickThrough = () => {
    if (typeof document.elementFromPoint !== 'function') return false;
    const available = viewportWidth - (prefs.chatVisible ? prefs.chatWidthDip : 0);
    return [0.25, 0.5, 0.75].every(fraction => {
      const hit = document.elementFromPoint(available * fraction, viewportHeight - controlsHeight / 2);
      return !!hit && !controls.contains(hit);
    });
  };
  const updateActivityDiagnostic = () => {
    const snapshot = globalThis[geometryKey];
    if (snapshot && snapshot.controlsStyle) {
      snapshot.controlsStyle.shown = controlsShown;
      snapshot.controlsStyle.nativeVisible = nativeBarVisible();
      const opacity = parseFloat(window.getComputedStyle(controls).getPropertyValue('opacity'));
      if (Number.isFinite(opacity) && opacity >= 0 && opacity <= 1) snapshot.controlsStyle.computedOpacity = opacity;
      snapshot.controlsStyle.idleClickThrough = idleClickThrough();
    }
  };
  const renderStyle = () => {
    const selector = path(controls);
    const css = geometryCss + (controlsShown ? '' : '\n' + selector + ',' + selector +
      ' *{pointer-events:none!important;}');
    if (style.textContent !== css) style.textContent = css;
  };
  const visibilityMatches = () => {
    const computed = window.getComputedStyle(controls);
    const color = computed.getPropertyValue('background-color').replace(/\s/g, '');
    return parseFloat(computed.getPropertyValue('opacity')) === (controlsShown ? 1 : 0) &&
      computed.getPropertyValue('pointer-events') === (controlsShown ? 'auto' : 'none') &&
      ['transparent', 'rgba(0,0,0,0)'].includes(color) && computed.getPropertyValue('background-image') === 'none';
  };
  const setControlsShown = shown => {
    if (shown === controlsShown && ownedVisibilityStyles.size === 6 && visibilityMatches()) return;
    controlsShown = shown;
    // A CSS transition can outrank an important opacity declaration and keep
    // the old computed paint in this task. Disable only the bar root's two
    // animation longhands before changing paint; child controls stay untouched.
    setOwnedStyle(ownedVisibilityStyles, 'transition-property', 'none');
    setOwnedStyle(ownedVisibilityStyles, 'animation-name', 'none');
    setOwnedStyle(ownedVisibilityStyles, 'opacity', shown ? '1' : '0');
    setOwnedStyle(ownedVisibilityStyles, 'pointer-events', shown ? 'auto' : 'none');
    setOwnedStyle(ownedVisibilityStyles, 'background-color', 'transparent');
    setOwnedStyle(ownedVisibilityStyles, 'background-image', 'none');
    renderStyle();
    updateActivityDiagnostic();
  };
  const hasControlFocus = () => (!document.hasFocus || document.hasFocus()) && controls.contains(document.activeElement);
  const visibleMenu = () => {
    if (suppressMenus) return false;
    // Fixed semantic selectors only, bounded results; never read menu text,
    // input values, account attributes or message bodies.
    const menus = Array.from(controls.querySelectorAll('[aria-expanded="true"],[role="menu"],[role="listbox"],[role="dialog"]')).slice(0, 32);
    menus.push(...Array.from(document.querySelectorAll('[role="menu"],[role="listbox"]')).slice(0, 16));
    for (const node of menus) {
      if (chat.contains(node)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      let hidden = false;
      for (let parent = node, depth = 0; parent && depth < 16; parent = parent.parentElement, depth++) {
        const computed = window.getComputedStyle(parent);
        if (parent.matches('[aria-hidden="true"],[hidden]') || computed.getPropertyValue('display') === 'none' ||
            ['hidden', 'collapse'].includes(computed.getPropertyValue('visibility')) ||
            parseFloat(computed.getPropertyValue('opacity')) === 0) { hidden = true; break; }
      }
      if (!hidden) return true;
    }
    return false;
  };
  const armHide = () => {
    if (idleTimer) window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      idleTimer = 0;
      if (disposed || globalThis[key] !== state) return;
      if (overControls || controls.matches(':hover') || overBottom || draggingControls || hasControlFocus()) return;
      if (visibleMenu()) { armHide(); return; }
      setControlsShown(false);
    }, 1600);
  };
  const reveal = () => {
    if (disposed || globalThis[key] !== state) return;
    setControlsShown(true);
    armHide();
  };
  const inVideoArea = event => Number.isFinite(event.clientX) && Number.isFinite(event.clientY) &&
    event.clientX >= 0 && event.clientX < viewportWidth - (prefs.chatVisible ? prefs.chatWidthDip : 0) &&
    event.clientY >= 0 && event.clientY < viewportHeight;
  const onPointerMove = event => {
    overBottom = inVideoArea(event) && event.clientY >= viewportHeight - controlsHeight - 8;
    if (inVideoArea(event) || controls.contains(event.target)) reveal();
    else { overControls = false; if (controlsShown) armHide(); }
  };
  const onControlsEnter = () => { overControls = true; suppressMenus = false; reveal(); };
  const onControlsLeave = () => { overControls = false; armHide(); };
  const onPlayerLeave = () => { overControls = false; overBottom = false; if (controlsShown) armHide(); };
  const isMenuTarget = target => {
    const menu = target && typeof target.closest === 'function' && target.closest('[role="menu"],[role="listbox"],[role="dialog"]');
    return menu && !chat.contains(menu);
  };
  const onPointerDown = event => {
    if (controls.contains(event.target)) { draggingControls = true; suppressMenus = false; reveal(); }
    else if (controlsShown && isMenuTarget(event.target)) { suppressMenus = false; reveal(); }
    else { suppressMenus = true; draggingControls = false; if (controlsShown) armHide(); }
  };
  const onPointerUp = () => { draggingControls = false; if (controlsShown) armHide(); };
  const onFocusIn = event => { if (controls.contains(event.target)) { suppressMenus = false; reveal(); } };
  const onFocusOut = () => { if (controlsShown) armHide(); };
  const onKeyDown = event => {
    if (event.key === 'Escape') { suppressMenus = true; draggingControls = false; armHide(); }
    else if (hasControlFocus()) reveal();
  };
  const onBlur = () => { overControls = false; overBottom = false; draggingControls = false; armHide(); };
  const listen = (target, name, handler, options) => {
    target.addEventListener(name, handler, options);
    activityBindings.push([target, name, handler, options]);
  };
  const restoreOwnedStyles = records => {
    for (const [name, record] of records) {
      if (controls.style.getPropertyValue(name) !== record.applied || controls.style.getPropertyPriority(name) !== 'important') continue;
      if (record.original) controls.style.setProperty(name, record.original, record.priority);
      else controls.style.removeProperty(name);
    }
    records.clear();
  };
  const state = { version, dispose: () => dispose('restored'), update(next) {
    if (disposed || globalThis[key] !== state) return { status: 'unsupported', reason: 'structure-changed' };
    delete globalThis[geometryKey];
    prefs = next;
    try {
      if (prefs.chatVisible && prefs.chatWidthDip < 320) { dispose('unsupported', 'chat-too-narrow'); return globalThis[resultKey]; }
      const current = Array.from(stageParent.children);
      const sameTargets = player.querySelectorAll('.player-wrap'), sameVideos = player.querySelectorAll('video');
      const sameInputs = core.querySelectorAll('textarea, [contenteditable="true"]');
      if (tracked.some(node => !node.isConnected) || Array.from(originalPaths).some(([node, original]) => path(node) !== original) ||
          !core.contains(player) || !core.contains(room) || !room.contains(list) || !player.contains(layer) ||
          !stage.contains(video) || !chat.contains(input) || !chat.contains(list) ||
          sameTargets.length !== 1 || sameTargets[0] !== stage || sameVideos.length !== 1 || sameVideos[0] !== video ||
          sameInputs.length !== 1 || sameInputs[0] !== input || current.length > 40 ||
          !(current.indexOf(stage) >= 0 && current.indexOf(stage) < current.indexOf(controls) && current.indexOf(controls) < current.indexOf(giftStrip)) ||
          current.some(node => {
            if (node === stage || node === controls || node === giftStrip) return false;
            const box = node.getBoundingClientRect(); return box.width > 8 && box.height > 8;
          })) {
        dispose('unsupported', 'structure-changed'); return globalThis[resultKey];
      }
      return applyLayout();
    } catch { dispose('failed', 'layout-error'); return globalThis[resultKey]; }
  } };
  function dispose(status, reason) {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', onPageHide);
    video.removeEventListener('resize', onResize);
    if (frame) cancelAnimationFrame(frame);
    if (idleTimer) window.clearTimeout(idleTimer);
    for (const [target, name, handler, options] of activityBindings) target.removeEventListener(name, handler, options);
    activityBindings.length = 0;
    if (observer) observer.disconnect();
    style.remove();
    restoreOwnedStyles(ownedVisibilityStyles);
    restoreOwnedStyles(ownedControlStyles);
    // A late callback from an older presentation cannot change new diagnostics.
    if (globalThis[key] === state) {
      delete globalThis[key];
      if (status === 'restored' || reason === 'structure-changed' || reason === 'space') delete globalThis[geometryKey];
      publish(status, reason);
    }
  }
  function onPageHide() { dispose('restored', 'page-hidden'); }
  const layout = () => {
    delete globalThis[geometryKey];
    if (disposed || tracked.some(node => !node.isConnected) || !chat.contains(list) ||
        !chat.contains(input) || !player.contains(video)) return 'structure-changed';
    const width = Math.floor(window.innerWidth);
    const height = Math.floor(window.innerHeight);
    const available = width - (prefs.chatVisible ? prefs.chatWidthDip : 0);
    if (width !== viewportWidth || height !== viewportHeight) {
      viewportWidth = width; viewportHeight = height; controlsRepairs = 0; visibilityRepairs = 0;
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width > 16000 || height > 16000 ||
        available < (prefs.chatVisible ? 128 : 180) ||
        height < 120) return 'space';
    const sourceRatio = video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
    const ratio = Number.isFinite(sourceRatio) && sourceRatio >= 0.3 && sourceRatio <= 4 ? sourceRatio : 16 / 9;
    // Native controls are a temporary overlay, never a permanent reserved strip.
    const videoWidth = Math.min(available, height * ratio);
    const videoHeight = videoWidth / ratio;
    const left = Math.max(0, (available - videoWidth) / 2);
    const top = Math.max(0, (height - videoHeight) / 2);
    const narrowControls = available < controlsMinimumWidth || height < 300;
    const rules = [];
    const rule = (node, properties) => rules.push(path(node) + '{' + properties + '}');
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
      'transform:none!important;contain:none!important;background:#000!important;');
    rule(stage, 'position:absolute!important;inset:auto!important;left:' + left + 'px!important;top:' + top + 'px!important;' +
      'width:' + videoWidth + 'px!important;height:' + videoHeight + 'px!important;' +
      'min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;' +
      'margin:0!important;box-sizing:border-box!important;overflow:visible!important;background:#000!important;z-index:1!important;');
    rule(giftStrip, 'display:none!important;');
    if (spacer) rule(spacer, 'background:transparent!important;box-shadow:none!important;border:0!important;pointer-events:none!important;');
    // Keep the complete native control tree as a bounded bottom overlay.
    // In a small room the bar may need room zoom for complete native menus;
    // do not scale the whole page or remove native controls to make it fit.
    rule(controls, 'position:fixed!important;inset:auto!important;left:0!important;top:' + (height - controlsHeight) + 'px!important;bottom:auto!important;' +
      'width:' + available + 'px!important;height:' + controlsHeight + 'px!important;min-width:0!important;' +
      'max-width:none!important;margin:0!important;box-sizing:border-box!important;' +
      'transform:none!important;z-index:10002!important;' +
      (narrowControls ? 'overflow-x:auto!important;overflow-y:hidden!important;' : 'overflow:visible!important;'));
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
    for (const child of chat.children) rule(child,
      'flex:0 0 auto!important;min-width:0!important;max-width:100%!important;box-sizing:border-box!important;');
    for (let node = listBranch; node && node !== list; node = childOnPath(node, list)) rule(node,
      'display:flex!important;flex-direction:column!important;flex:1 1 0!important;position:relative!important;' +
      'top:auto!important;bottom:auto!important;width:100%!important;height:auto!important;min-height:0!important;' +
      'max-height:none!important;margin:0!important;box-sizing:border-box!important;');
    rule(list, 'position:relative!important;inset:auto!important;flex:1 1 0!important;width:100%!important;' +
      'height:auto!important;min-height:80px!important;max-height:none!important;margin:0!important;box-sizing:border-box!important;');
    geometryCss = rules.join('\n');
    renderStyle();
    if (prefs.chatVisible) {
      // The preceding compact view can naturally have a zero-height sender.
      // Reveal the same native chat first, then measure its real current budget.
      // Do not substitute a guessed sender height or retain an old zero value.
      const measuredSenderHeight = Math.max(input.getBoundingClientRect().height, inputBranch.getBoundingClientRect().height);
      if (!Number.isFinite(measuredSenderHeight) || measuredSenderHeight <= 0 || measuredSenderHeight > 10000) return 'chat-layout';
      if (height < Math.max(120, Math.ceil(measuredSenderHeight - 0.01) + 80)) return 'space';
    }
    // An inline !important SDK width outranks stylesheet rules. Only these
    // presentation properties are owned, with exact restoration and a bounded
    // repair budget if the SDK races an actual viewport change.
    if (controlsRepairs <= 3 || controlsMatch()) {
      setControlStyle('width', available + 'px');
      setControlStyle('min-width', '0px');
      setControlStyle('max-width', available + 'px');
      setControlStyle('height', controlsHeight + 'px');
      setControlStyle('box-sizing', 'border-box');
      // The native bar can retain an important bottom:60px or transform after
      // the gift strip is hidden. Anchor it explicitly to this viewport instead.
      setControlStyle('position', 'fixed');
      setControlStyle('left', '0px');
      setControlStyle('right', 'auto');
      setControlStyle('top', (height - controlsHeight) + 'px');
      setControlStyle('bottom', 'auto');
      setControlStyle('transform', 'none');
    }
    setControlsShown(controlsShown);
    const inside = (rect, right = width) => rect.width > 0 && rect.height > 0 && rect.x >= -1 && rect.y >= -1 &&
      rect.right <= right + 1 && rect.bottom <= height + 1;
    const videoRect = video.getBoundingClientRect();
    const nativeControlsRect = controls.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const numericBox = rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    const geometry = {
      viewport: { width, height },
      stage: numericBox(stageRect),
      video: numericBox(videoRect),
      controls: numericBox(nativeControlsRect),
    };
    const computedControls = window.getComputedStyle(controls);
    const nativeVisible = nativeBarVisible();
    const controlsStyle = { inlineImportant: controls.style.getPropertyPriority('width') === 'important',
      overlay: true, shown: controlsShown, nativeVisible };
    const computedOpacity = parseFloat(computedControls.getPropertyValue('opacity'));
    if (Number.isFinite(computedOpacity) && computedOpacity >= 0 && computedOpacity <= 1) controlsStyle.computedOpacity = computedOpacity;
    const clickThrough = idleClickThrough();
    controlsStyle.idleClickThrough = clickThrough;
    const position = computedControls.getPropertyValue('position');
    controlsStyle.computedPosition = ['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(position) ? position : 'other';
    for (const [name, value] of [
      ['computedWidth', parseFloat(computedControls.getPropertyValue('width'))],
      ['minWidth', parseFloat(computedControls.getPropertyValue('min-width'))],
      ['inlineWidth', parseFloat(controls.style.getPropertyValue('width'))],
      ['computedTop', parseFloat(computedControls.getPropertyValue('top'))],
      ['computedBottom', parseFloat(computedControls.getPropertyValue('bottom'))],
      ['inlineTop', parseFloat(controls.style.getPropertyValue('top'))],
      ['inlineBottom', parseFloat(controls.style.getPropertyValue('bottom'))],
    ]) {
      if (Number.isFinite(value) && Math.abs(value) <= 1000000) controlsStyle[name] = value;
    }
    const transform = computedControls.getPropertyValue('transform');
    const matrix = transform.match(/^matrix(3d)?\(([^)]+)\)$/);
    let translation;
    if (transform === 'none') translation = [0, 0];
    else if (matrix) {
      const numbers = matrix[2].split(',').map(Number);
      if (numbers.length === (matrix[1] ? 16 : 6) && numbers.every(Number.isFinite)) {
        translation = matrix[1] ? [numbers[12], numbers[13]] : [numbers[4], numbers[5]];
      }
    }
    if (translation && translation.every(value => Math.abs(value) <= 1000000)) {
      controlsStyle.transformX = translation[0]; controlsStyle.transformY = translation[1];
    }
    // Do not publish DOMRects, properties, attributes, text, URLs or non-finite
    // values. Diagnostics never alter the layout acceptance checks.
    const validGeometry = [geometry.stage, geometry.video, geometry.controls].every(rect =>
      Object.values(rect).every(value => Number.isFinite(value) && Math.abs(value) <= 1000000) &&
      rect.width >= 0 && rect.height >= 0);
    if (validGeometry) globalThis[geometryKey] = { ...geometry, controlsStyle };
    else delete globalThis[geometryKey];
    if (controlsRepairs > 3 && !controlsMatch()) return 'layout';
    const near = (a, b) => Math.abs(a - b) <= 1;
    const containedPicture = inside(stageRect, available) && inside(videoRect, available) &&
      near(stageRect.x, left) && near(stageRect.y, top) && near(stageRect.width, videoWidth) && near(stageRect.height, videoHeight) &&
      near(videoRect.x, left) && near(videoRect.y, top) && near(videoRect.width, videoWidth) && near(videoRect.height, videoHeight);
    const boundedOverlay = !nativeVisible || (inside(nativeControlsRect, available) &&
      near(nativeControlsRect.x, 0) && near(nativeControlsRect.y, height - controlsHeight) &&
      near(nativeControlsRect.width, available) && near(nativeControlsRect.height, controlsHeight));
    const idleTransparent = controlsShown || (computedOpacity === 0 &&
      computedControls.getPropertyValue('pointer-events') === 'none' && clickThrough);
    if (!containedPicture || !boundedOverlay || !idleTransparent) return 'layout';
    if (prefs.chatVisible) {
      const chatRect = chat.getBoundingClientRect();
      if (!inside(chatRect) || chatRect.left < available - 1 ||
          !inside(list.getBoundingClientRect()) || !inside(input.getBoundingClientRect()) ||
          !inside(inputBranch.getBoundingClientRect()) || inputBranch.scrollWidth > inputBranch.clientWidth + 1) return 'chat-layout';
    }
    return narrowControls || !nativeVisible ? 'controls-need-zoom' : null;
  };
  function applyLayout() {
    const reason = layout();
    if (reason && reason !== 'controls-need-zoom') {
      dispose('unsupported', reason);
      return globalThis[resultKey];
    }
    return publish('applied', reason || undefined);
  }
  function onResize() {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed || globalThis[key] !== state) return;
      try { applyLayout(); } catch { dispose('failed', 'layout-error'); }
    });
  }
  try {
    document.head.appendChild(style);
    globalThis[key] = state;
    const result = applyLayout();
    if (disposed) return result;
    observer = new MutationObserver(records => {
      if (disposed || globalThis[key] !== state) return;
      if (tracked.some(node => !node.isConnected) || !chat.contains(list) || !chat.contains(input) ||
          (records.some(record => pathParents.has(record.target)) &&
           Array.from(originalPaths).some(([node, original]) => path(node) !== original))) {
        dispose('unsupported', 'structure-changed');
        return;
      }
      if (records.some(record => record.target === controls && record.type === 'attributes') && !controlsMatch()) {
        controlsRepairs++;
        onResize();
      }
      if (records.some(record => controls.contains(record.target))) {
        // Paint has its own finite budget, independent of normal user activity.
        // Native display/visibility hiding is allowed and is never fought here.
        if (nativeBarVisible() && !visibilityMatches()) {
          if (++visibilityRepairs > 3) { dispose('unsupported', 'layout'); return; }
          setControlsShown(controlsShown);
        }
        updateActivityDiagnostic();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    observer.observe(controls, { attributes: true, childList: true, subtree: true,
      attributeFilter: ['style', 'class', 'aria-expanded', 'aria-hidden', 'hidden'] });
    window.addEventListener('resize', onResize);
    window.addEventListener('pagehide', onPageHide);
    video.addEventListener('resize', onResize);
    listen(window, 'pointermove', onPointerMove, { passive: true });
    listen(window, 'pointerdown', onPointerDown, true);
    listen(window, 'pointerup', onPointerUp, true);
    listen(window, 'pointercancel', onPointerUp, true);
    listen(window, 'focusin', onFocusIn, true);
    listen(window, 'focusout', onFocusOut, true);
    listen(window, 'keydown', onKeyDown, true);
    listen(window, 'blur', onBlur);
    listen(controls, 'pointerenter', onControlsEnter);
    listen(controls, 'pointerleave', onControlsLeave);
    listen(player, 'pointerleave', onPlayerLeave);
    if (hasControlFocus()) reveal();
    return result;
  } catch {
    dispose('failed', 'layout-error');
    return publish('failed', 'layout-error');
  }
}

module.exports.build = function build(prefs) {
  const valid = prefs && typeof prefs.compact === 'boolean' && typeof prefs.chatVisible === 'boolean' &&
    Number.isFinite(prefs.chatWidthDip) && prefs.chatWidthDip >= 140 && prefs.chatWidthDip <= 500;
  const safe = valid ? { compact: prefs.compact, chatVisible: prefs.chatVisible, chatWidthDip: prefs.chatWidthDip } : null;
  return '(' + present.toString() + ')(' + JSON.stringify(safe) + ')';
};
