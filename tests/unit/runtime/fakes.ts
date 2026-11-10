import { EventEmitter } from 'node:events';
import type { BaseWindow, BrowserWindow, Session, View, WebContents, WebContentsView, WebPreferences } from 'electron';
import type { RoomConfig } from '../../../src/shared/contracts.ts';
import type { RuntimeEvent, RuntimeOptions } from '../../../src/main/runtime-contracts.ts';
import { createManager } from '../../../src/main/views/manager.ts';
import { createSessionPolicy } from '../../../src/main/sessions/policy.ts';

let nextId=0;
export class FakeContents extends EventEmitter {
  id=++nextId;destroyed=false;muted=false;audible=false;url='';
  loads:string[]=[];reloads=0;audioCalls:boolean[]=[];
  popupHandler:any=()=>({action:'deny'});
  preferences:WebPreferences;session?:FakeSession;
  constructor(preferences:WebPreferences={},session?:FakeSession){super();this.preferences=preferences;this.session=session;}
  isDestroyed(){return this.destroyed;}
  setAudioMuted(muted:boolean){if(this.destroyed)throw new Error('Destroyed contents');this.audioCalls.push(muted);this.muted=muted;}
  isAudioMuted(){if(this.destroyed)throw new Error('Destroyed contents');return this.muted;}
  isCurrentlyAudible(){if(this.destroyed)throw new Error('Destroyed contents');return this.audible;}
  getURL(){return this.url;}
  setWindowOpenHandler(handler:any){this.popupHandler=handler;}
  loadURL(url:string){this.loads.push(url);this.url=url;this.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});return Promise.resolve();}
  reload(){this.reloads++;this.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false});}
  ready(){this.emit('did-finish-load');}
  close(){if(this.destroyed)return;this.destroyed=true;this.emit('destroyed');}
}
export class FakeView {
  children:FakeView[]=[];bounds={x:0,y:0,width:0,height:0};visible=true;
  nativeCalls={addChildView:0,removeChildView:0,setBounds:0,setVisible:0};
  addChildView(view:FakeView){this.nativeCalls.addChildView++;this.children=this.children.filter(child=>child!==view);this.children.push(view);}
  removeChildView(view:FakeView){this.nativeCalls.removeChildView++;this.children=this.children.filter(child=>child!==view);}
  setBounds(bounds:typeof this.bounds){this.nativeCalls.setBounds++;this.bounds={...bounds};}
  setVisible(value:boolean){this.nativeCalls.setVisible++;this.visible=value;}
}
export class FakeWebView extends FakeView {
  webContents:FakeContents;
  constructor(webContents:FakeContents){super();this.webContents=webContents;}
}
export class FakeSession extends EventEmitter {
  check:any;request:any;display:any;
  setPermissionCheckHandler(handler:any){this.check=handler;}
  setPermissionRequestHandler(handler:any){this.request=handler;}
  setDisplayMediaRequestHandler(handler:any){this.display=handler;}
}
export class FakeWindow extends EventEmitter {
  destroyed=false;contentView=new FakeView();shown=false;focused=false;
  webContents:FakeContents;
  constructor(webContents:FakeContents=new FakeContents()){super();this.webContents=webContents;}
  isDestroyed(){return this.destroyed;}
  show(){this.shown=true;}
  focus(){this.focused=true;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.webContents.close();this.emit('closed');}
}
export function roomConfig(id:string,platform:RoomConfig['platform']='huya',allowed=false):RoomConfig {
  return {id,platform,platformRoomId:'123',canonicalUrl:`https://${platform==='bilibili'?'live.bilibili.com':`www.${platform}.com`}/123`,chat:{visible:true,preferredWidthDip:300},audio:{allowed}};
}
export function harness(){
  const sessions=new Map<string,FakeSession>();
  const windows:FakeWindow[]=[];
  const views:FakeWebView[]=[];
  const groups:FakeView[]=[];
  const events:RuntimeEvent[]=[];
  const registered=new Set<number>();
  const window=new FakeWindow();
  const getSession=(partition:string)=>{
    let value=sessions.get(partition);
    if(!value){value=new FakeSession();sessions.set(partition,value);}
    return value;
  };
  const policy=createSessionPolicy(window as unknown as BaseWindow,{
    fromPartition:partition=>getSession(partition) as unknown as Session,
    createWindow:options=>{
      const contents=options.webContents as unknown as FakeContents|undefined;
      const value=new FakeWindow(contents??new FakeContents(options.webPreferences,getSession(options.webPreferences?.partition??'')));
      windows.push(value);return value as unknown as BrowserWindow;
    },
  });
  const options:RuntimeOptions={
    window:window as unknown as BaseWindow,chromeUrl:id=>`file:///room.html?id=${id}`,chromePreloadPath:'C:/test/preload.cjs',canvasOffset:{x:0,y:128},
    registerChrome(contents){registered.add(contents.id);return ()=>{registered.delete(contents.id);};},
    onEvent:event=>events.push(event),
  };
  const manager=createManager(options,{
    createGroup:()=>{const group=new FakeView();groups.push(group);return group as unknown as View;},
    createWebView:preferences=>{
      const value=new FakeWebView(new FakeContents(preferences,getSession(preferences.partition??'')));
      views.push(value);return value as unknown as WebContentsView;
    },sessions:policy,
  });
  const contents=(id:string)=>manager.getContents(id) as unknown as FakeContents;
  return {manager,policy,contents,events,views,groups,windows,sessions,registered,window,options};
}
