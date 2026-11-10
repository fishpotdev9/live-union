'use strict';
// Anonymous, isolated/offscreen diagnosis only. No existing profile, credentials,
// message bodies, media URLs, canvas pixels or desktop input are accessed.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const baseline=process.argv.includes('--baseline');
const implementationFile=path.resolve(__dirname,baseline?'../.local/douyu-presentation-2026.11.07.2.cjs':'../src/platforms/douyu/presentation.cjs');
const {build}=require(implementationFile);
const roomArgument=process.argv.find(value=>value.startsWith('--room='));
const room=roomArgument?roomArgument.slice(7):'6770423';
if(!['6770423','5135383','88660'].includes(room))throw Error('Unsupported diagnostic room');
const marker='LIVE_UNION_DOUYU_DIAG ';
const sessionOnly=process.argv.includes('--session-only');
const selectors=['#js-player-video','#js-player-asideMain','video','[class*="danmu"]','[class*="Danmu"]','[class*="danmaku"]','[class*="barrage"]','[class*="Barrage"]'];
// Every value obtained from a remote renderer crosses this host allowlist.
const record=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const array=(v,max)=>Array.isArray(v)?v.slice(0,max):[];
const number=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e7?v:null;
const enumValue=(v,values)=>typeof v==='string'&&values.includes(v)?v:'unknown';
const safePath=v=>typeof v==='string'&&v.length<=1500&&/^(?:body|(?:html|body|div|span|section|main|aside|header|video|canvas|iframe|ul|li|button|\*):nth-child\([1-9][0-9]{0,4}\))(?: > (?:html|body|div|span|section|main|aside|header|video|canvas|iframe|ul|li|button|\*):nth-child\([1-9][0-9]{0,4}\)){0,31}$/.test(v)?v:null;
const box=value=>{const v=record(value);return Object.fromEntries(['x','y','width','height'].map(key=>[key,number(v[key])]));};
const geometry=value=>{const v=record(value);return {part:enumValue(v.part,['aligned','intrinsic','frame','player','sdk','video','danmu']),index:number(v.index),...(v.actual?{actual:box(v.actual)}:{}),...(v.expected?{expected:box(v.expected)}:{})};};
function safeNode(value){const v=record(value),opacity=number(v.opacity);return {
  path:safePath(v.path),tag:enumValue(v.tag,['HTML','BODY','DIV','SPAN','SECTION','MAIN','ASIDE','HEADER','VIDEO','CANVAS','IFRAME','UL','LI','BUTTON','OTHER']),box:box(v.box),children:number(v.children),
  ...(typeof v.editableCount==='number'?{inputTypes:array(v.inputTypes,32).map(type=>enumValue(type,['range','checkbox','radio','hidden','text','number','color','button','submit','search'])),editableCount:number(v.editableCount),nativeVideoCount:number(v.nativeVideoCount)}:{}),
  display:enumValue(v.display,['none','block','inline','inline-block','flex','inline-flex','grid','contents','other']),visibility:enumValue(v.visibility,['visible','hidden','collapse','other']),opacity:opacity!==null&&opacity>=0&&opacity<=1?opacity:null,
  position:enumValue(v.position,['static','relative','absolute','fixed','sticky','other']),zIndex:number(v.zIndex),overflowX:enumValue(v.overflowX,['visible','hidden','clip','scroll','auto','other']),overflowY:enumValue(v.overflowY,['visible','hidden','clip','scroll','auto','other']),
  ...Object.fromEntries(['transformed','inlineImportantHidden','underPlayer','underAside','containsVideo'].map(key=>[key,typeof v[key]==='boolean'?v[key]:null]))
};}
function safeSnapshot(value){const v=record(value),viewport=record(v.viewport);return {
  viewport:Object.fromEntries(['width','height','dpr'].map(key=>[key,number(viewport[key])])),canvasCount:number(v.canvasCount),
  frame:v.frame?safeNode(v.frame):null,frameChildren:array(v.frameChildren,8).map(safeNode),
  intrinsic:{width:number(record(v.intrinsic).width),height:number(record(v.intrinsic).height)},
  danmuChains:array(v.danmuChains,6).map(chain=>array(chain,14).map(safeNode)),
  canvases:array(v.canvases,16).map(value=>{const c=record(value);return {...safeNode(c),backingWidth:number(c.backingWidth),backingHeight:number(c.backingHeight),ancestors:array(c.ancestors,10).map(safeNode)};}),
  semantic:array(v.semantic,selectors.length).map(record).filter(s=>selectors.includes(s.selector)).map(s=>({selector:s.selector,count:number(s.count),nodes:array(s.nodes,6).map(safeNode)}))
};}
function safeReport(value){const v=record(value);return {
  kind:'anonymous-douyu-structure',at:typeof v.at==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.at)?v.at:null,room,
  anonymous:v.anonymous===true,hidden:v.hidden===true,existingSessionUsed:v.existingSessionUsed===true,settingsChanged:v.settingsChanged===true,
  electron:typeof v.electron==='string'&&/^[0-9.]{3,30}$/.test(v.electron)?v.electron:null,chromium:typeof v.chromium==='string'&&/^[0-9.]{3,30}$/.test(v.chromium)?v.chromium:null,
  implementationSha256:typeof v.implementationSha256==='string'&&/^[a-f0-9]{64}$/.test(v.implementationSha256)?v.implementationSha256:null,
  phases:array(v.phases,4).map(record).filter(p=>['native-initial','compact-immediate','compact-settled','native-restored'].includes(p.name)).map(p=>({name:p.name,
    ...(p.presentation?{presentation:{status:enumValue(record(p.presentation).status,['applied','restored','unsupported','failed','notReady']),reason:enumValue(record(p.presentation).reason,['native-page','candidate-layout','controls-need-zoom','native-structure','native-send-geometry','chat-ancestry','native-scroll-geometry','player-depth','native-geometry','structure-changed','insufficient-space','insufficient-chat-space','native-overlay','probe-error'])}}:{}),
    ...(p.geometry?{geometry:geometry(p.geometry)}:{}),structureCheckpoint:number(p.structureCheckpoint),snapshot:safeSnapshot(p.snapshot)}))
};}
if(!process.versions.electron&&require.main!==module){module.exports={safeSnapshot,safeReport};}
else if(!process.versions.electron){
  const {spawn}=require('node:child_process');
  (async()=>{
    const directory=await fs.mkdtemp(path.join(os.tmpdir(),'live-union-douyu-diag-'));
    let report,code;
    try{
      code=await new Promise((resolve,reject)=>{
        const child=spawn(require('electron'),[__filename,'--profile='+directory,'--room='+room,...(sessionOnly?['--session-only']:[]),...(baseline?['--baseline']:[])],{windowsHide:true,stdio:['ignore','pipe','ignore']});
        const timer=setTimeout(()=>child.kill(),45000);let pending='';
        child.stdout.on('data',data=>{pending+=data.toString('utf8');const lines=pending.split(/\r?\n/);pending=lines.pop().slice(-1048576);
          for(const line of lines)if(line.startsWith(marker))try{report=JSON.parse(line.slice(marker.length));}catch{}
        });
        child.once('error',error=>{clearTimeout(timer);reject(error);});
        child.once('exit',value=>{clearTimeout(timer);resolve(value);});
      });
      if(!report||code!==0){
        const stage=enumValue(report?.stage,['profile','ready','load','wait','probe','compact','restore','finish']);
        const local=path.resolve(__dirname,'../.local');await fs.mkdir(local,{recursive:true});
        await fs.writeFile(path.join(local,'douyu-diagnosis-failed.json'),JSON.stringify({kind:'anonymous-douyu-structure-failed',stage,timeout:code===null,existingSessionUsed:false},null,2)+'\n');
        console.log(JSON.stringify({kind:'anonymous-douyu-structure-failed',stage,timeout:code===null}));
        throw Error('Diagnostic did not complete');
      }
      if(!sessionOnly)report=safeReport(report);
      const local=path.resolve(__dirname,'../.local');await fs.mkdir(local,{recursive:true});
      const filename=sessionOnly?'session-fetch-diagnosis.json':baseline?'douyu-diagnosis-baseline.json':'douyu-diagnosis-'+room+'.json';
      await fs.writeFile(path.join(local,filename),JSON.stringify(report,null,2)+'\n');
      console.log(JSON.stringify(sessionOnly?report:{kind:report.kind,anonymous:true,hidden:true,room,phases:report.phases.map(p=>({name:p.name,status:p.presentation?.status,canvasCount:p.snapshot.canvasCount,semanticCounts:p.snapshot.semantic.map(s=>({selector:s.selector,count:s.count}))})),report:'.local/'+filename}));
    }finally{
      const target=path.resolve(directory),base=path.resolve(os.tmpdir());
      if(path.dirname(target)!==base||!/^live-union-douyu-diag-[a-z0-9]+$/i.test(path.basename(target))||await fs.realpath(target)!==path.join(await fs.realpath(base),path.basename(target)))throw Error('Unexpected diagnosis cleanup target');
      async function regularTree(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
        if(entry.isSymbolicLink())throw Error('Diagnosis link refused');
        if(entry.isDirectory())await regularTree(path.join(dir,entry.name));else if(!entry.isFile())throw Error('Diagnosis entry refused');
      }}
      await regularTree(target);await fs.rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    }
  })().catch(()=>{console.error('Isolated Douyu diagnosis failed; existing app/session untouched.');process.exitCode=1;});
}else{
const {app,BrowserWindow,session}=require('electron');
app.disableHardwareAcceleration();app.setName('Live Union anonymous diagnosis');
let stage='profile';
const probe=`(() => {
  const number=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e7?v:null;
  const enums=(v,values)=>values.includes(v)?v:'other';
  const tags=['HTML','BODY','DIV','SPAN','SECTION','MAIN','ASIDE','HEADER','VIDEO','CANVAS','IFRAME','UL','LI','BUTTON'];
  const player=document.querySelector('#js-player-video'),aside=document.querySelector('#js-player-asideMain');
  const path=n=>{const parts=[];for(let p=n;p&&p!==document.documentElement&&parts.length<32;p=p.parentElement){
    if(p===document.body){parts.unshift('body');break;}
    parts.unshift((tags.includes(p.tagName)?p.tagName.toLowerCase():'*')+':nth-child('+(Array.prototype.indexOf.call(p.parentElement?.children||[],p)+1)+')');
  }return parts.join(' > ');};
  const box=n=>{const b=n.getBoundingClientRect();return {x:number(b.x),y:number(b.y),width:number(b.width),height:number(b.height)};};
  const node=n=>{const s=getComputedStyle(n);return {path:path(n),tag:tags.includes(n.tagName)?n.tagName:'OTHER',box:box(n),children:Math.min(n.children.length,10000),
    display:enums(s.display,['none','block','inline','inline-block','flex','inline-flex','grid','contents']),visibility:enums(s.visibility,['visible','hidden','collapse']),opacity:number(Number(s.opacity)),
    position:enums(s.position,['static','relative','absolute','fixed','sticky']),zIndex:number(Number.parseFloat(s.zIndex)),overflowX:enums(s.overflowX,['visible','hidden','clip','scroll','auto']),overflowY:enums(s.overflowY,['visible','hidden','clip','scroll','auto']),
    transformed:s.transform!=='none',inlineImportantHidden:n.style.getPropertyValue('display')==='none'&&n.style.getPropertyPriority('display')==='important',
    underPlayer:!!player&&player.contains(n),underAside:!!aside&&aside.contains(n),containsVideo:!!n.querySelector('video')};};
  const canvases=[...document.querySelectorAll('canvas')].slice(0,16).map(c=>{const ancestors=[];for(let n=c;n&&ancestors.length<10;n=n.parentElement)ancestors.push(node(n));return {...node(c),backingWidth:number(c.width),backingHeight:number(c.height),ancestors};});
  const selectors=['#js-player-video','#js-player-asideMain','video','[class*="danmu"]','[class*="Danmu"]','[class*="danmaku"]','[class*="barrage"]','[class*="Barrage"]'];
  const frame=player?.parentElement,semantic='[class*="danmu"],[class*="Danmu"]';
  const roots=frame?[...frame.querySelectorAll(semantic)].filter(n=>{if(player.contains(n))return false;for(let p=n.parentElement;p&&p!==frame;p=p.parentElement)if(p.matches(semantic))return false;return true;}).slice(0,6):[];
  const danmuChains=roots.map(root=>{const chain=[];for(let n=root;n&&n!==frame&&chain.length<14;n=n.parentElement)chain.push(node(n));return chain;});
  const nativeVideo=player?[...player.querySelectorAll('video')].find(v=>v.getBoundingClientRect().width>1&&v.getBoundingClientRect().height>1):null;
  return {viewport:{width:number(innerWidth),height:number(innerHeight),dpr:number(devicePixelRatio)},canvasCount:Math.min(document.querySelectorAll('canvas').length,1000),canvases,
    frame:frame?node(frame):null,frameChildren:frame?[...frame.children].slice(0,8).map(n=>({...node(n),inputTypes:[...n.querySelectorAll('input')].slice(0,32).map(input=>enums(input.type,['range','checkbox','radio','hidden','text','number','color','button','submit','search'])),editableCount:Math.min(n.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]').length,10000),nativeVideoCount:Math.min(n.querySelectorAll('video').length,10000)})):[],danmuChains,intrinsic:{width:number(nativeVideo?.videoWidth),height:number(nativeVideo?.videoHeight)},
    semantic:selectors.map(selector=>{const found=document.querySelectorAll(selector);return {selector,count:Math.min(found.length,1000),nodes:[...found].slice(0,6).map(node)};})};
})()`;
(async()=>{
  const profile=path.resolve(process.argv.find(a=>a.startsWith('--profile='))?.slice(10)||'');
  if(path.dirname(profile)!==path.resolve(os.tmpdir())||!/^live-union-douyu-diag-[a-z0-9]+$/i.test(path.basename(profile)))throw Error('Invalid diagnostic profile');
  app.setPath('userData',profile);await app.whenReady();stage='ready';
  if(sessionOnly){
    const http=require('node:http');
    const client=session.fromPartition('live-union-dummy-cookie-diagnosis',{cache:false});
    const received=[];
    const server=http.createServer((request,response)=>{
      received.push((request.headers.cookie||'').split(';').some(item=>item.trim()==='lu_dummy_auth=fixture'));
      response.setHeader('Set-Cookie','lu_dummy_auth=deleted; Max-Age=0; Path=/');response.end('fixture');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const origin='http://127.0.0.1:'+server.address().port;
      const set=()=>client.cookies.set({url:origin,name:'lu_dummy_auth',value:'fixture',expirationDate:Date.now()/1000+3600});
      await set();await(await client.fetch(origin,{credentials:'omit'})).text();
      const omitKeptFixtureCookie=(await client.cookies.get({url:origin,name:'lu_dummy_auth'})).some(c=>c.value==='fixture');
      await set();await(await client.fetch(origin,{credentials:'include'})).text();
      const includeDeletedFixtureCookie=(await client.cookies.get({url:origin,name:'lu_dummy_auth'})).length===0;
      console.log(marker+JSON.stringify({kind:'isolated-session-fetch',at:new Date().toISOString(),electron:process.versions.electron,realPlatform:false,existingSessionUsed:false,dummyCookieOnly:true,omitSentFixtureCookie:received[0]===true,omitKeptFixtureCookie,includeSentFixtureCookie:received[1]===true,includeDeletedFixtureCookie}));
    }finally{await new Promise(resolve=>server.close(resolve));}
    app.exit(0);return;
  }
  const isolated=session.fromPartition('live-union-anonymous-douyu',{cache:false});
  isolated.setPermissionCheckHandler(()=>false);isolated.setPermissionRequestHandler((_c,_p,cb)=>cb(false));
  isolated.on('will-download',event=>event.preventDefault());
  const view=new BrowserWindow({show:false,width:1280,height:900,useContentSize:true,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false,offscreen:true}});
  view.webContents.setAudioMuted(true);view.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  view.webContents.on('will-navigate',event=>event.preventDefault());
  stage='load';await Promise.race([view.loadURL('https://www.douyu.com/'+room),wait(20000).then(()=>{throw Error('Load timeout');})]);
  stage='wait';await wait(7000);
  const phases=[];
  const snapshot=async name=>{const observation=await view.webContents.executeJavaScript(`({presentation:globalThis[Symbol.for('live-union.presentation.result')],geometry:globalThis[Symbol.for('live-union.douyu.presentation.geometry')],structureCheckpoint:globalThis[Symbol.for('live-union.douyu.diagnostic.checkpoint')]})`);phases.push({name,...(observation?.presentation?{presentation:observation.presentation}:{}),...(observation?.geometry?{geometry:geometry(observation.geometry)}:{}),structureCheckpoint:number(observation?.structureCheckpoint),snapshot:safeSnapshot(await view.webContents.executeJavaScript(probe))});};
  stage='probe';await snapshot('native-initial');
  view.setContentSize(703,272);await wait(500);
  const prefs={compact:true,chatVisible:false,chatWidthDip:380};
  // Fixed local source instrumentation: numbered structural failure sites only.
  // No page-supplied source, attributes, message text or exceptions are emitted.
  let checkpoint=0;
  const diagnosticSource=build(prefs).replaceAll("return result('unsupported', 'native-structure');",()=>`return (globalThis[Symbol.for('live-union.douyu.diagnostic.checkpoint')]=${++checkpoint},result('unsupported', 'native-structure'));`);
  stage='compact';const presentation=await view.webContents.executeJavaScript(diagnosticSource);
  await snapshot('compact-immediate');phases.at(-1).presentation={status:enumValue(presentation?.status,['applied','restored','unsupported','failed','notReady']),reason:enumValue(presentation?.reason,['candidate-layout','controls-need-zoom','native-structure','native-send-geometry','chat-ancestry','native-scroll-geometry','player-depth','native-geometry','structure-changed','insufficient-space','insufficient-chat-space','native-overlay','probe-error'])};
  await wait(2500);await snapshot('compact-settled');
  stage='restore';await view.webContents.executeJavaScript(build({...prefs,compact:false}));await wait(500);await snapshot('native-restored');
  if(view.isVisible())throw Error('Diagnostic became visible');
  const implementationSha256=crypto.createHash('sha256').update(await fs.readFile(implementationFile)).digest('hex');
  stage='finish';console.log(marker+JSON.stringify({kind:'anonymous-douyu-structure',at:new Date().toISOString(),room,anonymous:true,hidden:true,existingSessionUsed:false,settingsChanged:false,electron:process.versions.electron,chromium:process.versions.chrome,implementationSha256,phases}));
  app.exit(0);
})().catch(()=>{console.log(marker+JSON.stringify({kind:'anonymous-douyu-structure-failed',stage}));app.exit(1);});
}
