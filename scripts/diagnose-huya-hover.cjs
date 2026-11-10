'use strict';
// Anonymous hidden/offscreen native-hover diagnosis. No desktop input, existing
// sessions, account values, message text, media addresses or screenshots.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const baseline=process.argv.includes('--baseline');
const sourceFile=path.resolve(__dirname,baseline?'../.local/huya-presentation-2026.11.07.7.cjs':'../src/platforms/huya/presentation.cjs');
const {build}=require(sourceFile),marker='LIVE_UNION_HUYA_HOVER ';
const num=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e6?v:null;
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const en=(v,a)=>typeof v==='string'&&a.includes(v)?v:'unknown';
const bool=v=>typeof v==='boolean'?v:null;
const box=v=>Object.fromEntries(['x','y','width','height'].map(k=>[k,num(obj(v)[k])]));
const styleNames=['width','min-width','max-width','height','box-sizing','position','left','right','top','bottom','transform'];
function safeDiagnostic(value){const v=obj(value);return {
  controlsRepairs:num(v.controlsRepairs),visibilityRepairs:num(v.visibilityRepairs),shown:bool(v.shown),controlsMatch:bool(v.controlsMatch),visibilityMatches:bool(v.visibilityMatches),
  controls:box(v.controls),opacity:num(v.opacity),
  properties:(Array.isArray(v.properties)?v.properties:[]).slice(0,styleNames.length).map(obj).filter(p=>styleNames.includes(p.name)).map(p=>({name:p.name,same:bool(p.same),important:bool(p.important),delta:num(p.delta)}))
};}
function safeSnapshot(value){const v=obj(value),g=obj(v.geometry);return {
  phase:en(v.phase,['initial','hover','idle','resized']),samePresentation:bool(v.samePresentation),
  result:{status:en(obj(v.result).status,['applied','unsupported','notReady','failed','restored']),reason:en(obj(v.result).reason,['controls-need-zoom','layout','chat-layout','structure','structure-changed','player-structure','space','layout-error','player-not-ready','input-not-ready'])},
  viewport:{width:num(obj(v.viewport).width),height:num(obj(v.viewport).height)},
  media:{width:num(obj(v.media).width),height:num(obj(v.media).height),paused:bool(obj(v.media).paused)},
  structure:(Array.isArray(v.structure)?v.structure:[]).slice(0,8).map(num),
  playerHovered:bool(v.playerHovered),controlsHovered:bool(v.controlsHovered),geometry:{stage:box(g.stage),video:box(g.video),controls:box(g.controls)},
  failure:v.failure?safeDiagnostic(v.failure):null
};}
if(!process.versions.electron&&require.main!==module){module.exports={safeSnapshot};}
else if(!process.versions.electron){
  const {spawn}=require('node:child_process');
  (async()=>{
    const profile=await fs.mkdtemp(path.join(os.tmpdir(),'live-union-huya-hover-'));let report,code;
    try{
      code=await new Promise((resolve,reject)=>{
        const child=spawn(require('electron'),[__filename,'--profile='+profile,...(baseline?['--baseline']:[])],{windowsHide:true,stdio:['ignore','pipe','ignore']});
        let pending='';const timer=setTimeout(()=>child.kill(),75000);
        child.stdout.on('data',data=>{pending+=data.toString('utf8');const lines=pending.split(/\r?\n/);pending=lines.pop().slice(-1048576);for(const line of lines)if(line.startsWith(marker))try{report=JSON.parse(line.slice(marker.length));}catch{}});
        child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',value=>{clearTimeout(timer);resolve(value);});
      });
      if(!report||code!==0){console.log(JSON.stringify({completed:false,stage:en(report?.stage,['ready','load','wait','apply','hover','finish'])}));throw Error('Diagnosis incomplete');}
      const safe={kind:'anonymous-hidden-huya-hover',at:new Date().toISOString(),room:'340204',existingSessionUsed:false,desktopInput:false,hidden:report.hidden===true,
        sourceSha256:await fs.readFile(sourceFile).then(b=>crypto.createHash('sha256').update(b).digest('hex')),baseline,syntheticAnonymousSender:report.syntheticAnonymousSender===true,initialNativeHoverPrepared:report.initialNativeHoverPrepared===true,
        samples:(Array.isArray(report.samples)?report.samples:[]).slice(0,45).map(safeSnapshot)};
      const filename='huya-hover-'+(baseline?'baseline':'candidate')+'.json';
      await fs.writeFile(path.resolve(__dirname,'../.local',filename),JSON.stringify(safe,null,2)+'\n');
      console.log(JSON.stringify({completed:true,hidden:safe.hidden,samples:safe.samples.length,first:safe.samples[0],last:safe.samples.at(-1),report:'.local/'+filename}));
    }finally{
      const absolute=path.resolve(profile),base=path.resolve(os.tmpdir());
      if(path.dirname(absolute)!==base||!/^live-union-huya-hover-[a-z0-9]+$/i.test(path.basename(absolute))||await fs.realpath(absolute)!==path.join(await fs.realpath(base),path.basename(absolute)))throw Error('Cleanup target refused');
      async function regular(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())throw Error('Link refused');if(e.isDirectory())await regular(path.join(dir,e.name));else if(!e.isFile())throw Error('Entry refused');}}
      await regular(absolute);await fs.rm(absolute,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  })().catch(()=>{console.error('Hidden anonymous Huya diagnosis incomplete; existing app untouched.');process.exitCode=1;});
}else{
  const {app,BrowserWindow,session}=require('electron');app.disableHardwareAcceleration();app.setName('Live Union anonymous hover diagnosis');
  let stage='ready';
  const flush=value=>new Promise(resolve=>process.stdout.write(marker+JSON.stringify(value)+'\n',resolve));
  const inspect=`(() => {const refs=globalThis[Symbol.for('live-union.huya.hover-target')],v=refs?.video||document.querySelector('#J_playerMain video'),original=globalThis[Symbol.for('live-union.huya.hover-original')];return {samePresentation:!!original&&original===globalThis[Symbol.for('live-union.huya.presentation.v1')],result:globalThis[Symbol.for('live-union.presentation.result')],geometry:globalThis[Symbol.for('live-union.huya.geometry')],failure:globalThis[Symbol.for('live-union.huya.hover-failure')],viewport:{width:innerWidth,height:innerHeight},media:{width:v?.videoWidth,height:v?.videoHeight,paused:v?.paused},playerHovered:refs?.player.matches(':hover'),controlsHovered:refs?.controls.matches(':hover'),structure:['#J_playerMain','#J_roomPlayerLayer','#chat-room__list','#chatRoom','.room-core','.player-wrap','#J_playerMain video','.room-core textarea,.room-core [contenteditable="true"]'].map(s=>document.querySelectorAll(s).length)};})()`;
  (async()=>{
    const profile=path.resolve(process.argv.find(a=>a.startsWith('--profile='))?.slice(10)||'');
    if(path.dirname(profile)!==path.resolve(os.tmpdir())||!/^live-union-huya-hover-[a-z0-9]+$/i.test(path.basename(profile)))throw Error('Profile refused');
    app.setPath('userData',profile);await app.whenReady();
    const isolated=session.fromPartition('live-union-huya-hover-anonymous',{cache:false});
    isolated.setPermissionCheckHandler(()=>false);isolated.setPermissionRequestHandler((_w,_p,cb)=>cb(false));isolated.on('will-download',e=>e.preventDefault());
    const view=new BrowserWindow({show:false,width:1280,height:900,useContentSize:true,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,offscreen:true,backgroundThrottling:false}});
    view.webContents.setAudioMuted(true);view.webContents.setWindowOpenHandler(()=>({action:'deny'}));view.webContents.on('will-navigate',e=>e.preventDefault());
    stage='load';await Promise.race([view.loadURL('https://www.huya.com/340204'),wait(20000).then(()=>{throw Error('Load timeout');})]);
    stage='wait';await wait(8000);
    for(let i=0;i<12;i++){
      if(await view.webContents.executeJavaScript(`document.querySelectorAll('#J_playerMain video').length===1&&document.querySelector('#J_playerMain video')?.videoWidth>0`))break;
      await wait(1000);
    }
    view.setContentSize(1094,470);await wait(500);
    // The anonymous page has no native editor. Add an explicitly synthetic,
    // empty sender only to exercise the real native player/hover mechanism;
    // this experiment can never establish native chat or login compatibility.
    const syntheticAnonymousSender=await view.webContents.executeJavaScript(`(() => {const core=document.querySelector('.room-core'),list=document.querySelector('#chat-room__list');if(!core||!list||core.querySelector('textarea,[contenteditable="true"]'))return false;const parent=list.parentElement;if(!parent||parent===core)return false;const wrapper=document.createElement('div');wrapper.style.height='99px';const input=document.createElement('textarea');input.style.height='48px';wrapper.appendChild(input);parent.appendChild(wrapper);return true;})()`);
    const point=await view.webContents.executeJavaScript(`(() => {const p=document.querySelector('#J_playerMain');if(!p)return null;p.scrollIntoView({block:'center'});const r=p.getBoundingClientRect();return {x:Math.max(0,Math.min(innerWidth-1,r.x+r.width/2)),y:Math.max(0,Math.min(innerHeight-1,r.y+Math.min(r.height/2,200)))}})()`);
    const initialNativeHoverPrepared=Number.isFinite(point?.x)&&Number.isFinite(point?.y)&&point.x>=0&&point.y>=0&&point.x<16000&&point.y<16000;
    if(initialNativeHoverPrepared){view.webContents.sendInputEvent({type:'mouseMove',x:Math.round(point.x),y:Math.round(point.y)});await wait(300);}
    // Instrument only fixed local source, before rollback. No page source is
    // copied/executed and only a numeric/boolean whitelist leaves the renderer.
    let source=build({compact:true,chatVisible:false,chatWidthDip:340});
    source=source.replace('const state = {',"globalThis[Symbol.for('live-union.huya.hover-target')]={controls,player,video}; const state = {");
    source=source.replace('function dispose(status, reason) {',`function dispose(status, reason) {
      if(reason==='layout') {const rect=controls.getBoundingClientRect();globalThis[Symbol.for('live-union.huya.hover-failure')]={controlsRepairs,visibilityRepairs,shown:controlsShown,controlsMatch:controlsMatch(),visibilityMatches:visibilityMatches(),controls:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},opacity:parseFloat(window.getComputedStyle(controls).getPropertyValue('opacity')),properties:[...ownedControlStyles].map(([name,r])=>{const current=controls.style.getPropertyValue(name);return{name,same:current===r.applied,important:controls.style.getPropertyPriority(name)==='important',delta:parseFloat(current)-parseFloat(r.applied)}})}}
    `);
    stage='apply';await view.webContents.executeJavaScript(source);const samples=[];
    await view.webContents.executeJavaScript(`globalThis[Symbol.for('live-union.huya.hover-original')]=globalThis[Symbol.for('live-union.huya.presentation.v1')]`);
    const sample=async phase=>samples.push(safeSnapshot({...await view.webContents.executeJavaScript(inspect),phase}));
    await wait(300);await sample('initial');stage='hover';
    for(let i=0;i<16;i++){
      view.webContents.sendInputEvent({type:'mouseMove',x:i%2?700:300,y:i%3?160:450});await wait(100);await sample('hover');
      if(samples.at(-1).result.status!=='applied')break;
    }
    await wait(2000);await sample('idle');
    if(samples.at(-1).result.status==='applied'){
      view.webContents.sendInputEvent({type:'mouseLeave',x:-1,y:-1});await wait(1800);
      for(const [width,height] of [[703,272],[1094,470]]){
        view.setContentSize(width,height);await wait(300);
        await view.webContents.executeJavaScript(build({compact:true,chatVisible:false,chatWidthDip:340}));await wait(300);await sample('resized');
      }
    }
    stage='finish';await flush({hidden:!view.isVisible(),syntheticAnonymousSender,initialNativeHoverPrepared,samples});view.destroy();app.exit(0);
  })().catch(async()=>{await flush({stage});app.exit(1);});
}
