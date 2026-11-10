import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeContents, harness, roomConfig } from './fakes.ts';

function event(url:string,isMainFrame=true){return {url,isMainFrame,prevented:false,preventDefault(){this.prevented=true;}};}
test('session isolation, remote preferences, denied permissions/downloads and frame navigation',async()=>{
  const h=harness();await h.manager.createRoom(roomConfig('a'));await h.manager.createRoom(roomConfig('b'));await h.manager.createRoom(roomConfig('c','douyu'));
  const a=h.contents('a'),b=h.contents('b'),c=h.contents('c');
  assert.equal(a.session,b.session);assert.notEqual(a.session,c.session);
  assert.equal(a.preferences.preload,undefined);assert.equal(a.preferences.sandbox,true);assert.equal(a.preferences.contextIsolation,true);assert.equal(a.preferences.nodeIntegration,false);assert.equal(a.preferences.webSecurity,true);
  assert.equal(a.session!.check(a,'camera'),false);
  let permission=true;a.session!.request(a,'media',(allowed:boolean)=>{permission=allowed;});assert.equal(permission,false);
  let streams:unknown='pending';a.session!.display({},(value:unknown)=>{streams=value;});assert.deepEqual(streams,{});
  const download=event('');a.session!.emit('will-download',download,{},a);assert.equal(download.prevented,true);
  const evil=event('https://huya.com.evil.test/');a.emit('will-frame-navigate',evil);assert.equal(evil.prevented,true);
  const https=event('https://captcha.example/frame',false);a.emit('will-frame-navigate',https);assert.equal(https.prevented,false);
  const file=event('file:///C:/private',false);a.emit('will-redirect',file);assert.equal(file.prevented,true);
  assert.ok(h.events.some(value=>value.kind==='blocked'&&value.category==='permission'));
  h.manager.dispose();assert.equal(a.session!.listenerCount('will-download'),0);assert.equal(a.session!.check(a,'camera'),false);
});

test('one-use owner popup permits revoke on navigation/reload and retain provided contents/session',async()=>{
  const h=harness();await h.manager.createRoom(roomConfig('a'));const a=h.contents('a');
  const request={url:'https://lgn.huya.com/lgn/jump/authentication.do',disposition:'new-window'};
  assert.equal(a.popupHandler(request).action,'deny');
  h.manager.permitLoginPopup('a');a.emit('will-frame-navigate',event('https://www.huya.com/123'));
  assert.equal(a.popupHandler(request).action,'deny');
  h.manager.permitLoginPopup('a');h.manager.reloadRoom('a');assert.equal(a.popupHandler(request).action,'deny');
  h.manager.permitLoginPopup('a');const decision=a.popupHandler(request);assert.equal(decision.action,'allow');
  assert.equal(decision.overrideBrowserWindowOptions.webPreferences.partition,a.preferences.partition);
  const supplied=new FakeContents(decision.overrideBrowserWindowOptions.webPreferences,a.session);
  const returned=decision.createWindow({webContents:supplied,webPreferences:decision.overrideBrowserWindowOptions.webPreferences});
  assert.equal(returned,supplied);assert.equal(supplied.session,a.session);assert.equal(supplied.muted,true);
  assert.equal(a.popupHandler(request).action,'deny');
  h.manager.closeRoom('a');assert.equal(h.windows[0].destroyed,true);assert.equal(supplied.destroyed,true);assert.equal(supplied.eventNames().length,0);
  assert.equal(a.popupHandler(request).action,'deny');h.manager.dispose();
});

test('trusted explicit login uses fixed Douyu URL and global limit of three owned windows',async()=>{
  const h=harness();
  for(let i=0;i<4;i++)await h.manager.createRoom(roomConfig(String(i),'douyu'));
  for(let i=0;i<4;i++)h.manager.openLoginWindow(String(i));
  assert.equal(h.windows.length,3);
  for(const window of h.windows){assert.equal(window.webContents.muted,true);assert.deepEqual(window.webContents.loads,['https://passport.douyu.com/member/login?client_id=1&lang=cn']);}
  h.manager.openLoginWindow('0');assert.equal(h.windows.length,3);assert.equal(h.windows[0].focused,true);
  h.manager.closeRoom('0');h.manager.openLoginWindow('3');assert.equal(h.windows.length,4);
  h.manager.dispose();assert.ok(h.windows.every(window=>window.destroyed));
});

test('a deferred popup callback cannot create a window after its owner closes',async()=>{
  const h=harness();await h.manager.createRoom(roomConfig('a'));const a=h.contents('a');h.manager.permitLoginPopup('a');
  const result=a.popupHandler({url:'https://lgn.huya.com/',disposition:'new-window'});assert.equal(result.action,'allow');
  h.manager.closeRoom('a');const supplied=new FakeContents();assert.throws(()=>result.createWindow({webContents:supplied}),/owner/);
  assert.equal(h.windows.length,0);assert.equal(supplied.destroyed,true);h.manager.dispose();
});
