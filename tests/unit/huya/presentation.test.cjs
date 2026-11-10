'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { build } = require('../../../src/platforms/huya/presentation.cjs');
const { fixture } = require('./fixture.cjs');
const prefs = { compact: true, chatVisible: false, chatWidthDip: 340 };
const run = (context, options = {}) => vm.runInContext(build({ ...prefs, ...options }), context);
// Read the actual VM global, as the production inspector does. Symbol globals
// are not consistently mirrored on Node's external context wrapper.
const observed = context => vm.runInContext('globalThis[Symbol.for("live-union.presentation.result")]', context);
const geometry = context => vm.runInContext('globalThis[Symbol.for("live-union.huya.geometry")]', context);
const installed = context => vm.runInContext('globalThis[Symbol.for("live-union.huya.presentation.v1")]', context);

test('same-version updates retain identified hidden controls and a single resource set', () => {
  const f = fixture(1094, 470), context = vm.createContext(f.env);
  run(context); const current=installed(context), style=f.styles()[0];
  f.nodes.controls.style.setProperty('display','none');f.nodes.gift.style.setProperty('display','none');
  f.mutate(f.nodes.controls,'attributes');
  for(let i=0;i<30;i++){
    f.resize(i%2?742:1094,i%2?370:470);f.flush();
    assert.equal(run(context).status,'applied');assert.equal(installed(context),current);assert.equal(f.styles()[0],style);
  }
  assert.equal(f.observers.filter(o=>o.connected).length,1);assert.equal(f.listeners.size,10);
  assert.equal(f.nodes.controls.style.getPropertyValue('display'),'none');
  run(context,{compact:false});assert.equal(f.styles().length,0);assert.equal(f.listeners.size,0);
});

test('chat updates reuse native nodes and reveal the previously hidden sender before postchecks', () => {
  const f=fixture(1094,470),context=vm.createContext(f.env),parent=f.nodes.input.parentElement;
  run(context);const current=installed(context);
  for(const chatWidthDip of [340,380,440]){
    assert.equal(run(context,{chatVisible:true,chatWidthDip}).status,'applied');
    assert.equal(installed(context),current);assert.equal(f.nodes.input.parentElement,parent);
    assert.equal(f.properties(f.nodes.chat).width,chatWidthDip+'px');
    assert.equal(run(context,{chatVisible:false,chatWidthDip}).status,'applied');
  }
  assert.equal(run(context,{chatVisible:true,chatWidthDip:240}).reason,'chat-too-narrow');
  assert.equal(f.styles().length,0);
});

test('an initially zero-height sender is measured after revealing native chat and still rejects real zero geometry', () => {
  for(const remainsZero of [false,true]){
    const f=fixture(1094,470),context=vm.createContext(f.env);
    f.nodes.input.base.height=0;f.nodes.sender.base.height=0;
    assert.equal(run(context).status,'applied');
    if(remainsZero){
      for(const node of [f.nodes.input,f.nodes.sender])node.getBoundingClientRect=()=>({x:0,y:0,width:0,height:0,right:0,bottom:0});
    }
    const result=run(context,{chatVisible:true});
    assert.equal(result.status,remainsZero?'unsupported':'applied');
    if(remainsZero){assert.equal(result.reason,'chat-layout');assert.equal(f.styles().length,0);}
  }
});

test('repeated updates cannot reset exhausted repair budget or keep replaced native targets', () => {
  const f=fixture(742,370),context=vm.createContext(f.env),controls=f.nodes.controls;run(context);
  for(let i=0;i<3;i++){controls.style.setProperty('width','900px','important');f.mutate(controls,'attributes');f.flush();assert.equal(run(context).status,'applied');}
  controls.style.setProperty('width','901px','important');f.mutate(controls,'attributes');f.flush();
  assert.equal(observed(context).status,'unsupported');assert.equal(observed(context).reason,'layout');
  for(const mutate of [
    x=>{x.nodes.video.remove();},
    x=>{const extra=new x.Element();extra.base={x:0,y:0,width:200,height:40,right:200,bottom:40};x.nodes.parent.appendChild(extra);},
    x=>{x.nodes.stage.appendChild(new x.Element('video'));}
  ]){const x=fixture(),c=vm.createContext(x.env);run(c);mutate(x);assert.equal(run(c).reason,'structure-changed');assert.equal(x.styles().length,0);}
});

test('version replacement cancels old callbacks while same-version update preserves activity', () => {
  const f=fixture(),context=vm.createContext(f.env);run(context);
  f.emit('pointermove',{clientX:300,clientY:100});const old=installed(context),timer=[...f.timers.values()][0].callback;
  run(context);assert.equal(installed(context),old);assert.equal(f.nodes.controls.style.getPropertyValue('opacity'),'1');
  old.version='obsolete';run(context);const current=installed(context);assert.notEqual(current,old);
  const before=observed(context);timer();old.update(prefs);
  assert.equal(installed(context),current);assert.equal(observed(context),before);
  run(context,{compact:false});assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);
});

test('generated script is deterministic, whitelists preferences and rejects malformed input', () => {
  for (const compact of [false, true]) for (const chatVisible of [false, true]) for (const chatWidthDip of [140, 240, 320, 340, 500]) {
    const value = { compact, chatVisible, chatWidthDip };
    new vm.Script(build(value));
    assert.equal(build(value), build({ ...value, arbitrary: 'not serialized' }));
  }
  for (const bad of [null, {}, { ...prefs, chatWidthDip: NaN }, { ...prefs, chatWidthDip: '340);throw 1;' },
    { ...prefs, chatWidthDip: 139 }, { ...prefs, chatWidthDip: 501 }]) {
    const context = vm.createContext({});
    assert.equal(vm.runInContext(build(bad), context).reason, 'invalid-preferences');
    assert.equal(observed(context).status, 'unsupported');
  }
});

test('220px and 180px rooms generate complete contain geometry and retain the native control tree', () => {
  for (const [width, height] of [[220, 140], [220, 180], [180, 120], [742, 370], [1000, 700]]) {
    const f = fixture(width, height, 3);
    const context = vm.createContext(f.env);
    const references = [...f.nodes.parent.children];
    const result = run(context);
    assert.equal(result.status, 'applied');
    assert.equal(result.reason, width < 850 ? 'controls-need-zoom' : undefined);
    const stage = f.properties(f.nodes.stage);
    const stageWidth = parseFloat(stage.width), stageHeight = parseFloat(stage.height);
    assert.ok(Math.abs(stageWidth / stageHeight - 16 / 9) < 1e-9);
    assert.ok(stageWidth <= width + 0.001 && stageHeight <= height + 0.001);
    assert.ok(Math.abs(stageWidth - Math.min(width, height * 16 / 9)) < 0.001);
    assert.ok(parseFloat(stage.left) >= 0 && parseFloat(stage.top) >= 0);
    assert.equal(f.properties(f.nodes.video)['object-fit'], 'contain');
    assert.equal(f.properties(f.nodes.gift).display, 'none');
    assert.notEqual(f.properties(f.nodes.controls).display, 'none');
    if (width < 850) assert.equal(f.properties(f.nodes.controls)['overflow-x'], 'auto');
    else assert.equal(f.properties(f.nodes.controls).overflow, 'visible');
    assert.deepEqual(f.nodes.parent.children, references);
    assert.equal(f.nodes.controls.children.length, 9);
    run(context, { compact: false });
    assert.equal(f.styles().length, 0);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.nodes.video.events.size, 0);
    assert.ok(f.observers.every(observer => !observer.connected));
  }
});

test('intrinsic non-16:9 video is contained without changing media properties', () => {
  const f = fixture(220, 180);
  f.nodes.video.videoWidth = 1440;
  const context = vm.createContext(f.env);
  assert.equal(run(context).status, 'applied');
  const stage = f.properties(f.nodes.stage);
  assert.ok(Math.abs(parseFloat(stage.width) / parseFloat(stage.height) - 4 / 3) < 1e-9);
  assert.equal(f.nodes.video.videoWidth, 1440);
  assert.equal(f.nodes.video.videoHeight, 1080);
});

test('gift recognition tolerates inert peers and different child counts without hiding other branches', () => {
  const f = fixture(742, 370, 7);
  f.nodes.controls.children.at(-1).remove();
  f.nodes.gift.children.at(-1).remove();
  const context = vm.createContext(f.env);
  assert.equal(run(context).status, 'applied');
  assert.equal(f.properties(f.nodes.gift).display, 'none');
  assert.notEqual(f.properties(f.nodes.controls).display, 'none');
  assert.equal(f.nodes.controls.children.length, 8);
  for (const branch of f.nodes.parent.children) if (branch !== f.nodes.gift) {
    assert.notEqual(f.properties(branch).display, 'none');
  }
});

test('chat preference is never silently narrowed or closed to pass a small room', () => {
  const f = fixture();
  const context = vm.createContext(f.env);
  assert.equal(run(context, { chatVisible: true }).status, 'applied');
  assert.equal(f.properties(f.nodes.chat).display, 'flex');
  assert.equal(parseFloat(f.properties(f.nodes.chat).width), 340);
  assert.equal(run(context, { chatVisible: true, chatWidthDip: 240 }).reason, 'chat-too-narrow');
  assert.equal(f.styles().length, 0);
  f.env.window.innerWidth = 450;
  assert.equal(run(context, { chatVisible: true }).reason, 'space');
  assert.equal(f.styles().length, 0);
});

test('a packed secondary frame retains native chat and a complete narrow game preview',()=>{
  const f=fixture(524,272),context=vm.createContext(f.env),input=f.nodes.input;
  assert.equal(run(context,{chatVisible:true}).status,'applied');
  assert.equal(f.properties(f.nodes.chat).width,'340px');
  assert.equal(f.properties(f.nodes.video)['object-fit'],'contain');
  assert.equal(geometry(context).controls.width,184);
  assert.equal(f.nodes.input,input);run(context,{compact:false});
  assert.equal(f.styles().length,0);
});

test('ambiguous gift peer or missing native input safely leaves the page unchanged', () => {
  const f = fixture();
  const peer = new f.Element(); peer.base = { ...f.nodes.gift.base };
  peer.appendChild(new f.Element()); peer.appendChild(new f.Element());
  f.nodes.parent.appendChild(peer);
  const context = vm.createContext(f.env);
  assert.equal(run(context).reason, 'player-structure');
  assert.equal(f.styles().length, 0);
  peer.remove(); f.nodes.input.remove();
  assert.equal(run(context).reason, 'structure');
  assert.equal(f.styles().length, 0);
});

test('resize failure revokes styles and changes the shared result from applied to unsupported', () => {
  const f = fixture(220, 180);
  const context = vm.createContext(f.env);
  assert.equal(run(context).status, 'applied');
  f.resize(220, 100); f.resize(220, 90);
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.equal(observed(context).status, 'unsupported');
  assert.equal(observed(context).reason, 'space');
  assert.equal(geometry(context), undefined);
  assert.equal(f.styles().length, 0);
  assert.equal(f.listeners.size, 0);
  assert.ok(f.observers.every(observer => !observer.connected));
});

test('structure path changes restore the page; ordinary list changes do not reapply or read messages', () => {
  const f = fixture();
  const context = vm.createContext(f.env);
  run(context);
  const style = f.styles()[0];
  f.nodes.list.appendChild(new f.Element()); f.mutate(f.nodes.list);
  assert.equal(f.styles()[0], style);
  assert.equal(observed(context).status, 'applied');
  const inserted = new f.Element(); inserted.parentElement = f.nodes.parent;
  f.nodes.parent.children.unshift(inserted); f.mutate(f.nodes.parent);
  assert.equal(observed(context).status, 'unsupported');
  assert.equal(observed(context).reason, 'structure-changed');
  assert.equal(f.styles().length, 0);
});

test('repeated apply/restore and stale callbacks cannot leak listeners or overwrite new diagnostics', () => {
  const f = fixture();
  const context = vm.createContext(f.env);
  run(context); const oldResize = f.listeners.get('resize'); const oldObserver = f.observers[0];
  run(context); assert.equal(f.styles().length, 1);
  assert.equal(f.listeners.size, 10);
  assert.equal(f.observers.filter(observer => observer.connected).length, 1);
  oldResize(); oldObserver.callback([{ target: f.nodes.parent }]);
  assert.equal(observed(context).status, 'applied');
  run(context, { compact: false }); run(context, { compact: false });
  assert.equal(observed(context).status, 'restored');
  assert.equal(f.styles().length, 0); assert.equal(f.listeners.size, 0); assert.equal(f.frames.size, 0);
  run(context); f.listeners.get('pagehide')();
  assert.equal(observed(context).status, 'restored');
  assert.equal(observed(context).reason, 'page-hidden');
  assert.equal(f.styles().length, 0); assert.equal(f.listeners.size, 0);
});

test('invalid preferences revoke an older presentation instead of leaving stale applied diagnostics', () => {
  const f = fixture(); const context = vm.createContext(f.env);
  run(context);
  vm.runInContext(build({ ...prefs, chatWidthDip: Infinity }), context);
  assert.equal(observed(context).status, 'unsupported');
  assert.equal(observed(context).reason, 'invalid-preferences');
  assert.equal(f.styles().length, 0); assert.equal(f.listeners.size, 0);
});

test('observer installation failure rolls back all presentation resources', () => {
  const f = fixture();
  f.env.MutationObserver = class {
    observe() { throw new Error('observer unavailable'); }
    disconnect() {}
  };
  const context = vm.createContext(f.env);
  assert.equal(run(context).status, 'failed');
  assert.equal(observed(context).reason, 'layout-error');
  assert.equal(f.styles().length, 0); assert.equal(f.listeners.size, 0);
});

test('failed nine-room-size layout retains finite rectangles from before rollback', () => {
  const f = fixture(702, 272);
  // Simulate native position not following the new style. Preserve protection:
  // this model must still fail rather than accepting off-screen game content.
  f.nodes.video.getBoundingClientRect = () => ({ ...f.nodes.video.base });
  const context = vm.createContext(f.env);
  const result = run(context);
  assert.equal(result.status, 'unsupported'); assert.equal(result.reason, 'layout');
  assert.equal(f.styles().length, 0);
  const snapshot = JSON.parse(JSON.stringify(geometry(context)));
  assert.deepEqual(Object.keys(snapshot), ['viewport', 'stage', 'video', 'controls', 'controlsStyle']);
  assert.deepEqual(snapshot.viewport, { width: 702, height: 272 });
  assert.deepEqual(snapshot.video, { x: 90, y: 628, width: 850, height: 478 });
  for (const name of ['stage', 'video', 'controls']) {
    assert.deepEqual(Object.keys(snapshot[name]), ['x', 'y', 'width', 'height']);
    assert.ok(Object.values(snapshot[name]).every(Number.isFinite));
  }
  assert.ok(snapshot.stage.width < 702 && snapshot.stage.height <= 272.001);
  assert.equal(snapshot.controlsStyle.inlineImportant, true);
  assert.deepEqual(Object.keys(snapshot.controlsStyle).sort(), ['computedOpacity', 'computedPosition', 'computedTop', 'computedWidth',
    'idleClickThrough', 'inlineImportant', 'inlineTop', 'inlineWidth', 'minWidth', 'nativeVisible', 'overlay', 'shown', 'transformX', 'transformY']);
  for (const key of ['computedWidth', 'minWidth', 'inlineWidth']) assert.ok(Number.isFinite(snapshot.controlsStyle[key]));
  run(context, { compact: false }); assert.equal(geometry(context), undefined);
});

test('non-finite rectangle diagnostics are not serialized and do not weaken rejection', () => {
  const f = fixture(702, 272);
  f.nodes.video.getBoundingClientRect = () => ({ ...f.nodes.video.base, x: NaN, width: Infinity });
  const context = vm.createContext(f.env);
  assert.equal(run(context).status, 'unsupported');
  assert.equal(geometry(context), undefined);
  assert.equal(f.styles().length, 0);
});

test('a later structure failure cannot expose a stale earlier geometry snapshot', () => {
  const f = fixture(702, 272); const context = vm.createContext(f.env);
  assert.equal(run(context).status, 'applied'); assert.ok(geometry(context));
  f.nodes.gift.remove();
  assert.equal(run(context).reason, 'structure-changed');
  assert.equal(geometry(context), undefined);
  assert.equal(f.styles().length, 0);
});

test('consecutive presentations and focus/equal resizes neither grow native controls nor keep the old inline width', () => {
  const f = fixture(702, 272);
  const controls = f.nodes.controls;
  controls.base.height = 44.000003814697266;
  controls.style.setProperty('width', '703px', 'important');
  const context = vm.createContext(f.env);
  for (let index = 0; index < 30; index++) {
    assert.equal(run(context).status, 'applied');
    assert.equal(controls.style.getPropertyValue('height'), '44px');
    f.resize(376, 191); f.flush();
    assert.equal(observed(context).status, 'applied');
    assert.equal(geometry(context).controls.width, 376);
    f.resize(703, 272); f.flush();
    assert.equal(geometry(context).controls.width, 703);
    assert.equal(controls.style.getPropertyValue('height'), '44px');
    // Emulate the native SDK feeding a tiny DIP conversion error back into its
    // natural metrics before the next presentation.
    controls.base.height = parseFloat(controls.style.getPropertyValue('height')) + 0.000003814697266;
  }
  run(context, { compact: false });
  assert.equal(controls.style.getPropertyValue('width'), '703px');
  assert.equal(controls.style.getPropertyPriority('width'), 'important');
  for (const name of ['height', 'min-width', 'max-width', 'box-sizing']) assert.equal(controls.style.getPropertyValue(name), '');
});

test('bounded SDK style repair restores the latest native baseline and stops on repeated competition', () => {
  const f = fixture(376, 191); const context = vm.createContext(f.env); const controls = f.nodes.controls;
  assert.equal(run(context).status, 'applied');
  for (let index = 0; index < 3; index++) {
    controls.style.setProperty('width', '702px', 'important');
    f.mutate(controls, 'attributes'); f.flush();
    assert.equal(observed(context).status, 'applied');
    assert.equal(controls.style.getPropertyValue('width'), '376px');
  }
  controls.style.setProperty('width', '703px', 'important');
  f.mutate(controls, 'attributes'); f.flush();
  assert.equal(observed(context).status, 'unsupported'); assert.equal(observed(context).reason, 'layout');
  assert.equal(f.styles().length, 0); assert.equal(f.frames.size, 0);
  assert.equal(controls.style.getPropertyValue('width'), '703px');
  assert.ok(f.observers.every(observer => !observer.connected));
  assert.equal(geometry(context).controlsStyle.inlineWidth, 703);
});

test('native hover may rewrite redundant insets without exhausting geometry repairs', () => {
  const f = fixture(1094, 470), context = vm.createContext(f.env), controls = f.nodes.controls;
  assert.equal(run(context).status, 'applied');
  for (let index = 0; index < 100; index++) {
    f.emit('pointermove', { clientX: 300 + index, clientY: 160 });
    controls.style.setProperty('bottom', index % 2 ? '0px' : '60px');
    controls.style.setProperty('right', '0px');
    f.mutate(controls, 'attributes'); f.flush();
    assert.equal(observed(context).status, 'applied');
    assert.equal(geometry(context).controls.x, 0);
    assert.equal(geometry(context).controls.y, 426);
    assert.equal(geometry(context).controls.width, 1094);
  }
  f.advance(1601);
  assert.equal(controls.style.getPropertyValue('opacity'), '0');
  // A real geometry conflict still has the original finite repair budget.
  for (let index = 0; index < 4; index++) {
    controls.style.setProperty('width', '1200px', 'important');
    f.mutate(controls, 'attributes'); f.flush();
    assert.equal(observed(context).status, index < 3 ? 'applied' : 'unsupported');
  }
  assert.equal(observed(context).reason, 'layout');
  assert.equal(f.styles().length, 0);
});

test('repair geometry uses the existing final one-pixel boundary, including subpixel CSS layout', () => {
  for (const shift of [0.015625, 0.5, 1, 1.015625]) {
    const f = fixture(1094, 470), context = vm.createContext(f.env), controls = f.nodes.controls;
    const original = controls.getBoundingClientRect.bind(controls);
    controls.getBoundingClientRect = () => { const r=original(); return f.styles().length ? { ...r, x:r.x+shift, left:r.left+shift, right:r.right+shift } : r; };
    assert.equal(run(context).status, shift <= 1 ? 'applied' : 'unsupported');
    if (shift > 1) continue;
    for (let index = 0; index < 20; index++) {
      f.emit('pointermove', { clientX: 300, clientY: 160 });
      controls.style.setProperty('--native-progress', String(index));
      f.mutate(controls, 'attributes'); f.flush();
      assert.equal(observed(context).status, 'applied');
    }
    run(context, { compact:false });
    assert.equal(f.styles().length, 0);
  }
});

test('ignored native insets restore their latest values, while later real movement still rolls back', () => {
  for (const resized of [false, true]) {
    const f = fixture(1094, 470), context = vm.createContext(f.env), controls = f.nodes.controls;
    run(context);
    controls.style.setProperty('bottom', '60px'); controls.style.setProperty('right', '0px');
    f.mutate(controls, 'attributes'); f.flush();
    if (resized) { f.resize(742, 370); f.flush(); }
    assert.equal(observed(context).status, 'applied');
    run(context, { compact:false });
    assert.equal(controls.style.getPropertyValue('bottom'), '60px');
    assert.equal(controls.style.getPropertyValue('right'), '0px');
    assert.equal(controls.style.getPropertyPriority('bottom'), '');
    assert.equal(f.styles().length, 0); assert.equal(f.frames.size, 0); assert.equal(f.timers.size, 0);
  }
  const f = fixture(1094, 470), context = vm.createContext(f.env), controls = f.nodes.controls;
  run(context);
  const original = controls.getBoundingClientRect.bind(controls);
  controls.getBoundingClientRect = () => { const r=original(); return { ...r,x:r.x+2,left:r.left+2,right:r.right+2 }; };
  controls.style.setProperty('bottom','60px'); f.mutate(controls,'attributes'); f.flush();
  assert.equal(observed(context).status,'unsupported'); assert.equal(observed(context).reason,'layout');
  assert.equal(f.styles().length,0); assert.equal(f.listeners.size,0);
});

test('subpixel native height feedback does not consume repair budget or trigger a false layout failure', () => {
  const f = fixture(376, 191); const context = vm.createContext(f.env); const controls = f.nodes.controls;
  run(context);
  for (let index = 0; index < 20; index++) {
    controls.style.setProperty('height', '44.000003814697266px');
    controls.style.setProperty('width', '376px');
    f.mutate(controls, 'attributes');
    assert.equal(f.frames.size, 0);
    assert.equal(observed(context).status, 'applied');
  }
  run(context, { compact: false });
  assert.equal(controls.style.getPropertyValue('height'), '44.000003814697266px');
  assert.equal(controls.style.getPropertyValue('width'), '376px');
});

test('702x272 can attempt native chat using sender and list budgets, without changing the requested width', () => {
  const f = fixture(702, 272); const context = vm.createContext(f.env);
  assert.equal(run(context, { chatVisible: true }).status, 'applied');
  assert.equal(f.properties(f.nodes.chat).width, '340px');
  assert.equal(f.properties(f.nodes.chat).display, 'flex');
  run(context, { compact: false }); f.env.window.innerHeight = 170;
  assert.equal(run(context, { chatVisible: true }).reason, 'space');
  assert.equal(f.styles().length, 0);
});

test('native important bottom offsets and transforms cannot place the bar over the game, and restore exactly', () => {
  const f = fixture(703, 272); const controls = f.nodes.controls;
  const originals = { position: 'absolute', left: '15px', right: '10px', top: 'auto', bottom: '60px',
    transform: 'matrix(1, 0, 0, 1, 0, -60)' };
  for (const [name, value] of Object.entries(originals)) controls.style.setProperty(name, value, 'important');
  const context = vm.createContext(f.env);
  assert.equal(run(context).status, 'applied');
  const snapshot = geometry(context);
  assert.equal(snapshot.controls.x, 0); assert.equal(snapshot.controls.y, 228);
  assert.equal(snapshot.controls.height, 44); assert.equal(snapshot.controls.width, 703);
  assert.equal(snapshot.video.height, 272);
  assert.equal(snapshot.controlsStyle.overlay, true);
  assert.equal(snapshot.controlsStyle.shown, false);
  assert.equal(controls.style.getPropertyValue('opacity'), '0');
  assert.equal(controls.style.getPropertyValue('pointer-events'), 'none');
  assert.equal(snapshot.controlsStyle.computedPosition, 'fixed');
  assert.equal(snapshot.controlsStyle.computedTop, 228); assert.equal(snapshot.controlsStyle.inlineTop, 228);
  assert.equal(snapshot.controlsStyle.transformX, 0); assert.equal(snapshot.controlsStyle.transformY, 0);
  f.resize(376, 191); f.flush();
  assert.equal(geometry(context).controls.y, 147);
  run(context, { compact: false });
  for (const [name, value] of Object.entries(originals)) {
    assert.equal(controls.style.getPropertyValue(name), value);
    assert.equal(controls.style.getPropertyPriority(name), 'important');
  }
});

test('late native placement changes use bounded repair and preserve the latest native restore baseline', () => {
  const f = fixture(702, 272); const controls = f.nodes.controls; const context = vm.createContext(f.env);
  run(context);
  controls.style.setProperty('top', '168px', 'important');
  controls.style.setProperty('transform', 'matrix(1, 0, 0, 1, 0, -60)', 'important');
  f.mutate(controls, 'attributes'); f.flush();
  assert.equal(observed(context).status, 'applied');
  assert.equal(geometry(context).controls.y, 228);
  run(context, { compact: false });
  assert.equal(controls.style.getPropertyValue('top'), '168px');
  assert.equal(controls.style.getPropertyValue('transform'), 'matrix(1, 0, 0, 1, 0, -60)');
});

test('an unresolved containing-block offset still fails the no-overlap guard despite correct control width and height', () => {
  const f = fixture(702, 272); const controls = f.nodes.controls;
  const nativeRect = controls.getBoundingClientRect.bind(controls);
  controls.getBoundingClientRect = () => {
    const rect = nativeRect();
    return f.styles().length ? { ...rect, y: rect.y - 60, top: rect.top - 60, bottom: rect.bottom - 60 } : rect;
  };
  const context = vm.createContext(f.env);
  assert.equal(run(context).status, 'unsupported'); assert.equal(observed(context).reason, 'layout');
  assert.equal(geometry(context).controls.width, 702); assert.equal(geometry(context).controls.height, 44);
  assert.equal(geometry(context).controls.y, 168); assert.equal(geometry(context).controlsStyle.computedTop, 228);
  assert.equal(f.styles().length, 0); assert.equal(controls.style.getPropertyValue('top'), '');
});

test('a stale 376px native control width under an 850px parent is not mistaken for an unknown component', () => {
  const f = fixture(702, 272); const context = vm.createContext(f.env);
  f.nodes.controls.base.width = 376;
  assert.equal(run(context).status, 'applied');
  assert.equal(geometry(context).controls.width, 702);
});

function hiddenBarsFixture() {
  const f = fixture(702, 272);
  const n = f.nodes;
  const siblings = Array.from({ length: 15 }, () => new f.Element());
  siblings[0] = n.stage; siblings[2] = n.controls; siblings[4] = n.gift;
  n.parent.children = siblings;
  for (const sibling of siblings) {
    sibling.parentElement = n.parent;
    if (sibling !== n.stage) sibling.style.setProperty('display', 'none', 'important');
  }
  for (let index = 0; index < 8; index++) n.stage.appendChild(new f.Element());
  return f;
}

test('only the confirmed all-hidden native bar structure is reversibly expanded and measured', () => {
  const f = hiddenBarsFixture(); const context = vm.createContext(f.env);
  assert.equal(run(context).status, 'applied');
  assert.equal(f.nodes.controls.style.getPropertyValue('display'), 'none');
  assert.equal(f.properties(f.nodes.gift).display, 'none');
  assert.equal(geometry(context).controlsStyle.nativeVisible, false);
  assert.equal(geometry(context).controls.width, 0);
  run(context, { compact: false });
  assert.equal(f.nodes.controls.style.getPropertyValue('display'), 'none');
  assert.equal(f.nodes.gift.style.getPropertyValue('display'), 'none');
  assert.equal(f.nodes.controls.style.getPropertyPriority('display'), 'important');
  const invalid = hiddenBarsFixture(); invalid.nodes.controls.children.at(-1).remove();
  const otherContext = vm.createContext(invalid.env);
  assert.equal(run(otherContext).reason, 'player-structure');
  assert.equal(invalid.nodes.controls.style.getPropertyValue('display'), 'none');
  assert.equal(invalid.styles().length, 0);
  const badMeasurement = hiddenBarsFixture(); badMeasurement.nodes.gift.base.height = 140;
  assert.equal(run(vm.createContext(badMeasurement.env)).reason, 'player-structure');
  assert.equal(badMeasurement.nodes.controls.style.getPropertyValue('display'), 'none');
  assert.equal(badMeasurement.nodes.gift.style.getPropertyValue('display'), 'none');
  assert.equal(badMeasurement.styles().length, 0);
});

test('idle controls are click-through, activity reveals them and native progress mutations cannot extend idle', () => {
  const f = fixture(702, 272); const context = vm.createContext(f.env); const controls = f.nodes.controls;
  run(context);
  assert.equal(controls.style.getPropertyValue('opacity'), '0');
  assert.equal(controls.style.getPropertyValue('pointer-events'), 'none');
  assert.ok(Math.abs(geometry(context).video.height - 272) < 0.001);
  f.emit('pointermove', { clientX: 300, clientY: 100 });
  assert.equal(controls.style.getPropertyValue('opacity'), '1');
  assert.equal(controls.style.getPropertyValue('pointer-events'), 'auto');
  const writes = f.styleWrites();
  for (let index = 0; index < 30; index++) f.emit('pointermove', { clientX: 300 + index, clientY: 100 });
  assert.equal(f.styleWrites(), writes);
  for (let index = 0; index < 6; index++) {
    f.advance(300);
    controls.children[0].style.setProperty('left', index + 'px');
    f.mutate(controls.children[0], 'attributes');
    controls.style.setProperty('--native-progress', String(index));
    f.mutate(controls, 'attributes');
  }
  assert.equal(controls.style.getPropertyValue('opacity'), '0');
  assert.equal(controls.style.getPropertyValue('pointer-events'), 'none');
  assert.equal(observed(context).status, 'applied');
  assert.equal(f.frames.size, 0);
});

test('bottom hover does not remain latched after the pointer leaves the whole room', () => {
  const f = fixture(702, 272); const context = vm.createContext(f.env); run(context);
  f.emit('pointermove', { clientX: 300, clientY: 270 });
  f.advance(5000);
  assert.equal(f.nodes.controls.style.getPropertyValue('opacity'), '1');
  f.nodes.player.events.get('pointerleave')();
  f.advance(1601);
  assert.equal(f.nodes.controls.style.getPropertyValue('opacity'), '0');
});

test('native hover, keyboard focus and slider drag keep the overlay available without consuming native events', () => {
  const f = fixture(702, 272); const context = vm.createContext(f.env); run(context);
  const controls = f.nodes.controls, button = controls.children[0];
  controls.events.get('pointerenter')(); f.advance(5000);
  assert.equal(controls.style.getPropertyValue('opacity'), '1');
  controls.events.get('pointerleave')(); f.advance(1601);
  assert.equal(controls.style.getPropertyValue('opacity'), '0');
  f.env.document.activeElement = button;
  f.emit('focusin', { target: button }); f.advance(5000);
  assert.equal(controls.style.getPropertyValue('opacity'), '1');
  f.emit('keydown', { target: button, key: 'ArrowRight', preventDefault() { throw Error('native key consumed'); } });
  f.env.document.activeElement = f.nodes.body; f.emit('focusout', { target: button }); f.advance(1601);
  assert.equal(controls.style.getPropertyValue('opacity'), '0');
  f.emit('pointerdown', { target: button, preventDefault() { throw Error('native click consumed'); } });
  f.nodes.player.events.get('pointerleave')(); f.advance(5000);
  assert.equal(controls.style.getPropertyValue('opacity'), '1');
  f.emit('pointerup'); f.advance(1601);
  assert.equal(controls.style.getPropertyValue('opacity'), '0');
});

test('visible semantic portals hold the overlay; closed, transparent and chat menus do not', () => {
  const f = fixture(702, 272); const context = vm.createContext(f.env); run(context);
  const menu = new f.Element(); menu.semanticRole = 'menu';
  menu.base = { x: 100, y: 80, width: 120, height: 140, left: 100, top: 80, right: 220, bottom: 220 };
  f.nodes.body.appendChild(menu);
  f.emit('pointermove', { clientX: 300, clientY: 100 }); f.advance(5000);
  assert.equal(f.nodes.controls.style.getPropertyValue('opacity'), '1');
  f.emit('pointerdown', { target: menu }); f.emit('pointerup', { target: menu }); f.advance(5000);
  assert.equal(f.nodes.controls.style.getPropertyValue('opacity'), '1');
  menu.ariaHidden = true; f.advance(1601);
  assert.equal(f.nodes.controls.style.getPropertyValue('opacity'), '0');
  menu.ariaHidden = false; menu.style.setProperty('opacity', '0');
  f.emit('pointermove', { clientX: 300, clientY: 100 }); f.advance(1601);
  assert.equal(f.nodes.controls.style.getPropertyValue('opacity'), '0');
  menu.style.removeProperty('opacity'); menu.remove(); f.nodes.chat.appendChild(menu);
  f.emit('pointermove', { clientX: 300, clientY: 100 }); f.advance(1601);
  assert.equal(f.nodes.controls.style.getPropertyValue('opacity'), '0');
  menu.remove(); const hiddenParent = f.nodes.body.appendChild(new f.Element());
  hiddenParent.style.setProperty('opacity', '0'); hiddenParent.appendChild(menu);
  f.emit('pointermove', { clientX: 300, clientY: 100 }); f.advance(1601);
  assert.equal(f.nodes.controls.style.getPropertyValue('opacity'), '0');
});

test('native display/visibility hiding never spends repair budget, fails layout or forces display', () => {
  const f = fixture(702, 272); const context = vm.createContext(f.env); run(context);
  const controls = f.nodes.controls;
  for (let index = 0; index < 10; index++) {
    controls.style.setProperty('display', 'none', 'important'); f.mutate(controls, 'attributes');
    assert.equal(f.frames.size, 0);
    f.resize(index % 2 ? 703 : 702, 272); f.flush();
    assert.equal(observed(context).status, 'applied');
    assert.equal(geometry(context).controlsStyle.nativeVisible, false);
    assert.equal(controls.style.getPropertyValue('display'), 'none');
  }
  controls.style.removeProperty('display'); controls.style.setProperty('visibility', 'hidden');
  f.mutate(controls, 'attributes');
  assert.equal(observed(context).status, 'applied');
});

test('restore removes all activity resources and restores native paint without a late idle callback', () => {
  const f = fixture(702, 272); const context = vm.createContext(f.env); const controls = f.nodes.controls;
  controls.style.setProperty('opacity', '0.8'); controls.style.setProperty('background-color', 'white', 'important');
  run(context); f.emit('pointermove', { clientX: 300, clientY: 100 });
  const staleTimer = [...f.timers.values()][0].callback;
  assert.equal(f.timers.size, 1);
  run(context, { compact: false }); run(context); staleTimer();
  assert.equal(controls.style.getPropertyValue('opacity'), '0');
  f.emit('pointermove', { clientX: 300, clientY: 100 });
  run(context, { compact: false });
  assert.equal(f.styles().length, 0); assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0);
  assert.equal(controls.events.size, 0); assert.equal(f.nodes.player.events.size, 0);
  assert.equal(controls.style.getPropertyValue('opacity'), '0.8');
  assert.equal(controls.style.getPropertyValue('background-color'), 'white');
  staleTimer(); f.advance(10000);
  assert.equal(observed(context).status, 'restored');
  assert.equal(controls.style.getPropertyValue('opacity'), '0.8');
});

test('native paint competition has a finite budget and cannot create a permanent mutation feedback loop', () => {
  const f = fixture(702, 272); const context = vm.createContext(f.env); const controls = f.nodes.controls;
  run(context);
  for (let index = 0; index < 3; index++) {
    controls.style.setProperty('opacity', '1', 'important'); f.mutate(controls, 'attributes');
    assert.equal(observed(context).status, 'applied');
    assert.equal(controls.style.getPropertyValue('opacity'), '0');
  }
  controls.style.setProperty('opacity', '1', 'important'); f.mutate(controls, 'attributes');
  assert.equal(observed(context).status, 'unsupported'); assert.equal(observed(context).reason, 'layout');
  assert.equal(f.styles().length, 0); assert.equal(f.listeners.size, 0); assert.equal(f.timers.size, 0);
  assert.equal(controls.events.size, 0); assert.ok(f.observers.every(observer => !observer.connected));
  assert.equal(controls.style.getPropertyValue('opacity'), '1');
});

test('ordinary activity and equal native opacity updates do not consume the paint competition budget', () => {
  const f = fixture(702, 272); const context = vm.createContext(f.env); const controls = f.nodes.controls;
  run(context);
  for (let index = 0; index < 20; index++) {
    f.emit('pointermove', { clientX: 300, clientY: 100 });
    controls.style.setProperty('opacity', '1'); f.mutate(controls, 'attributes');
    assert.equal(observed(context).status, 'applied');
  }
  f.advance(1601);
  assert.equal(controls.style.getPropertyValue('opacity'), '0');
  assert.equal(observed(context).status, 'applied');
});

test('only bar root transition/animation longhands are disabled before idle paint, with exact priority restoration', () => {
  const f = fixture(703, 272); const controls = f.nodes.controls; const button = controls.children[0];
  controls.style.setProperty('transition-property', 'opacity, background-color', 'important');
  controls.style.setProperty('transition-duration', '0.3s');
  controls.style.setProperty('animation-name', 'native-fade');
  controls.style.setProperty('animation-duration', '1s', 'important');
  button.style.setProperty('transition-property', 'opacity'); button.style.setProperty('animation-name', 'child-slider');
  const getComputed = f.env.window.getComputedStyle;
  // Model the interpolation mechanism independently reproduced by the root's
  // real hidden Chromium fixture. This VM is not itself browser evidence.
  f.env.window.getComputedStyle = node => {
    const base = getComputed(node);
    return { getPropertyValue(name) {
      if (node === controls && name === 'opacity' && controls.style.getPropertyValue('transition-property') !== 'none') return '0.5';
      return base.getPropertyValue(name);
    } };
  };
  const context = vm.createContext(f.env);
  assert.equal(run(context).status, 'applied');
  assert.equal(geometry(context).controlsStyle.computedOpacity, 0);
  assert.equal(geometry(context).controlsStyle.idleClickThrough, true);
  assert.equal(controls.style.getPropertyValue('transition-property'), 'none');
  assert.equal(controls.style.getPropertyValue('animation-name'), 'none');
  assert.equal(button.style.getPropertyValue('transition-property'), 'opacity');
  assert.equal(button.style.getPropertyValue('animation-name'), 'child-slider');
  f.emit('pointermove', { clientX: 200, clientY: 100 }); f.advance(1601);
  assert.equal(controls.style.getPropertyValue('opacity'), '0');
  run(context, { compact: false });
  for (const [name, value, priority] of [['transition-property', 'opacity, background-color', 'important'],
    ['transition-duration', '0.3s', ''], ['animation-name', 'native-fade', ''], ['animation-duration', '1s', 'important']]) {
    assert.equal(controls.style.getPropertyValue(name), value); assert.equal(controls.style.getPropertyPriority(name), priority);
  }
});

test('transparent idle paint is still rejected when an actual hit test reaches a native control', () => {
  const f = fixture(703, 272); const context = vm.createContext(f.env);
  f.env.document.elementFromPoint = () => f.nodes.controls.children[0];
  assert.equal(run(context).status, 'unsupported'); assert.equal(observed(context).reason, 'layout');
  assert.equal(geometry(context).controlsStyle.computedOpacity, 0);
  assert.equal(geometry(context).controlsStyle.idleClickThrough, false);
  assert.equal(f.styles().length, 0); assert.equal(f.listeners.size, 0);
});
