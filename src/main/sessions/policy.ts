import type { BaseWindow, BrowserWindow, BrowserWindowConstructorOptions, Session, WebContents } from 'electron';
import type { PlatformId } from '../../shared/contracts.ts';
import { platformPartition } from '../../shared/platforms.ts';
import type { SessionPolicy } from '../runtime-contracts.ts';
import { allowedFrame, allowedLogin, allowedNavigation, PopupPermits } from './navigation.ts';

export const remotePreferences={nodeIntegration:false,nodeIntegrationInSubFrames:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,backgroundThrottling:false} as const;
type Blocked='navigation'|'popup'|'download'|'permission';
export interface SessionDependencies {
  fromPartition(partition:string):Session;
  createWindow(options:BrowserWindowConstructorOptions&{webContents?:WebContents}):BrowserWindow;
}
interface Registration {contents:WebContents;platform:PlatformId;ownerId:number;blocked:(category:Blocked)=>void;dispose:()=>void}

export function createSessionPolicy(parent:BaseWindow,native:SessionDependencies):SessionPolicy {
  const permits=new PopupPermits();
  const registrations=new Map<number,Registration>();
  const owners=new Map<number,Registration>();
  const popups=new Map<BrowserWindow,{owner:number;dispose:()=>void}>();
  const sessionDisposers=new Map<Session,()=>void>();
  let disposed=false;
  const partition=platformPartition;
  const report=(contents:WebContents|null,category:Blocked)=>{
    if(!disposed&&contents)registrations.get(contents.id)?.blocked(category);
  };
  function secureSession(value:Session):void {
    if(sessionDisposers.has(value))return;
    value.setPermissionCheckHandler(contents=>{report(contents,'permission');return false;});
    value.setPermissionRequestHandler((contents,_permission,callback)=>{callback(false);report(contents,'permission');});
    value.setDisplayMediaRequestHandler((_request,callback)=>callback({}));
    const download=(event:Electron.Event,_item:Electron.DownloadItem,contents:WebContents)=>{event.preventDefault();report(contents,'download');};
    value.on('will-download',download);
    sessionDisposers.set(value,()=>{
      value.removeListener('will-download',download);
      // Keep default-deny handlers installed on these private persistent sessions.
      value.setPermissionCheckHandler(()=>false);
      value.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
      value.setDisplayMediaRequestHandler((_request,callback)=>callback({}));
    });
  }
  function trackPopup(window:BrowserWindow,platform:PlatformId,owner:number):WebContents {
    const contents=window.webContents; // Stable even during closed/destroyed callbacks.
    const cleanup=configure(contents,platform,owner,category=>owners.get(owner)?.blocked(category));
    const closed=()=>{popups.delete(window);cleanup();};
    window.once('closed',closed);
    popups.set(window,{owner,dispose:()=>{window.removeListener('closed',closed);cleanup();}});
    return contents;
  }
  function configure(contents:WebContents,platform:PlatformId,ownerId:number,onBlocked:(category:Blocked)=>void):()=>void {
    if(disposed)throw new Error('Runtime session policy disposed');
    contents.setAudioMuted(true);
    secureSession(native.fromPartition(partition(platform)));
    let active=true;
    const blocked=(category:Blocked)=>{if(active&&!disposed)onBlocked(category);};
    const navigation=(event:Electron.Event<{url:string;isMainFrame:boolean}>)=>{
      if(!active)return;
      if(event.isMainFrame)permits.revoke(ownerId);
      if(!(event.isMainFrame?allowedNavigation(platform,event.url):allowedFrame(event.url))) {
        event.preventDefault();blocked('navigation');
      }
    };
    const start=(event:Electron.Event<{isMainFrame:boolean;isSameDocument:boolean}>)=>{
      if(event.isMainFrame&&!event.isSameDocument)permits.revoke(ownerId);
    };
    const webview=(event:Electron.Event)=>{event.preventDefault();blocked('navigation');};
    contents.on('will-frame-navigate',navigation);
    contents.on('will-redirect',navigation);
    contents.on('did-start-navigation',start);
    contents.on('will-attach-webview',webview);
    contents.setWindowOpenHandler(({url,disposition})=>{
      if(!active||disposed||!owners.has(ownerId)||!allowedLogin(platform,url)||disposition==='background-tab'||popups.size>=3||!permits.consume(ownerId)) {
        blocked('popup');return {action:'deny'};
      }
      return {
        action:'allow',
        overrideBrowserWindowOptions:{show:true,webPreferences:{...remotePreferences,partition:partition(platform)}},
        createWindow:options=>{
          // Electron 45 supplies the already-created contents here (G0 verified).
          // Its current createWindow declaration omits that runtime property.
          const supplied=options as BrowserWindowConstructorOptions&{webContents?:WebContents};
          if(disposed||!owners.has(ownerId)){
            if(supplied.webContents&&!supplied.webContents.isDestroyed())supplied.webContents.close({waitForBeforeUnload:false});
            throw new Error('Login owner no longer exists');
          }
          const window=native.createWindow({...options,webContents:supplied.webContents,width:1000,height:800,parent,autoHideMenuBar:true,webPreferences:{...remotePreferences,partition:partition(platform)}});
          return trackPopup(window,platform,ownerId);
        },
      };
    });
    const dispose=()=>{
      if(!active)return;
      active=false;
      registrations.delete(contents.id);
      if(owners.get(ownerId)?.contents===contents){owners.delete(ownerId);closeOwner(ownerId);}
      contents.removeListener('will-frame-navigate',navigation);
      contents.removeListener('will-redirect',navigation);
      contents.removeListener('did-start-navigation',start);
      contents.removeListener('will-attach-webview',webview);
      contents.removeListener('destroyed',dispose);
      if(!contents.isDestroyed())contents.setWindowOpenHandler(()=>({action:'deny'}));
    };
    const registration={contents,platform,ownerId,blocked,dispose};
    registrations.set(contents.id,registration);
    if(contents.id===ownerId)owners.set(ownerId,registration);
    contents.once('destroyed',dispose);
    return dispose;
  }
  function closeOwner(owner:number):void {
    permits.revoke(owner);
    for(const [window,popup] of [...popups])if(popup.owner===owner) {
      popups.delete(window);popup.dispose();
      try{if(!window.isDestroyed())window.destroy();}catch{/* A concurrent native close must not retain other owners. */}
    }
  }
  return {
    partition,configure,closeOwner,
    permit(owner){if(!disposed&&owners.has(owner))permits.permit(owner);},
    openLogin(platform,owner){
      const registration=owners.get(owner);
      if(disposed||!registration||registration.platform!==platform||registration.contents.isDestroyed())return;
      for(const [window,popup] of popups)if(popup.owner===owner&&!window.isDestroyed()){window.show();window.focus();return;}
      if(popups.size>=3){registration.blocked('popup');return;}
      const url=platform==='douyu'?'https://passport.douyu.com/member/login?client_id=1&lang=cn':registration.contents.getURL();
      if(!allowedNavigation(platform,url)){registration.blocked('navigation');return;}
      permits.revoke(owner);
      const window=native.createWindow({title:'Live Union · 原生登录',width:1000,height:800,parent,autoHideMenuBar:true,webPreferences:{...remotePreferences,partition:partition(platform)}});
      const contents=trackPopup(window,platform,owner);
      void contents.loadURL(url).catch(()=>{/* Navigation errors remain inside the native login window. */});
    },
    dispose(){
      if(disposed)return;
      disposed=true;permits.clear();
      for(const owner of [...owners.keys()])closeOwner(owner);
      for(const registration of [...registrations.values()])registration.dispose();
      for(const cleanup of sessionDisposers.values())cleanup();
      sessionDisposers.clear();owners.clear();registrations.clear();
    },
  };
}
