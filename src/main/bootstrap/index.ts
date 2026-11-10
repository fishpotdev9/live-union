import { app, BaseWindow, BrowserWindow, WebContentsView, Menu, screen, session } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WorkspaceCatalog } from '../storage/catalog.ts';
import { createRuntimeManager } from '../views/index.ts';
import { createUiRegistry } from '../ipc/registry.ts';
import { UI_METRICS } from '../../shared/app-contracts.ts';
import { remotePreferences } from '../sessions/policy.ts';
import { Controller, emptyWorkspace, recoveredSnapshot } from './controller.ts';
import { importG0Sessions } from './profile.ts';
import { resolveRoom } from './resolve-room.ts';
import { adapter as huya } from '../../platforms/huya/index.ts';
import { adapter as douyu } from '../../platforms/douyu/index.ts';
import { adapter as bilibili } from '../../platforms/bilibili/index.ts';
import { installFixture, runSelfTest } from './self-test.ts';
import { startValidation } from './validation.ts';
import { HistoryRepository } from '../history/repository.ts';
import { RoomHistoryService } from '../history/service.ts';
import { resolveHistoryNickname } from '../history/metadata.ts';
import { resolveHistoryIdentity } from '../history/identity.ts';
import { AnchorNicknameLookup } from '../metadata/nickname.ts';

const selfTest=process.argv.includes('--self-test');
const hiddenTest=selfTest&&process.argv.includes('--self-test-hidden');
const publicNicknameTest=selfTest&&process.argv.includes('--self-test-public-nickname');
const testTokenValue=process.argv.find(arg=>arg.startsWith('--self-test-token='))?.slice('--self-test-token='.length);
const testToken=testTokenValue&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(testTokenValue)?testTokenValue:randomUUID();
const trace=(stage:string)=>{if(process.argv.includes('--lu-startup-stages'))console.log(`LIVE_UNION_STARTUP ${stage}`);};
app.setName('Live Union');app.setAppUserModelId('local.live-union');
app.setPath('userData',selfTest?join(tmpdir(),`live-union-self-test-${testToken}`):join(app.getPath('appData'),'Live Union'));
app.setPath('sessionData',app.getPath('userData'));
let mainWindow:BaseWindow|undefined,controller:Controller|undefined;
let shutdownStarted=false,shutdownComplete=false;
let stopValidation:(()=>void)|undefined;
let stopNicknameLookup:(()=>void)|undefined;
const primary=selfTest||app.requestSingleInstanceLock();
if(!primary)app.quit();
else{
  app.on('second-instance',()=>{if(mainWindow&&!mainWindow.isDestroyed()){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',event=>{
    if(shutdownComplete)return;
    event.preventDefault();if(shutdownStarted)return;shutdownStarted=true;
    stopValidation?.();
    stopNicknameLookup?.();
    void (async()=>{
      // Flush is bounded at shutdown, rather than leaving a hidden app indefinitely.
      await Promise.race([controller?.shutdown().catch(()=>undefined),new Promise(resolve=>setTimeout(resolve,5000))]);
      shutdownComplete=true;app.quit();
    })();
  });
  void app.whenReady().then(async()=>{
    trace('ready');
    Menu.setApplicationMenu(null);
    if(!selfTest&&process.argv.includes('--import-g0'))await importG0Sessions(app.getPath('userData'));
    trace('profile-ready');
    if(selfTest)await installFixture(session);
    const assets=join(__dirname,'assets'),preload=join(__dirname,'preload.cjs');
    const toolbarUrl=pathToFileURL(join(assets,'toolbar.html')).href;
    const roomUrl=(id:string)=>{const url=pathToFileURL(join(assets,'room.html'));url.searchParams.set('roomId',id);return url.href;};
    const area=screen.getPrimaryDisplay().workAreaSize;
    const win=mainWindow=new BaseWindow({title:selfTest?'Live Union · 本地整合测试':'Live Union',width:Math.min(2400,area.width-60),height:Math.min(1400,area.height-60),minWidth:980,minHeight:640,show:false,backgroundColor:'#0b1018',autoHideMenuBar:true});
    const toolbar=new WebContentsView({webPreferences:{...remotePreferences,preload}}),toolbarContents=toolbar.webContents;
    toolbarContents.setAudioMuted(true);
    toolbarContents.setWindowOpenHandler(()=>({action:'deny'}));
    const denyNavigation=(event:Electron.Event)=>event.preventDefault();
    toolbarContents.on('will-navigate',denyNavigation);
    toolbarContents.on('will-frame-navigate',denyNavigation);
    toolbarContents.on('will-attach-webview',denyNavigation);
    win.contentView.addChildView(toolbar);
    const canvas=()=>{const {width,height}=win.getContentBounds();return{width,height:Math.max(0,height-UI_METRICS.toolbarDip)};};
    const registry=createUiRegistry(command=>controller?controller.command(command):Promise.resolve({ok:false,error:'工作台正在启动'}),()=>controller?.state);
    trace('window-created');
    const releaseToolbar=registry.register(toolbarContents,toolbarUrl,'toolbar');
    const runtime=createRuntimeManager({window:win,chromeUrl:roomUrl,chromePreloadPath:preload,canvasOffset:{x:0,y:UI_METRICS.toolbarDip},registerChrome:(contents,id)=>registry.register(contents,roomUrl(id),'room',id),onEvent:event=>controller?.event(event)});
    const catalog=new WorkspaceCatalog(join(app.getPath('userData'),'Config'));
    let loaded:Awaited<ReturnType<typeof catalog.loadActive>>;
    let startupWarning='';
    try{loaded=await catalog.loadActive();}catch{loaded={source:'empty',entries:[],warnings:[]};startupWarning='现有配置无法读取，已保留文件并打开空工作台；保存状态将显示实际结果。';}
    trace('catalog-ready');
    const nicknameAttempts=new Map<string,number>();
    const nicknameLookup=new AnchorNicknameLookup({lookup:selfTest?async(address,signal)=>{
      const key=`${address.platform}:${address.platformRoomId}`,attempt=(nicknameAttempts.get(key)??0)+1;nicknameAttempts.set(key,attempt);
      if(publicNicknameTest&&address.platform==='douyu'&&['5566','74960','5556'].includes(address.platformRoomId))return resolveHistoryNickname(address,signal);
      if(address.platform==='douyu'&&address.platformRoomId==='200002'&&attempt===1)return undefined;
      return `测试主播${address.platformRoomId}`;
    }:resolveHistoryNickname,onNickname:(address,nickname)=>controller?.updateAnchorNickname(address,nickname)});
    stopNicknameLookup=()=>nicknameLookup.dispose();
    const history=new RoomHistoryService({
      store:new HistoryRepository(join(app.getPath('userData'),'Config','History')),
      sources:()=>catalog.historySources(),canonicalize:selfTest?address=>resolveRoom(address.canonicalUrl):resolveHistoryIdentity,
      nickname:nicknameLookup.resolve,
      changed:()=>controller?.publish(),
    });
    const layoutToolbar=(empty:boolean,historyOpen=false)=>{
      if(win.isDestroyed())return;
      const {width,height}=win.getContentBounds();
      toolbar.setBounds({x:0,y:0,width,height:empty?height:historyOpen?Math.min(height,UI_METRICS.toolbarDip+420):UI_METRICS.toolbarDip});
    };
    controller=new Controller({window:win,runtime,catalog,history,nickname:nicknameLookup.resolve,snapshot:recoveredSnapshot(loaded),entries:loaded.entries,canvas:canvas(),adapters:{huya,douyu,bilibili},resolveRoom,showMenu:items=>Menu.buildFromTemplate(items).popup({window:win}),publish:state=>{
      // A native view, not DOM z-index, covers room views while history is open.
      if(!win.isDestroyed())win.contentView.addChildView(toolbar);
      registry.publish(state);
    },layoutChrome:layoutToolbar});
    win.on('resize',()=>controller?.resize(canvas()));
    win.on('close',event=>{if(!shutdownComplete){event.preventDefault();app.quit();}});
    win.once('closed',()=>{registry.dispose();releaseToolbar();try{if(!toolbarContents.isDestroyed())toolbarContents.close({waitForBeforeUnload:false});}catch{}});
    trace('ui-loading');await toolbarContents.loadURL(toolbarUrl);trace('ui-ready');await controller.initialize();trace('runtime-ready');
    if(startupWarning)controller.warn(startupWarning);
    else if(loaded.warnings.length)controller.warn('已恢复较早备份，房间和设置可能较旧；声音已全部关闭，请核对。');
    if(selfTest){if(!hiddenTest)win.showInactive();}else{win.show();win.focus();}
    trace('shown');
    if(!selfTest&&!app.isPackaged&&process.argv.includes('--validation'))stopValidation=await startValidation({controller,runtime,window:win,toolbar:toolbarContents,quit:()=>app.quit()});
    else if(!selfTest&&process.argv.includes('--metrics'))stopValidation=await startValidation({controller,runtime,window:win,toolbar:toolbarContents,quit:()=>app.quit(),readOnly:true});
    if(selfTest){
      // Never-shown native child views may have no Viz surface. A separate
      // offscreen window renders the same trusted UI for layout/pixel checks.
      // Native view ordering/identity tests still use the actual workbench.
      const visual=hiddenTest?new BrowserWindow({show:false,width:980,height:548,useContentSize:true,webPreferences:{...remotePreferences,preload,offscreen:true}}):undefined;
      if(visual){const release=registry.register(visual.webContents,toolbarUrl,'toolbar');visual.once('closed',release);visual.webContents.setAudioMuted(true);visual.webContents.setWindowOpenHandler(()=>({action:'deny'}));await visual.loadURL(toolbarUrl);}
      const makeRoomVisual=async(id:string)=>{const url=roomUrl(id),view=new BrowserWindow({show:false,width:700,height:180,useContentSize:true,webPreferences:{...remotePreferences,preload,offscreen:true}});const release=registry.register(view.webContents,url,'room',id);view.once('closed',release);view.webContents.setAudioMuted(true);view.webContents.setWindowOpenHandler(()=>({action:'deny'}));await view.loadURL(url);return view;};
      await runSelfTest({controller,runtime,toolbar:toolbarContents,window:win,hidden:hiddenTest,visual,makeRoomVisual,publicNickname:publicNicknameTest,nicknameAttempts:()=>nicknameAttempts.get('douyu:200002')??0,toolbarBounds:()=>toolbar.getBounds(),toolbarTop:()=>win.contentView.children.at(-1)===toolbar,historyUpgrade:process.argv.includes('--self-test-history-upgrade'),restart:process.argv.includes('--self-test-restart'),cycles:process.argv.includes('--self-test-cycles'),quit:()=>app.quit()});
    }
  }).catch(()=>{
    trace('failed');
    // Do not log third-party URLs, cookies, exceptions or renderer text.
    console.error('Live Union could not start. Local configuration was preserved.');process.exitCode=1;app.quit();
  });
}
