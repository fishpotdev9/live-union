import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, roomConfig } from './fakes.ts';
import { nativeGeometry } from '../../../src/main/views/geometry.ts';
import type { RoomGeometry } from '../../../src/shared/contracts.ts';
import type { FakeView } from './fakes.ts';

function fixtureGeometry(ids:readonly string[]):Record<string,RoomGeometry> {
  return Object.fromEntries(ids.map((id,index)=>[id,{outer:{x:index*310,y:0,width:300,height:220},content:{x:index*310+1,y:36,width:298,height:176},z:index}]));
}
function nativeCalls(views:readonly FakeView[]){return views.map(view=>({...view.nativeCalls}));}

test('one through nine rooms retain contents/navigation/audio through layout, focus and z-order changes',async()=>{
  const h=harness();
  for(let i=0;i<9;i++)await h.manager.createRoom(roomConfig(String(i),i%2?'bilibili':'huya',i===0));
  const identities=Array.from({length:9},(_,i)=>h.manager.getRuntimeIdentity(String(i)));
  const pages=Array.from({length:9},(_,i)=>h.contents(String(i)));
  for(const page of pages){assert.ok(page.audioCalls[0]);assert.equal(page.muted,true);assert.equal(page.loads.length,1);page.ready();}
  assert.equal(pages[0].muted,false);
  const beforeAudio=pages.map(page=>page.audioCalls.length);
  const beforeNavigation=h.events.filter(event=>event.kind==='navigation').length;
  for(let revision=0;revision<60;revision++) {
    const geometries=Object.fromEntries(pages.map((_page,i)=>[String(i),{outer:{x:i*100.25,y:revision,width:300.5,height:200.5},content:{x:i*100.25+1,y:revision+36,width:298.5,height:156.5},z:8-i}]));
    h.manager.applyBoundsBatch(geometries,revision);
    h.manager.setZOrder(pages.map((_page,i)=>String(i)).reverse());
    pages[revision%9].emit('focus');
  }
  assert.deepEqual(pages.map(page=>page.audioCalls.length),beforeAudio);
  assert.equal(h.events.filter(event=>event.kind==='navigation').length,beforeNavigation);
  assert.deepEqual(pages.map(page=>page.loads.length),Array(9).fill(1));
  assert.deepEqual(pages.map((_page,i)=>h.manager.getRuntimeIdentity(String(i))),identities);
  assert.equal(h.views[1].bounds.y,36); // content canvas coordinate was made group-local.
  const lastBounds={...h.views[1].bounds};
  h.manager.applyBoundsBatch({'0':{outer:{x:0,y:0,width:1,height:1},content:{x:0,y:0,width:1,height:1},z:0}},20);
  assert.deepEqual(h.views[1].bounds,lastBounds);
  h.manager.dispose();assert.equal(h.registered.size,0);assert.ok(h.views.every(view=>view.webContents.destroyed));
});

test('geometry rounds shared DIP boundaries and canvas offset once',()=>{
  const result=nativeGeometry({outer:{x:10.2,y:20.2,width:300.6,height:200.6},content:{x:11.2,y:56.2,width:298.6,height:156.6},z:0},{x:0.3,y:128.3});
  assert.deepEqual(result,{group:{x:11,y:149,width:300,height:200},chrome:{x:0,y:0,width:300,height:200},page:{x:1,y:36,width:298,height:156}});
  assert.equal(nativeGeometry({outer:{x:NaN,y:0,width:10,height:10},content:{x:0,y:0,width:10,height:10},z:0},{x:0,y:0}),undefined);
  assert.equal(nativeGeometry({outer:{x:1e30,y:0,width:10,height:10},content:{x:0,y:0,width:10,height:10},z:0},{x:0,y:0}),undefined);
});

test('reload and crash stay local; same-document navigation is not a document reload',async()=>{
  const h=harness();await h.manager.createRoom(roomConfig('a','huya',true));await h.manager.createRoom(roomConfig('b'));
  const a=h.contents('a'),b=h.contents('b');a.ready();b.ready();
  const identity=h.manager.getRuntimeIdentity('a');
  a.emit('did-start-navigation',{isMainFrame:true,isSameDocument:true});
  h.manager.reloadRoom('a');assert.equal(a.reloads,1);assert.equal(b.reloads,0);assert.equal(a.muted,true);
  a.ready();assert.equal(a.muted,false);assert.deepEqual(h.manager.getRuntimeIdentity('a'),identity);
  a.emit('render-process-gone',{},{});assert.equal(a.muted,true);assert.equal(b.loads.length,1);
  a.emit('did-fail-load',{},-105,'sensitive platform text','https://sensitive.example/?secret=1',true);
  assert.ok(h.events.some(event=>event.kind==='navigation'&&event.state==='error'&&event.errorCode===-105));
  assert.ok(!JSON.stringify(h.events).includes('sensitive'));
  h.manager.dispose();
});

test('close and generation replacement ignore captured late audio/media/navigation callbacks',async()=>{
  const h=harness();const first=await h.manager.createRoom(roomConfig('a'));
  const a=h.contents('a');
  const stale=['audio-state-changed','media-started-playing','media-paused','did-finish-load','did-start-navigation'].flatMap(name=>a.listeners(name));
  h.manager.closeRoom('a');assert.equal(a.destroyed,true);assert.equal(a.eventNames().length,0);assert.equal(h.registered.size,0);
  const count=h.events.length;
  for(const callback of stale)assert.doesNotThrow(()=>callback({isMainFrame:true,isSameDocument:false}));
  assert.equal(h.events.length,count);
  const second=await h.manager.createRoom(roomConfig('a'));assert.equal(second.generation,first.generation+1);assert.notEqual(second.webContentsId,first.webContentsId);
  const before=h.events.length;for(const callback of stale)callback({isMainFrame:true,isSameDocument:false});assert.equal(h.events.length,before);
  const returned=h.manager.getRuntimeIdentity('a')!;returned.generation=999;assert.equal(h.manager.getRuntimeIdentity('a')?.generation,second.generation);
  h.manager.dispose();h.manager.dispose();assert.equal(h.manager.getContents('a'),undefined);
  await assert.rejects(h.manager.createRoom(roomConfig('b')),/disposed/);
});

test('a mute API exception during close cannot skip closing native contents',async()=>{
  const h=harness();await h.manager.createRoom(roomConfig('a'));const a=h.contents('a');
  a.setAudioMuted=()=>{throw new Error('native mute failed');};
  assert.doesNotThrow(()=>h.manager.closeRoom('a'));assert.equal(a.destroyed,true);assert.equal(h.registered.size,0);
  h.manager.dispose();
});

test('identical geometry at a newer revision performs no native bounds, visibility or order calls',async t=>{
  const h=harness();t.after(()=>h.manager.dispose());
  await h.manager.createRoom(roomConfig('a'));await h.manager.createRoom(roomConfig('b'));
  const geometry=fixtureGeometry(['a','b']);h.manager.applyBoundsBatch(geometry,1);
  h.contents('a').ready();h.contents('b').ready();
  const allViews=[h.window.contentView,...h.groups,...h.views];const before=nativeCalls(allViews);
  h.manager.applyAudio({kind:'set',roomId:'a',allowed:true});h.contents('b').emit('focus');
  const audio=h.views.map(view=>view.webContents.audioCalls.length);
  const identities=['a','b'].map(id=>h.manager.getRuntimeIdentity(id));
  const navigation=h.events.filter(event=>event.kind==='navigation').length;
  h.manager.applyBoundsBatch(structuredClone(geometry),2);h.manager.setZOrder(['a','b']);
  assert.deepEqual(nativeCalls(allViews),before,'unchanged layout and order must not touch native views after a control state update');
  assert.deepEqual(h.views.map(view=>view.webContents.audioCalls.length),audio);
  assert.equal(h.events.filter(event=>event.kind==='navigation').length,navigation);
  assert.deepEqual(['a','b'].map(id=>h.manager.getRuntimeIdentity(id)),identities);
  assert.deepEqual([...h.manager.getAudioAllowed()],[['a',true],['b',false]]);
});

test('moving and resizing one room update only the native rectangles that actually changed',async t=>{
  const h=harness();t.after(()=>h.manager.dispose());
  for(const id of ['a','b','c'])await h.manager.createRoom(roomConfig(id));
  const geometry=fixtureGeometry(['a','b','c']);h.manager.applyBoundsBatch(geometry,1);
  const untouched=[h.groups[1],h.groups[2],...h.views.slice(2)];const stable=nativeCalls(untouched);
  const chrome=h.views[0],page=h.views[1],group=h.groups[0];
  const localBefore=nativeCalls([chrome,page]);const groupBefore={...group.nativeCalls};const orderBefore=h.window.contentView.nativeCalls.addChildView;
  geometry.a.outer.x+=50;geometry.a.content.x+=50;h.manager.applyBoundsBatch(structuredClone(geometry),2);
  assert.deepEqual(nativeCalls(untouched),stable,'moving A must not set bounds or visibility on B/C');
  assert.equal(group.nativeCalls.setBounds,groupBefore.setBounds+1);assert.equal(group.nativeCalls.setVisible,groupBefore.setVisible);
  assert.deepEqual(nativeCalls([chrome,page]),localBefore,'moving an intact room must not relayout its group-local children');
  assert.equal(group.bounds.x,50);assert.equal(h.window.contentView.nativeCalls.addChildView,orderBefore);
  const resizeBefore=nativeCalls([group,chrome,page]);
  geometry.a.outer.width+=40;geometry.a.content.width+=40;h.manager.applyBoundsBatch(structuredClone(geometry),3);
  assert.deepEqual(nativeCalls(untouched),stable,'resizing A must not touch native views of B/C');
  for(const [index,view] of [group,chrome,page].entries()){
    assert.equal(view.nativeCalls.setBounds,resizeBefore[index].setBounds+1);
    assert.equal(view.nativeCalls.setVisible,resizeBefore[index].setVisible);
  }
  assert.equal(group.bounds.width,340);assert.equal(chrome.bounds.width,340);assert.equal(page.bounds.width,338);
  assert.equal(h.window.contentView.nativeCalls.addChildView,orderBefore);
  assert.ok(h.views.every(view=>view.webContents.loads.length===1&&view.webContents.reloads===0));
});

test('unchanged z-order skips native reparenting while changed z preserves actual group ordering',async t=>{
  const h=harness();t.after(()=>h.manager.dispose());
  for(const id of ['a','b','c'])await h.manager.createRoom(roomConfig(id));
  const geometry=fixtureGeometry(['a','b','c']);h.manager.applyBoundsBatch(geometry,1);
  const parent=h.window.contentView;assert.deepEqual(parent.children,h.groups);
  const first=parent.nativeCalls.addChildView;const bounds=nativeCalls([...h.groups,...h.views]);
  h.manager.setZOrder(['a','b','c']);h.manager.applyBoundsBatch(structuredClone(geometry),2);
  assert.equal(parent.nativeCalls.addChildView,first);
  geometry.a.z=2;geometry.b.z=0;geometry.c.z=1;h.manager.applyBoundsBatch(structuredClone(geometry),3);
  assert.deepEqual(parent.children,[h.groups[1],h.groups[2],h.groups[0]]);
  assert.ok(parent.nativeCalls.addChildView>first,'changed order must reach the native parent');
  assert.deepEqual(nativeCalls([...h.groups,...h.views]),bounds,'z-only changes must not set bounds or visibility');
  const changed=parent.nativeCalls.addChildView;
  h.manager.setZOrder(['b','c','a']);h.manager.applyBoundsBatch(structuredClone(geometry),4);
  assert.equal(parent.nativeCalls.addChildView,changed);
  assert.ok(h.views.every(view=>view.webContents.loads.length===1&&view.webContents.reloads===0));
});

test('closing and recreating a room cannot reuse the old instance geometry or order cache',async t=>{
  const h=harness();t.after(()=>h.manager.dispose());
  const first=await h.manager.createRoom(roomConfig('a'));await h.manager.createRoom(roomConfig('b'));
  const geometry=fixtureGeometry(['a','b']);h.manager.applyBoundsBatch(geometry,1);
  const old=h.groups[0];h.manager.closeRoom('a');const next=await h.manager.createRoom(roomConfig('a'));
  const group=h.groups[2],chrome=h.views[4],page=h.views[5];
  assert.notEqual(next.webContentsId,first.webContentsId);assert.ok(next.generation>first.generation);
  assert.equal(group.visible,false);assert.equal(group.nativeCalls.setBounds,0);
  const bBefore=nativeCalls([h.groups[1],h.views[2],h.views[3]]);
  h.manager.applyBoundsBatch(structuredClone(geometry),2);
  assert.equal(group.nativeCalls.setBounds,1);assert.equal(chrome.nativeCalls.setBounds,1);assert.equal(page.nativeCalls.setBounds,1);
  assert.deepEqual(group.bounds,{x:0,y:128,width:300,height:220});assert.equal(group.visible,true);
  assert.equal(group.nativeCalls.setVisible,2,'the fresh instance must be shown after its initial hidden state');
  assert.deepEqual(h.window.contentView.children,[group,h.groups[1]]);assert.ok(!h.window.contentView.children.includes(old));
  assert.deepEqual(nativeCalls([h.groups[1],h.views[2],h.views[3]]),bBefore);
  const after=nativeCalls([h.window.contentView,group,chrome,page]);h.manager.applyBoundsBatch(structuredClone(geometry),3);
  assert.deepEqual(nativeCalls([h.window.contentView,group,chrome,page]),after);
  assert.equal(h.contents('b').loads.length,1);assert.equal(h.contents('a').muted,true);
});
