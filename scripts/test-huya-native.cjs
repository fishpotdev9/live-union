'use strict';
// Hidden, isolated Chromium/CSS fixture. No platform network, user session or desktop input.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const baseline=process.argv.includes('--baseline');
const previous=process.argv.includes('--previous');
const implementationFile=path.resolve(__dirname,baseline?'../.local/huya-presentation-2026.11.07.7.cjs':previous?'../.local/huya-presentation-2026.11.08.1.cjs':'../src/platforms/huya/presentation.cjs');
const {build} = require(implementationFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
if (!process.versions.electron) {
  const {spawn} = require('node:child_process');
  (async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'live-union-css-fixture-'));
    let result, exitCode;
    try {
      exitCode = await new Promise((resolve, reject) => {
        const child = spawn(require('electron'), [__filename, '--fixture-profile='+temporary,...(baseline?['--baseline']:[]),...(previous?['--previous']:[])], {windowsHide:true,stdio:['ignore','pipe','ignore']});
        let pending='';
        const timer=setTimeout(()=>child.kill(),20000);
        child.stdout.on('data',data=>{
          pending+=data.toString('utf8');
          const lines=pending.split(/\r?\n/);pending=lines.pop().slice(-65536);
          for(const line of lines)if(line.startsWith('LIVE_UNION_CSS_FIXTURE '))try{result=JSON.parse(line.slice(23));}catch{}
        });
        child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('exit',code=>{clearTimeout(timer);resolve(code);});
      });
      if(!result)throw Error('Missing hidden fixture result');
      result.at=new Date().toISOString();
      result.passed=exitCode===0;
      const root=path.resolve(__dirname,'..');
      await fs.mkdir(path.join(root,'.local'),{recursive:true});
      const filename=baseline?'huya-css-hover-baseline.json':previous?'huya-css-reapply-dev6.json':'huya-css-fixture.json';
      await fs.writeFile(path.join(root,'.local',filename),JSON.stringify(result,null,2)+'\n');
      console.log(JSON.stringify({kind:result.kind,passed:result.passed,offscreen:result.offscreen,realPlatforms:false,
        scenarios:result.observations.map(item=>({transition:item.transition,initial:item.initial.result.status,hover:item.hoverRewrites?.result.status,reapply:item.reapplied?.result.status,sameState:item.reapplied?.sameState,activeOpacity:item.active?.opacity,idleOpacity:item.idle?.opacity,restoredOpacity:item.restored?.opacity})),report:'.local/'+filename}));
      process.exitCode=exitCode===0?0:1;
    } finally {
      const absolute=path.resolve(temporary),base=path.resolve(os.tmpdir());
      if(path.dirname(absolute)!==base || !/^live-union-css-fixture-[a-z0-9]+$/i.test(path.basename(absolute)) ||
         await fs.realpath(absolute)!==path.join(await fs.realpath(base),path.basename(absolute)))throw Error('Unexpected fixture cleanup target');
      async function regularTree(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){
        if(entry.isSymbolicLink())throw Error('Refusing fixture link');
        if(entry.isDirectory())await regularTree(path.join(directory,entry.name));else if(!entry.isFile())throw Error('Refusing fixture entry');
      }}
      await regularTree(absolute);
      await fs.rm(absolute,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  })().catch(()=>{console.error('Hidden CSS fixture failed; no platform session or desktop input was used.');process.exitCode=1;});
} else {
const {app, BrowserWindow, session} = require('electron');
let view;
app.disableHardwareAcceleration();
app.setName('Live Union CSS fixture');
const markup = transition => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
html,body{margin:0} .room-core{width:1200px} #J_playerMain,.native-parent{width:850px;height:538px;position:relative}
.player-wrap{width:850px;height:478px} video{width:100%;height:100%}
#native-controls{width:850px;height:44px;background:#ddd;opacity:1;translate:${transition?'0.015625px':'none'};transition:${transition ? 'opacity .3s ease, background-color .3s ease' : 'none'}}
#native-gift{width:850px;height:60px} #native-chat{display:${transition?'none':'block'};width:340px;height:485px} #chatRoom,#chat-room__list{height:386px} #native-sender{height:99px} textarea{height:48px;width:187px}
</style></head><body><main class="room-core"><div id="J_playerMain"><div id="J_roomPlayerLayer"></div><div class="native-parent"><div class="player-wrap"><video></video></div><div id="native-controls">${'<button type="button"></button>'.repeat(9)}</div><div id="native-gift">${'<div></div>'.repeat(4)}</div></div></div><aside id="native-chat"><div id="chatRoom"><div id="chat-room__list"></div></div><div id="native-sender"><textarea></textarea></div></aside></main></body></html>`;
const probe = `(() => {const c=document.getElementById('native-controls'),s=getComputedStyle(c),r=globalThis[Symbol.for('live-union.presentation.result')],g=globalThis[Symbol.for('live-union.huya.geometry')],b=c.getBoundingClientRect();const hit=[.1,.5,.9].some(f=>c.contains(document.elementFromPoint(Math.min(innerWidth-1,Math.max(0,b.x+b.width*f)),Math.min(innerHeight-1,Math.max(0,b.y+b.height/2)))));return {result:r,opacity:Number(s.opacity),clickThrough:s.pointerEvents==='none'&&!hit,backgroundTransparent:s.backgroundColor==='rgba(0, 0, 0, 0)',transitionSeconds:parseFloat(s.transitionDuration),transitionDisabled:s.transitionProperty==='none',geometry:g?{viewport:g.viewport,video:g.video,controls:g.controls}:null,stylePresent:!!document.getElementById('live-union-huya-presentation-v1')};})()`;
(async () => {
  const argument=process.argv.find(value=>value.startsWith('--fixture-profile='));
  const temporary=path.resolve(argument?.slice('--fixture-profile='.length)||'');
  if(path.dirname(temporary)!==path.resolve(os.tmpdir()) || !/^live-union-css-fixture-[a-z0-9]+$/i.test(path.basename(temporary)))throw Error('Invalid fixture profile');
  app.setPath('userData', temporary);
  await app.whenReady();
  const isolated = session.fromPartition('live-union-css-fixture', {cache:false});
  isolated.webRequest.onBeforeRequest((request, callback) => callback({cancel:!request.url.startsWith('data:')}));
  view = new BrowserWindow({show:false, width:742, height:370, useContentSize:true,
    webPreferences:{session:isolated, nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true, backgroundThrottling:false,offscreen:true}});
  const observations=[];
  for(const transition of [false,true]) {
    assert.equal(view.isVisible(),false);
    await view.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(markup(transition)));
    await wait(100);
    await view.webContents.executeJavaScript(build({compact:true,chatVisible:false,chatWidthDip:340}));
    const initial=await view.webContents.executeJavaScript(probe);
    await wait(400);
    const settled=await view.webContents.executeJavaScript(probe);
    await view.webContents.executeJavaScript(`document.querySelector('video').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:300,clientY:100}));`);
    const active=await view.webContents.executeJavaScript(probe);
    // Real CSSOM/MutationObserver scheduling; emulate the redundant SDK inset
    // writes observed on the real Huya player, without clicks or native input.
    for(let index=0;index<12;index++){
      await view.webContents.executeJavaScript(`document.getElementById('native-controls').style.setProperty('bottom',${JSON.stringify(index%2?'0px':'60px')});document.getElementById('native-controls').style.setProperty('right','0px');document.querySelector('video').dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:300,clientY:100}));`);
      await wait(30);
    }
    const hoverRewrites=await view.webContents.executeJavaScript(probe);
    await view.webContents.executeJavaScript(`globalThis.fixtureState=globalThis[Symbol.for('live-union.huya.presentation.v1')];globalThis.fixtureStyle=document.getElementById('live-union-huya-presentation-v1');document.getElementById('native-controls').style.display='none';document.getElementById('native-gift').style.display='none';`);
    view.setContentSize(703,272);await wait(100);
    await view.webContents.executeJavaScript(build({compact:true,chatVisible:false,chatWidthDip:340}));
    const reapplied=await view.webContents.executeJavaScript(probe);
    Object.assign(reapplied,await view.webContents.executeJavaScript(`({sameState:globalThis.fixtureState===globalThis[Symbol.for('live-union.huya.presentation.v1')],sameStyle:globalThis.fixtureStyle===document.getElementById('live-union-huya-presentation-v1'),nativeHidden:getComputedStyle(document.getElementById('native-controls')).display==='none'})`));
    await view.webContents.executeJavaScript(build({compact:true,chatVisible:true,chatWidthDip:340}));
    const chatRevealed=await view.webContents.executeJavaScript(probe);
    Object.assign(chatRevealed,await view.webContents.executeJavaScript(`(() => {const input=document.querySelector('textarea'),sender=document.getElementById('native-sender');return {inputHeight:input.getBoundingClientRect().height,senderHeight:sender.getBoundingClientRect().height,sameState:globalThis.fixtureState===globalThis[Symbol.for('live-union.huya.presentation.v1')]}})()`));
    await view.webContents.executeJavaScript(build({compact:true,chatVisible:false,chatWidthDip:340}));
    await view.webContents.executeJavaScript(`document.getElementById('native-controls').style.removeProperty('display');document.getElementById('native-gift').style.removeProperty('display')`);
    await wait(1800);
    const idle=await view.webContents.executeJavaScript(probe);
    await view.webContents.executeJavaScript(build({compact:false,chatVisible:false,chatWidthDip:340}));
    // A hidden renderer need not paint. Start the restored native transition
    // with a computed-style observation before allowing its original duration.
    await view.webContents.executeJavaScript(probe);
    await wait(400);
    const restored=await view.webContents.executeJavaScript(probe);
    observations.push({transition,fractionalTranslation:transition,initial,settled,active,hoverRewrites,reapplied,chatRevealed,idle,restored});
  }
  assert.equal(view.isVisible(),false);
  const implementationSha256=crypto.createHash('sha256').update(await fs.readFile(implementationFile)).digest('hex');
  console.log('LIVE_UNION_CSS_FIXTURE '+JSON.stringify({kind:'hidden-local-chromium-css',realPlatforms:false,nativeChromium:true,hiddenWindow:true,offscreen:view.webContents.isOffscreen(),electron:process.versions.electron,chromium:process.versions.chrome,implementationSha256,observations}));
  for(const observation of observations) {
    assert.equal(observation.initial.result.status,'applied');
    assert.equal(observation.initial.opacity,0);
    assert.equal(observation.initial.clickThrough,true);
    assert.equal(observation.settled.result.status,'applied');
    assert.equal(observation.settled.opacity,0);
    assert.equal(observation.settled.stylePresent,true);
    assert.equal(observation.active.result.status,'applied');
    assert.equal(observation.active.opacity,1);
    assert.equal(observation.active.clickThrough,false);
    assert.equal(observation.hoverRewrites.result.status,'applied');
    assert.equal(observation.reapplied.result.status,'applied');
    assert.equal(observation.reapplied.sameState,true);assert.equal(observation.reapplied.sameStyle,true);assert.equal(observation.reapplied.nativeHidden,true);
    assert.equal(observation.chatRevealed.result.status,'applied');assert.equal(observation.chatRevealed.sameState,true);
    assert(observation.chatRevealed.inputHeight>0);assert(observation.chatRevealed.senderHeight>0);
    assert.equal(observation.idle.result.status,'applied');
    assert.equal(observation.idle.opacity,0);
    assert.equal(observation.idle.clickThrough,true);
    assert.equal(observation.restored.result.status,'restored');
    assert.equal(observation.restored.stylePresent,false);
    assert.equal(observation.restored.opacity,1);
    assert.equal(observation.restored.transitionSeconds,observation.transition ? .3 : 0);
  }
})().then(()=>app.exit(0),error=>{
  console.error('Hidden CSS fixture failed: '+(error.code==='ERR_ASSERTION'?'assertion':'fixture-error'));
  app.exit(1);
});
app.on('will-quit', () => { if(view&&!view.isDestroyed())view.destroy(); });
}
