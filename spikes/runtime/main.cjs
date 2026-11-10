'use strict';
const { app, BaseWindow, BrowserWindow, WebContentsView, View, ipcMain, session, screen, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const safeObservation = require('./safe-observation.cjs');
const root = __dirname;
const sourceHashes=Object.fromEntries(['main.cjs','safe-observation.cjs','preload.cjs','chrome.js','style.css','room.html','toolbar.html','fixture.html'].map(file=>[file,createHash('sha256').update(readFileSync(path.join(root,file))).digest('hex')]));
const sourceSha256=createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex');
const probeHashes={};
const runId = new Date().toISOString().replace(/[:.]/g,'-');
const fixtureMode = process.argv.includes('--fixture');
const selfTest = process.argv.includes('--self-test');
const liveProbe = process.argv.includes('--platforms');
const controlMode = process.argv.includes('--control');
if(selfTest) {
  process.on('uncaughtException',error=>{console.error('FIXTURE_UNCAUGHT_EXCEPTION',error.stack);app.exit(1);});
  process.on('unhandledRejection',error=>{console.error('FIXTURE_UNHANDLED_REJECTION',error);app.exit(1);});
}
app.setPath('userData', path.join(os.tmpdir(), selfTest ? 'live-union-g0-test' : 'live-union-g0-profile'));
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
const remotePrefs = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false };
const localPrefs = { ...remotePrefs, preload: path.join(root, 'preload.cjs') };
const records = [];
const rooms = new Map();
const trusted = new Map();
const popups = new Map();
const popupPermits = new Map();
const installedSessions = new Set();
let win, toolbar, toolbarContents, nextId = 0, expanded, geometry, cleaned = false;
let controlTimer;
const toolbarHeight = 132;
const fixtureUrl = pathToFileURL(path.join(root, 'fixture.html')).href;
const localUrl = (name) => pathToFileURL(path.join(root, name)).href;
const navHosts = {
  huya: ['www.huya.com', 'huya.com', 'lgn.huya.com', 'aq.huya.com'],
  douyu: ['www.douyu.com', 'douyu.com', 'passport.douyu.com'],
  bilibili: ['live.bilibili.com', 'passport.bilibili.com', 'www.bilibili.com']
};
const loginHosts = { huya:['lgn.huya.com','aq.huya.com'],douyu:['passport.douyu.com'],bilibili:['passport.bilibili.com'],fixture:[] };
const loginUrls = { douyu:'https://passport.douyu.com/member/login?client_id=1&lang=cn' };
const record = (kind, fields = {}) => { records.push({ kind, at: new Date().toISOString(), ...fields }); if (records.length > 2000) records.shift(); };
function normalize(input) {
  const u = new URL(input.trim());
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new Error('仅支持三平台 HTTPS 直播间链接');
  const host = u.hostname.toLowerCase();
  let platform, room;
  if (['www.huya.com', 'huya.com'].includes(host) && /^\/[a-zA-Z0-9_-]+\/?$/.test(u.pathname)) platform = 'huya';
  if (['www.douyu.com', 'douyu.com'].includes(host) && /^\/[0-9]+\/?$/.test(u.pathname)) platform = 'douyu';
  if (host === 'live.bilibili.com' && /^\/(?:blanc\/)?[0-9]+\/?$/.test(u.pathname)) platform = 'bilibili';
  if (!platform) throw new Error('链接不是支持的直播间地址');
  room = u.pathname.split('/').filter(Boolean).at(-1);
  return { platform, platformRoomId: room, url: `https://${platform === 'bilibili' ? 'live.bilibili.com' : `www.${platform}.com`}/${room}` };
}
function allowedUrl(platform, url) {
  try {
    const u = new URL(url);
    if (platform === 'fixture') return url.split('?')[0] === fixtureUrl;
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && navHosts[platform].includes(u.hostname);
  } catch { return false; }
}
function secureSession(s) {
  if (installedSessions.has(s)) return;
  installedSessions.add(s);
  s.setPermissionCheckHandler(() => false);
  s.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  s.on('will-download', event => { event.preventDefault(); record('download-denied'); });
}
function secureContents(wc, platform, partition, owner = wc.id) {
  wc.setAudioMuted(true);
  const checkNavigation = (event) => {
    const url = event.url;
    const main = event.isMainFrame;
    if(main) popupPermits.delete(owner);
    let safe = false;
    let targetScheme='unknown';
    try { const parsed=new URL(url); targetScheme=['https:','http:','blob:','data:','about:','file:'].includes(parsed.protocol)?parsed.protocol:'other'; safe = main ? allowedUrl(platform, url) : platform === 'fixture' ? allowedUrl(platform, url) : parsed.protocol === 'https:' || (parsed.protocol==='blob:' && parsed.origin.startsWith('https://')) || ['about:blank','about:srcdoc'].includes(url); } catch {}
    if (!safe) { event.preventDefault(); record('navigation-denied', { platform, frame: main ? 'main' : 'child', targetScheme }); }
  };
  wc.on('will-frame-navigate', checkNavigation);
  wc.on('will-redirect', checkNavigation);
  wc.on('will-attach-webview', event => event.preventDefault());
  wc.setWindowOpenHandler(({ url, disposition }) => {
    const permit = popupPermits.get(owner);
    let target = false; try { target = platform === 'fixture' ? url === fixtureUrl : loginHosts[platform]?.includes(new URL(url).hostname); } catch {}
    if (!permit || permit.until < Date.now() || !target || !allowedUrl(platform, url) || disposition === 'background-tab' || popups.size >= 3) {
      record('popup-denied', { platform }); return { action: 'deny' };
    }
    popupPermits.delete(owner);
    return {
      action: 'allow',
      overrideBrowserWindowOptions: { show:!selfTest, webPreferences: { ...remotePrefs, partition } },
      createWindow: (options) => {
        const child = new BrowserWindow({ ...options, webContents: options.webContents, width: 1000, height: 760, parent: win, autoHideMenuBar: true });
        secureContents(child.webContents, platform, partition, owner);
        popups.set(child, owner); child.on('closed', () => popups.delete(child));
        record('popup-created', { platform, sameSession: child.webContents.session === wc.session });
        return child.webContents;
      }
    };
  });
}
function trust(wc, role, id, file) {
  const expected = localUrl(file);
  trusted.set(wc.id, { role, id, expected });
  wc.on('will-navigate', e => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('destroyed', () => trusted.delete(wc.id));
}
function snapshot() {
  const d = screen.getDisplayMatching(win.getBounds());
  return { electron: process.versions.electron, expanded, display: { ...d.size, scaleFactor: d.scaleFactor }, rooms: [...rooms.values()].map(r => ({ id: r.id, label: r.label, platform: r.platform, allowed: r.allowed, navigation: r.navigation, webContentsId: r.webContentsId, generation: r.generation, rect: r.rect, navigations: r.navigations })) };
}
function publish() {
  if (!win || win.isDestroyed() || cleaned) return;
  const state = snapshot();
  for (const id of trusted.keys()) {
    const wc = require('electron').webContents.fromId(id);
    if (wc && !wc.isDestroyed() && !wc.isLoadingMainFrame()) wc.send('g0:state', state);
  }
}
function canvas() { const [width, height] = win.getContentSize(); return { width, height: height - toolbarHeight }; }
function setRect(r, raw) {
  const c = canvas();
  const width = Math.round(Math.max(300, Math.min(c.width, raw.width)));
  const height = Math.round(Math.max(160, Math.min(c.height, raw.height)));
  const x = Math.round(Math.max(0, Math.min(c.width - 80, raw.x)));
  const y = Math.round(Math.max(0, Math.min(c.height - 40, raw.y)));
  r.rect = { x, y, width, height };
  r.group.setBounds({ x, y: y + toolbarHeight, width, height });
  r.chrome.setBounds({ x: 0, y: 0, width, height });
  r.page.setBounds({ x: 1, y: 37, width: width - 2, height: height - 47 });
}
function equal() {
  expanded = undefined;
  const c = canvas(), n = rooms.size;
  const columns = Math.max(1, Math.ceil(Math.sqrt(n * c.width / Math.max(c.height, 1) / 1.65)));
  const rows = Math.max(1, Math.ceil(n / columns));
  [...rooms.values()].forEach((r, i) => setRect(r, { x: (i % columns) * c.width / columns, y: Math.floor(i / columns) * c.height / rows, width: c.width / columns, height: c.height / rows }));
  publish();
}
function top(r) { win.contentView.addChildView(r.group); record('raised', { id: r.id }); }
async function createRoom(value) {
  const prior = [...rooms.values()].find(r => r.url === value.url && value.platform !== 'fixture');
  if (prior) { top(prior); return prior; }
  const id = `g0-${++nextId}`;
  const partition = `persist:live-union-g0-${value.platform}`;
  secureSession(session.fromPartition(partition));
  const group = new View(); group.setBackgroundColor('#263b52');
  const chrome = new WebContentsView({ webPreferences: localPrefs });
  const page = new WebContentsView({ webPreferences: { ...remotePrefs, partition } });
  const contents=page.webContents,chromeContents=chrome.webContents;
  secureContents(page.webContents, value.platform, partition);
  assert.equal(page.webContents.isAudioMuted(), true);
  const r = { ...value, id, label: `${value.platform} · ${value.platformRoomId || nextId}`, group, chrome, page, contents,chromeContents,webContentsId:contents.id, allowed: false, navigation: 'loading', navigations: 0, generation: 1 };
  rooms.set(id, r);
  trust(chrome.webContents, 'room', id, 'room.html');
  group.addChildView(chrome); group.addChildView(page); win.contentView.addChildView(group);
  const current=()=>!cleaned&&rooms.get(id)===r&&!contents.isDestroyed();
  contents.on('did-start-navigation', (event, _url, inPlace, main) => { if (!current())return; if (event.isMainFrame ?? main) { if(event.isSameDocument ?? inPlace) { record('in-page-navigation',{id}); return; } popupPermits.delete(contents.id); r.navigations++; contents.setAudioMuted(!r.allowed); record('navigation', { id }); } });
  contents.on('did-finish-load', () => { if(!current())return;r.navigation = 'ready'; contents.setAudioMuted(!r.allowed); publish(); });
  contents.on('did-fail-load', (_e, code, _description, _url, main) => { if(!current())return;if (main && code !== -3) { r.navigation = `error ${code}`; record('load-error', { id, code }); publish(); } });
  contents.on('render-process-gone', (_e, details) => { if(!current())return;r.navigation = 'crashed'; record('render-gone', { id, reason: details.reason }); publish(); });
  contents.on('media-started-playing', () => {if(current())record('media-started', { id, muted: contents.isAudioMuted() });});
  contents.on('audio-state-changed', () => {if(current())record('audio-state', { id, audible:contents.isCurrentlyAudible(), muted: contents.isAudioMuted() });});
  await chrome.webContents.loadFile(path.join(root, 'room.html'), { query: { id } });
  equal();
  record('created-before-navigation', { id, muted: page.webContents.isAudioMuted() });
  page.webContents.loadURL(value.url).catch(() => {});
  return r;
}
function remove(r) {
  rooms.delete(r.id); win.contentView.removeChildView(r.group);
  popupPermits.delete(r.page.webContents.id);
  for (const [popup, owner] of popups) if (owner === r.page.webContents.id) popup.destroy();
  r.contents.close({ waitForBeforeUnload: false }); r.chromeContents.close({ waitForBeforeUnload: false });
  record('closed', { id: r.id }); equal();
}
function muteAll() { for (const r of rooms.values()) { r.allowed = false; r.page.webContents.setAudioMuted(true); } publish(); }
function solo(r) { muteAll(); if (rooms.has(r.id)) { r.allowed = true; r.page.webContents.setAudioMuted(false); } publish(); }
function openLogin(r) {
  const url=loginUrls[r.platform];
  if(!url) throw new Error('此平台请在放大后的原网页登录');
  for(const [popup,owner] of popups) if(owner===r.page.webContents.id){popup.show();popup.focus();return;}
  const partition=`persist:live-union-g0-${r.platform}`;
  const popup=new BrowserWindow({title:'Live Union · 斗鱼原生登录',width:1000,height:800,parent:win,autoHideMenuBar:true,webPreferences:{...remotePrefs,partition}});
  secureContents(popup.webContents,r.platform,partition,r.page.webContents.id);
  popups.set(popup,r.page.webContents.id);popup.on('closed',()=>popups.delete(popup));
  record('login-window-created',{platform:r.platform,sameSession:popup.webContents.session===r.page.webContents.session});
  popup.loadURL(url).catch(()=>record('login-window-load-failed',{platform:r.platform}));
}
function roomMenu(r) {
  const menu=Menu.buildFromTemplate([
    {label:'斗鱼原生登录窗口',enabled:r.platform==='douyu',click:()=>{if(rooms.has(r.id))openLogin(r);}},
    {label:'允许一次本平台登录弹窗（30秒）',click:()=>{if(rooms.has(r.id))popupPermits.set(r.page.webContents.id,{until:Date.now()+30000});}},
    {type:'separator'},
    {label:'刷新此房间',click:()=>{if(rooms.has(r.id)){popupPermits.delete(r.page.webContents.id);r.page.webContents.setAudioMuted(!r.allowed);r.page.webContents.reload();}}},
    {label:'关闭此房间',click:()=>{if(rooms.has(r.id))remove(r);}}
  ]);
  menu.popup({window:win});
}
const structureSelectors = {
  huya: ['#J_playerMain','#J_roomPlayerLayer','#chatRoom','#chat-room__wrap','#chat-room__list','.room-main','.room-core','.main_col','.room-player-wrap','.player-wrap','video'],
  douyu: ['.layout-Player','.layout-Player-main','.layout-Player-video','.layout-Player-aside','.layout-Player-chat','#js-player-video','#js-player-asideMain','.ChatRoom','.Barrage-send','video','iframe'],
  bilibili: ['#live-player','.live-player-mounter','.aside-area-ctnr','.chat-history-list','.chat-input-ctnr','.live-room-app','.player-section','.player-ctnr','.room-info-ctnr','.app-body','video','iframe']
};
async function inspectStructure() {
  const output=[];
  for(const r of rooms.values()) {
    const selectors=structureSelectors[r.platform] || ['canvas','input','button'];
    const raw=await Promise.race([r.page.webContents.executeJavaScript(`(${JSON.stringify(selectors)}).map(selector=>{const e=document.querySelector(selector);if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,count:document.querySelectorAll(selector).length}})`),delay(4000).then(()=>null)]);
    const values=safeObservation.structure(selectors,raw);
    output.push({id:r.id,platform:r.platform,values});
  }
  await saveEvidence('g0-structure.json',{at:new Date().toISOString(),output});
  console.log(JSON.stringify({kind:'structure',output}));
}
async function runControl(c) {
  if(!c || typeof c!=='object')throw Error('invalid');
  if(c.action==='inspect')await inspectStructure();
  else if(c.action==='inspectFrames'){
    const filename=path.join(root,'inspection.cjs');delete require.cache[require.resolve(filename)];
    probeHashes.inspection=createHash('sha256').update(readFileSync(filename)).digest('hex');
    const inspector=require(filename),output=[];
    for(const r of rooms.values()){
      const frames=r.page.webContents.mainFrame.framesInSubtree.slice(0,12);
      const values=await Promise.all(frames.map(async(frame,index)=>{try{const raw=await Promise.race([frame.executeJavaScript(inspector.script),delay(4000).then(()=>null)]);return{index,main:index===0,...inspector.sanitize(raw)};}catch{return{index,unavailable:true};}}));
      output.push({id:r.id,platform:r.platform,frames:values});
    }
    await saveEvidence('g0-frames.json',{at:new Date().toISOString(),probeHashes,output});
  }
  else if(c.action==='presentation'&&Object.hasOwn(navHosts,c.platform)){
    const filename=path.join(root,'..',c.platform,'presentation.cjs');delete require.cache[require.resolve(filename)];
    probeHashes[c.platform]=createHash('sha256').update(readFileSync(filename)).digest('hex');
    const probe=require(filename);
    const prefs={compact:c.compact===true,chatVisible:c.chatVisible!==false,chatWidthDip:Math.max(140,Math.min(500,Number.isFinite(c.chatWidthDip)?c.chatWidthDip:240))};
    for(const r of rooms.values())if(r.platform===c.platform){const before=r.navigations;await r.page.webContents.executeJavaScript(probe.build(prefs));record('presentation-probe',{id:r.id,navigationDelta:r.navigations-before});}
  }
  else if(c.action==='sample')await saveEvidence('g0-manual-sample.json',await collect());
  else if(c.action==='equal')equal();
  else if(c.action==='quit')app.quit();
  else if(c.action==='closeLogins'){for(const p of popups.keys())p.close();}
  else if(c.action==='add'&&typeof c.url==='string'&&c.url.length<=2048)await createRoom(normalize(c.url));
  else throw Error('unsupported');
}
function startFileControl() {
  const file=path.join(root,'../../.local/g0-command.json');
  let busy=false;
  controlTimer=setInterval(async()=>{
    if(busy||cleaned)return;busy=true;
    try {
      let raw;try{raw=await fs.readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return;throw error;}
      await fs.rm(file,{force:true});
      if(raw.length>4096)throw Error('oversize');
      await runControl(JSON.parse(raw));
    }catch{record('control-failed');}finally{busy=false;}
  },250);
  controlTimer.unref();
}
if(controlMode) {
  let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{
    input+=chunk;if(input.length>4096){input='';return;}
    let newline;while((newline=input.indexOf('\n'))>=0){const line=input.slice(0,newline);input=input.slice(newline+1);(async()=>{
      try {await runControl(JSON.parse(line));console.log('CONTROL_OK');}catch{console.log('CONTROL_FAILED');}
    })();}
  });
}
ipcMain.handle('g0:command', async (event, command) => {
  try {
    const sender = trusted.get(event.sender.id);
    if (!sender || event.senderFrame !== event.sender.mainFrame || new URL(event.senderFrame.url).pathname !== new URL(sender.expected).pathname || !event.senderFrame.url.startsWith('file:')) throw new Error('拒绝非可信来源');
    if (!command || typeof command !== 'object' || typeof command.action !== 'string') throw new Error('无效命令');
    const c = command;
    const r = sender.role === 'room' ? rooms.get(sender.id) : rooms.get(c.id);
    const roomActions = ['allow','solo','native','menu','login','permitPopup','reload','close','beginGeometry','move','resize','endGeometry'];
    if (sender.role === 'room' && !roomActions.includes(c.action) && c.action !== 'state') throw new Error('无权操作');
    if (roomActions.includes(c.action) && !r) throw new Error('房间已关闭');
    switch (c.action) {
      case 'state': publish(); break;
      case 'add': if (typeof c.url !== 'string' || c.url.length > 2048) throw new Error('链接过长'); await createRoom(normalize(c.url)); break;
      case 'fixture': await createRoom({ platform: 'fixture', url: fixtureUrl }); break;
      case 'equal': equal(); break;
      case 'overlap': { let i = 0; for (const room of rooms.values()) { setRect(room, { x: i * 180, y: i * 90, width: 680, height: 480 }); top(room); i++; } publish(); break; }
      case 'muteAll': muteAll(); break;
      case 'allow': r.allowed = !r.allowed; r.page.webContents.setAudioMuted(!r.allowed); publish(); break;
      case 'solo': solo(r); break;
      case 'login': openLogin(r); break;
      case 'menu': roomMenu(r); break;
      case 'permitPopup': popupPermits.set(r.page.webContents.id,{until:Date.now()+30000}); record('popup-permitted',{id:r.id}); break;
      case 'reload': popupPermits.delete(r.page.webContents.id); r.page.webContents.setAudioMuted(!r.allowed); r.page.webContents.reload(); break;
      case 'close': remove(r); break;
      case 'native': if (expanded === r.id) equal(); else { expanded = r.id; top(r); setRect(r, { x: 0, y: 0, ...canvas() }); publish(); } break;
      case 'beginGeometry': geometry = { id: r.id, ...r.rect }; top(r); break;
      case 'move': case 'resize': {
        if (geometry?.id !== r.id || !Number.isFinite(c.dx) || !Number.isFinite(c.dy) || Math.abs(c.dx) > 20000 || Math.abs(c.dy) > 20000) throw new Error('无效几何');
        setRect(r, c.action === 'move' ? { ...geometry, x: geometry.x + c.dx, y: geometry.y + c.dy } : { ...geometry, width: geometry.width + c.dx, height: geometry.height + c.dy });
        break;
      }
      case 'endGeometry': geometry = undefined; publish(); break;
      default: throw new Error('未知命令');
    }
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
});
async function collect() {
  const media = [];
  for (const r of rooms.values()) {
    let observation;
    try {
      const raw = await Promise.race([r.page.webContents.executeJavaScript(`(() => ({ video: [...document.querySelectorAll('video')].slice(0,4).map(v=>({width:v.videoWidth,height:v.videoHeight,paused:v.paused,readyState:v.readyState,currentTime:v.currentTime,frames:v.getVideoPlaybackQuality?.().totalVideoFrames,dropped:v.getVideoPlaybackQuality?.().droppedVideoFrames})), canvasCount:document.querySelectorAll('canvas').length }))()`),delay(4000).then(()=>null)]);
      observation = safeObservation.media(raw);
      if (r.platform === 'fixture') {
        const f = await r.page.webContents.executeJavaScript('({clicks:window.fixture?.clicks,frames:window.fixture?.frames,boot:window.fixture?.boot})');
        observation.fixture = safeObservation.fixture(f);
      }
    } catch { observation = { unavailable: true }; }
    media.push({ id: r.id, platform: r.platform, muted: r.page.webContents.isAudioMuted(), observation });
  }
  return { runId, sourceSha256, sourceHashes, probeHashes, appVersion:app.getVersion(), scope:'G0; main-document media only; no login/quality inference', state: snapshot(), versions: process.versions, os: { release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: os.totalmem()/2**30 }, gpu: app.getGPUFeatureStatus(), media, records };
}
async function saveEvidence(name, data) {
  const dir = path.join(root, '../../docs/evidence/runtime',selfTest?'':runId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), JSON.stringify(data, null, 2));
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if(controlTimer)clearInterval(controlTimer);
  for (const r of rooms.values()) for (const wc of [r.contents,r.chromeContents]) if (!wc.isDestroyed()) wc.close({waitForBeforeUnload:false});
  rooms.clear();
  for (const p of popups.keys()) if (!p.isDestroyed()) p.destroy();
  popupPermits.clear();
  if (toolbarContents && !toolbarContents.isDestroyed()) toolbarContents.close({waitForBeforeUnload:false});
}
async function runSelfTest() {
  try {
    await delay(1500);
    const initial = [...rooms.values()].map(r => ({ id:r.id, wc:r.page.webContents.id, nav:r.navigations }));
    for (let i=0;i<20;i++) { equal(); for (const r of rooms.values()) { setRect(r,{x:i*4,y:i*3,width:620,height:370}); top(r); } }
    for (const prior of initial) { const r=rooms.get(prior.id); assert.equal(r.page.webContents.id,prior.wc); assert.equal(r.navigations,prior.nav); assert.equal(r.page.webContents.isAudioMuted(),true); }
    const [a,b] = [...rooms.values()];
    solo(a); assert.equal(a.page.webContents.isAudioMuted(),false); assert.equal(b.page.webContents.isAudioMuted(),true);
    solo(b); assert.equal(a.page.webContents.isAudioMuted(),true); assert.equal(b.page.webContents.isAudioMuted(),false);
    muteAll();
    assert.equal(a.page.webContents.session,b.page.webContents.session);
    assert.throws(()=>normalize('https://huya.com.evil.example/123'));
    assert.throws(()=>normalize('https://user:secret@www.huya.com/123'));
    assert.equal(normalize('https://live.bilibili.com/blanc/6?tracking=1').url,'https://live.bilibili.com/6');
    const isolation=await a.page.webContents.executeJavaScript('({node:typeof process,require:typeof require,bridge:typeof window.g0})');
    assert.deepEqual(isolation,{node:'undefined',require:'undefined',bridge:'undefined'});
    await a.page.webContents.executeJavaScript('window.open(location.href,"denied-fixture"); void 0');
    assert.equal(popups.size,0);
    popupPermits.set(a.page.webContents.id,{until:Date.now()+30000});
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Fixture reload timeout')),4000);
      a.page.webContents.once('did-finish-load',()=>{clearTimeout(timer);resolve();});
      a.page.webContents.reload();
    });
    assert.equal(popupPermits.has(a.page.webContents.id),false);
    await a.page.webContents.executeJavaScript('window.open(location.href,"denied-after-refresh"); void 0');
    assert.equal(popups.size,0);
    popupPermits.set(a.page.webContents.id,{until:Date.now()+30000});
    await a.page.webContents.executeJavaScript('window.open(location.href,"permitted-fixture"); void 0');
    await delay(300);
    assert.equal(popups.size,1);
    const popup=[...popups.keys()][0];
    assert.equal(popup.webContents.session,a.page.webContents.session);
    assert.equal(popup.webContents.isAudioMuted(),true);
    assert.equal(popupPermits.has(a.page.webContents.id),false);
    const closedIds=[a.page.webContents.id,a.chrome.webContents.id],stale=a.contents; remove(a);
    // Chromium can deliver an audio-state notification after its View was disposed.
    // Reproduce that stale notification without recording live/user audio.
    stale.emit('audio-state-changed'); stale.emit('media-started-playing'); stale.emit('did-finish-load');
    await delay(500);
    for (const id of closedIds) assert.equal(require('electron').webContents.fromId(id),undefined);
    assert.equal(popups.size,0);
    const result=await collect(); result.test={status:'passed',scope:'local fixture only',checks:['60 geometry changes retain identities and navigation counts','mute before navigation API state','solo final API states (not acoustic timing)','same platform session object','URL spoof/credentials rejection','remote Node/IPC absence','one-use popup permit revoked on refresh, same session and initial mute','room close destroys page/chrome and owned popup','late audio/media/load events after close are ignored']};
    await saveEvidence('g0-fixture.json',result); console.log('G0 fixture assertions passed');
    if(process.argv.includes('--close-window')) win.close(); else app.quit();
  } catch (error) { await saveEvidence('g0-fixture-failure.json',{error:error.stack}); console.error(error); app.exit(1); }
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  win = new BaseWindow({ title:'Live Union · G0 原生视图验证', show:!selfTest, width:1500, height:1000, minWidth:960, minHeight:640, backgroundColor:'#10151e' });
  toolbar = new WebContentsView({ webPreferences:localPrefs });
  toolbarContents=toolbar.webContents;
  win.on('closed',()=>{ cleanup(); app.quit(); });
  trust(toolbar.webContents,'toolbar',undefined,'toolbar.html'); win.contentView.addChildView(toolbar);
  toolbar.setBounds({x:0,y:0,width:win.getContentSize()[0],height:toolbarHeight});
  await toolbar.webContents.loadFile(path.join(root,'toolbar.html'));
  // A Windows background launcher may override the constructor's first ShowWindow.
  // Show explicitly after local UI loading; fixture windows remain hidden.
  if(!selfTest){win.show();win.focus();}
  if(controlMode)startFileControl();
  win.on('resize',()=>{ if(!win.isDestroyed()&&!cleaned){toolbar.setBounds({x:0,y:0,width:win.getContentSize()[0],height:toolbarHeight}); equal();} });
  if(fixtureMode) for(let i=0;i<3;i++) await createRoom({platform:'fixture',url:fixtureUrl});
  if(liveProbe) for(const url of ['https://www.huya.com/222523','https://www.douyu.com/9999','https://live.bilibili.com/6']) await createRoom(normalize(url));
  if(process.argv.includes('--login-douyu')) openLogin([...rooms.values()].find(r=>r.platform==='douyu'));
  publish();
  if(selfTest) runSelfTest();
  if(liveProbe) { let n=0; const timer=setInterval(async()=>{try{await saveEvidence(`g0-platform-${++n}.json`,await collect());}catch{} if(n>=3) clearInterval(timer);},30000); timer.unref(); setTimeout(()=>inspectStructure().catch(()=>{}),5000).unref(); }
}).catch(error => { console.error('G0 startup failed:', error.code || error.name); cleanup(); app.exit(1); });
app.on('before-quit',cleanup);
app.on('window-all-closed',()=>app.quit());
