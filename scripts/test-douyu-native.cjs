'use strict';
// Real Chromium geometry over local synthetic markup, never a platform/session test.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const marker='LIVE_UNION_DOUYU_CSS ';
if(!process.versions.electron){
  const {spawn}=require('node:child_process');
  (async()=>{
    const profile=await fs.mkdtemp(path.join(os.tmpdir(),'live-union-douyu-css-'));let report,code;
    try{
      code=await new Promise((resolve,reject)=>{
        const child=spawn(require('electron'),[__filename,'--profile='+profile],{windowsHide:true,stdio:['ignore','pipe','ignore']});
        const timer=setTimeout(()=>child.kill(),30000);let pending='';
        child.stdout.on('data',data=>{pending+=data.toString('utf8');const lines=pending.split(/\r?\n/);pending=lines.pop().slice(-65536);
          for(const line of lines)if(line.startsWith(marker))try{report=JSON.parse(line.slice(marker.length));}catch{}
        });
        child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',value=>{clearTimeout(timer);resolve(value);});
      });
      if(!report)throw Error('Missing fixture report');report.passed=code===0;
      const local=path.resolve(__dirname,'../.local');await fs.mkdir(local,{recursive:true});
      await fs.writeFile(path.join(local,'douyu-css-fixture.json'),JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify({kind:report.kind,passed:report.passed,realPlatforms:false,scenarios:report.scenarios?.length,report:'.local/douyu-css-fixture.json'}));
      process.exitCode=code===0?0:1;
    }finally{
      const target=path.resolve(profile),base=path.resolve(os.tmpdir());
      if(path.dirname(target)!==base||!/^live-union-douyu-css-[a-z0-9]+$/i.test(path.basename(target))||await fs.realpath(target)!==path.join(await fs.realpath(base),path.basename(target)))throw Error('Unexpected fixture cleanup target');
      async function regularTree(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
        if(entry.isSymbolicLink())throw Error('Fixture link refused');if(entry.isDirectory())await regularTree(path.join(dir,entry.name));else if(!entry.isFile())throw Error('Fixture entry refused');
      }}
      await regularTree(target);await fs.rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  })().catch(()=>{console.error('Hidden Douyu CSS fixture failed; no user session or desktop input.');process.exitCode=1;});
}else{
const {app,BrowserWindow,session}=require('electron');
const {build}=require('../src/platforms/douyu/presentation.cjs');
app.disableHardwareAcceleration();app.setName('Live Union Douyu CSS fixture');
const markup=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
html,body{margin:0;min-width:1200px}#outside-header{height:60px;background:white}main{position:relative;width:1200px;height:900px}
#native-frame{position:absolute;left:32px;top:80px;width:658px;height:370px}
#js-player-video{position:absolute;left:0;top:0;width:658px;height:370px}#media-wrapper,video{width:100%;height:100%}
#sdk-peer{position:absolute;left:0;top:0;width:658px;height:370px;pointer-events:none}#sdk-a{position:relative;width:100%;height:100%}#sdk-b{position:relative;width:658px;height:370px}
.danmu-root{position:absolute;left:0;top:0;width:658px;height:370px;pointer-events:none}.danmu-message{position:absolute;left:10px;top:10px;width:30px;height:12px;background:red}
.DanmuAdvanced{display:none;position:absolute;left:0;top:0;width:658px;height:370px}
#native-controls{position:absolute;left:0;bottom:0;width:100%;height:32px;pointer-events:auto}#native-quality{width:64px;height:24px}
#js-player-asideMain{position:absolute;left:698px;top:80px;width:380px;height:596px}#history-outer{width:380px;height:507px}#history-mid{width:380px;height:283px}
.Barrage{width:380px;height:283px}#scroll-a{width:380px;height:283px}#scroll-b{width:380px;height:237px}#scroll-c{width:380px;height:237px}#scroll-d{width:395px;height:252px}#js-barrage-list{width:380px;height:900px}
.layout-Player-chat{height:89px;width:380px}textarea{width:237px;height:42px}
</style></head><body><header id="outside-header"></header><main><div id="native-frame"><div id="js-player-video"><div id="media-wrapper"><video></video></div></div><div id="sdk-peer"><div id="sdk-a"><div id="sdk-b"><div class="danmu-root"><div class="danmu-message"></div></div><div class="DanmuAdvanced"></div><div id="native-controls"><button type="button" id="native-quality"></button></div></div></div></div></div><aside id="js-player-asideMain"><div id="history-outer"><div id="history-mid"><div class="Barrage"><div id="scroll-a"><div id="scroll-b"><div id="scroll-c"><div id="scroll-d"><ul id="js-barrage-list"></ul></div></div></div></div></div></div></div><div class="layout-Player-chat"><textarea></textarea></div></aside></main></body></html>`;
const probe=`(() => {const box=n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};const q=s=>document.querySelector(s),video=q('video'),peer=q('#sdk-peer'),danmu=q('.danmu-root'),button=q('#native-quality'),b=button.getBoundingClientRect();return {result:globalThis[Symbol.for('live-union.presentation.result')],viewport:{width:innerWidth,height:innerHeight},video:box(video),player:box(q('#js-player-video')),sdk:box(peer),danmu:box(danmu),sameVideo:video===globalThis.fixture.video,sameSdk:peer===globalThis.fixture.peer,parentsPreserved:video.parentElement===globalThis.fixture.videoParent&&danmu.parentElement===globalThis.fixture.danmuParent,danmuDisplay:getComputedStyle(danmu).display,advancedDisplay:getComputedStyle(q('.DanmuAdvanced')).display,nativeControlHit:document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===button,rootHidden:getComputedStyle(q('#outside-header')).display==='none',chatDisplay:getComputedStyle(q('#js-player-asideMain')).display,inlineRestored:[q('#native-frame'),q('#js-player-video'),peer,q('#sdk-a'),q('#sdk-b'),danmu,q('.DanmuAdvanced')].every(n=>n.style.cssText===globalThis.fixture.styles.get(n))};})()`;
(async()=>{
  const profile=path.resolve(process.argv.find(a=>a.startsWith('--profile='))?.slice(10)||'');
  if(path.dirname(profile)!==path.resolve(os.tmpdir())||!/^live-union-douyu-css-[a-z0-9]+$/i.test(path.basename(profile)))throw Error('Invalid fixture profile');
  app.setPath('userData',profile);await app.whenReady();const isolated=session.fromPartition('live-union-douyu-css',{cache:false});
  isolated.webRequest.onBeforeRequest((request,callback)=>callback({cancel:!request.url.startsWith('data:')}));
  const view=new BrowserWindow({show:false,width:1280,height:720,useContentSize:true,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false,offscreen:true}});
  const scenarios=[];
  try{
    for(const [width,height,chatVisible] of [[1280,720,false],[703,272,false],[524,272,true],[220,140,false]]){
      view.setContentSize(width,height);await view.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(markup));
      await view.webContents.executeJavaScript(`globalThis.fixture={video:document.querySelector('video'),peer:document.querySelector('#sdk-peer'),videoParent:document.querySelector('video').parentElement,danmuParent:document.querySelector('.danmu-root').parentElement,styles:new Map([...document.querySelectorAll('*')].map(n=>[n,n.style.cssText]))};Object.defineProperties(globalThis.fixture.video,{videoWidth:{value:1920},videoHeight:{value:1080}});`);
      await view.webContents.executeJavaScript(`globalThis.fixture.sdkStyleMutations=0;new MutationObserver(records=>{globalThis.fixture.sdkStyleMutations+=records.length}).observe(globalThis.fixture.peer,{attributes:true,attributeFilter:['style']})`);
      const prefs={compact:true,chatVisible,chatWidthDip:380};await view.webContents.executeJavaScript(build(prefs));await wait(200);
      const applied=await view.webContents.executeJavaScript(probe);
      const idleBefore=await view.webContents.executeJavaScript('globalThis.fixture.sdkStyleMutations');await wait(350);
      applied.idleSdkStyleMutations=(await view.webContents.executeJavaScript('globalThis.fixture.sdkStyleMutations'))-idleBefore;
      await view.webContents.executeJavaScript(`document.querySelector('.danmu-root').style.display='none'`);await wait(200);
      const hidden=await view.webContents.executeJavaScript(probe);
      await view.webContents.executeJavaScript(`document.querySelector('.danmu-root').style.removeProperty('display')`);await wait(200);
      const visibleAgain=await view.webContents.executeJavaScript(probe);
      await view.webContents.executeJavaScript(build({...prefs,compact:false}));await wait(50);
      const restored=await view.webContents.executeJavaScript(probe);
      restored.styleDifferences=await view.webContents.executeJavaScript(`['#native-frame','#js-player-video','#sdk-peer','#sdk-a','#sdk-b','.danmu-root','.DanmuAdvanced'].map(selector=>{const n=document.querySelector(selector);return {selector,before:globalThis.fixture.styles.get(n),after:n.style.cssText}}).filter(n=>n.before!==n.after)`);
      scenarios.push({requested:{width,height,chatVisible},applied,hidden,visibleAgain,restored});
    }
    console.log(marker+JSON.stringify({kind:'hidden-local-douyu-css',realPlatforms:false,mediaIntrinsicSynthetic:true,hiddenWindow:!view.isVisible(),offscreen:view.webContents.isOffscreen(),electron:process.versions.electron,chromium:process.versions.chrome,implementationSha256:crypto.createHash('sha256').update(await fs.readFile(path.resolve(__dirname,'../src/platforms/douyu/presentation.cjs'))).digest('hex'),scenarios}));
    for(const {requested,applied,hidden,visibleAgain,restored} of scenarios){
      assert.equal(applied.result.status,'applied');assert.equal(applied.sameVideo,true);assert.equal(applied.sameSdk,true);assert.equal(applied.parentsPreserved,true);
      assert.equal(applied.idleSdkStyleMutations,0,'stable viewport must not repeatedly mutate SDK styles');
      const near=(a,b)=>Math.abs(a-b)<=1;for(const key of ['x','y','width','height']){assert(near(applied.video[key],applied.sdk[key]));assert(near(applied.video[key],applied.danmu[key]));}
      assert(Math.abs(applied.video.width/applied.video.height-16/9)<.01);assert.equal(applied.rootHidden,true);assert.equal(applied.advancedDisplay,'none');
      assert.equal(applied.chatDisplay,requested.chatVisible?'block':'none');assert.equal(applied.nativeControlHit,true);
      assert.equal(hidden.result.status,'applied');assert.equal(hidden.danmuDisplay,'none');assert.equal(visibleAgain.result.status,'applied');assert(visibleAgain.danmu.width>0);
      assert.equal(restored.result.status,'restored');assert.equal(restored.inlineRestored,true);
    }
  }finally{view.destroy();}
})().then(()=>app.exit(0),()=>app.exit(1));
}
