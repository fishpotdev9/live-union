import type { View, WebContents, WebContentsView, WebPreferences } from 'electron';
import type { RoomConfig, RoomGeometry, RoomId } from '../../shared/contracts.ts';
import type { RoomRuntimeManager, RuntimeIdentity, RuntimeOptions, SessionPolicy } from '../runtime-contracts.ts';
import { AudioPolicy } from '../audio/policy.ts';
import { allowedNavigation } from '../sessions/navigation.ts';
import { remotePreferences } from '../sessions/policy.ts';
import { nativeGeometry } from './geometry.ts';

export interface ViewDependencies {
  createGroup():View;
  createWebView(preferences:WebPreferences):WebContentsView;
  sessions:SessionPolicy;
}
interface Room {
  id:RoomId;platform:RoomConfig['platform'];identity:RuntimeIdentity;
  group:View;chrome:WebContentsView;page:WebContentsView;
  contents:WebContents;chromeContents:WebContents;
  closed:boolean;documentNavigations:number;cleanups:Array<()=>void>;
  geometry?:NonNullable<ReturnType<typeof nativeGeometry>>;visible:boolean;
}
export function createManager(options:RuntimeOptions,native:ViewDependencies):RoomRuntimeManager {
  const rooms=new Map<RoomId,Room>();
  const audio=new AudioPolicy();
  let disposed=false,geometryRevision=-1;
  let nextGeneration=0;
  let zOrder:RoomId[]=[];
  function current(room:Room):boolean {return !disposed&&!room.closed&&rooms.get(room.id)===room;}
  function alive(room:Room):boolean {return current(room)&&!room.contents.isDestroyed();}
  function identity(room:Room):RuntimeIdentity {return {...room.identity};}
  function navigation(room:Room,state:'loading'|'ready'|'error',errorCode?:number):void {
    if(current(room))options.onEvent({kind:'navigation',identity:identity(room),state,documentNavigations:room.documentNavigations,...(errorCode===undefined?{}:{errorCode})});
  }
  function observeAudio(room:Room):void {
    if(!alive(room))return;
    try {options.onEvent({kind:'audio',identity:identity(room),pageAudioActive:room.contents.isCurrentlyAudible(),containerMuted:room.contents.isAudioMuted()});}
    catch {/* A native contents handle can disappear during shutdown. */}
  }
  function closeContents(contents:WebContents):void {
    try {if(!contents.isDestroyed())contents.setAudioMuted(true);}catch{/* Still close if muting failed. */}
    try {if(!contents.isDestroyed())contents.close({waitForBeforeUnload:false});}catch{/* Already closing. */}
  }
  function closeRoom(id:RoomId):void {
    const room=rooms.get(id);
    if(!room)return;
    room.closed=true;rooms.delete(id); // Invalidate before any native callback.
    zOrder=zOrder.filter(value=>value!==id);
    audio.remove(id);
    try{native.sessions.closeOwner(room.identity.webContentsId);}catch{/* Release the room even if a popup is already closing. */}
    for(const cleanup of room.cleanups.splice(0).reverse())try{cleanup();}catch{/* Continue releasing other handles. */}
    try{options.window.contentView.removeChildView(room.group);}catch{/* Parent may already be closed. */}
    try{room.group.removeChildView(room.page);room.group.removeChildView(room.chrome);}catch{/* Native teardown may have detached them. */}
    closeContents(room.contents);closeContents(room.chromeContents);
  }
  const manager:RoomRuntimeManager={
    async createRoom(config){
      if(disposed)throw new Error('Runtime manager disposed');
      const existing=rooms.get(config.id);
      if(existing)return identity(existing);
      if(!allowedNavigation(config.platform,config.canonicalUrl))throw new Error('Unsupported room navigation');
      const chromeUrl=options.chromeUrl(config.id);
      if(new URL(chromeUrl).protocol!=='file:')throw new Error('Room chrome must be local');
      const group=native.createGroup();
      let chrome:WebContentsView|undefined,page:WebContentsView|undefined,room:Room|undefined;
      try {
        chrome=native.createWebView({...remotePreferences,preload:options.chromePreloadPath});
        page=native.createWebView({...remotePreferences,partition:native.sessions.partition(config.platform)});
        // Capture stable handles once; never re-read a disposed View.webContents.
        const contents=page.webContents,chromeContents=chrome.webContents;
        contents.setAudioMuted(true);chromeContents.setAudioMuted(true);
        const generation=++nextGeneration;
        room={id:config.id,platform:config.platform,identity:{roomId:config.id,generation,webContentsId:contents.id},group,chrome,page,contents,chromeContents,closed:false,documentNavigations:0,cleanups:[],visible:false};
        const value=room;
        rooms.set(config.id,value);
        audio.add(config.id,contents,config.audio.allowed);
        value.cleanups.push(native.sessions.configure(contents,config.platform,contents.id,category=>{
          if(current(value))options.onEvent({kind:'blocked',identity:identity(value),category});
        }));
        value.cleanups.push(options.registerChrome(chromeContents,config.id));
        function listen(target:WebContents,event:string,callback:(...args:any[])=>void):void {
          const emitter=target as NodeJS.EventEmitter;
          emitter.on(event,callback);value.cleanups.push(()=>emitter.removeListener(event,callback));
        }
        const deny=(event:Electron.Event)=>event.preventDefault();
        listen(chromeContents,'will-navigate',deny);
        listen(chromeContents,'will-frame-navigate',deny);
        listen(chromeContents,'will-attach-webview',deny);
        chromeContents.setWindowOpenHandler(()=>({action:'deny'}));
        listen(contents,'did-start-navigation',(event:Electron.Event<{isMainFrame:boolean;isSameDocument:boolean}>,_url:string,inPlace:boolean,main:boolean)=>{
          if(!alive(value)||!(event.isMainFrame??main)||(event.isSameDocument??inPlace))return;
          value.documentNavigations++;
          audio.loading(config.id);
          navigation(value,'loading');observeAudio(value);
        });
        listen(contents,'did-finish-load',()=>{
          if(!alive(value))return;
          audio.ready(config.id);navigation(value,'ready');observeAudio(value);
        });
        listen(contents,'did-fail-load',(_event:Electron.Event,code:number,_description:string,_url:string,isMainFrame:boolean)=>{
          if(!alive(value)||!isMainFrame||code===-3)return;
          audio.loading(config.id);navigation(value,'error',Number.isSafeInteger(code)?code:-2);observeAudio(value);
        });
        const crashed=()=>{
          if(!current(value))return;
          audio.loading(config.id);native.sessions.closeOwner(contents.id);
          options.onEvent({kind:'crashed',identity:identity(value)});
        };
        listen(contents,'render-process-gone',crashed);
        listen(contents,'destroyed',crashed);
        listen(contents,'audio-state-changed',()=>observeAudio(value));
        listen(contents,'media-started-playing',()=>observeAudio(value));
        listen(contents,'media-paused',()=>observeAudio(value));
        listen(contents,'focus',()=>{if(alive(value))options.onEvent({kind:'focus',identity:identity(value)});});
        group.addChildView(chrome);group.addChildView(page);
        options.window.contentView.addChildView(group);
        zOrder.push(config.id);
        // A room remains hidden until its first validated layout batch.
        group.setVisible(false);
        void chromeContents.loadURL(chromeUrl).catch(()=>{if(current(value))navigation(value,'error',-2);});
        // did-fail-load carries the main-frame result. A superseded loadURL can
        // reject late, so its promise must not overwrite a newer navigation.
        void contents.loadURL(config.canonicalUrl).catch(()=>{});
        return identity(value);
      }catch(error){
        if(room)closeRoom(config.id);
        else {
          if(page)closeContents(page.webContents);
          if(chrome)closeContents(chrome.webContents);
        }
        throw error;
      }
    },
    closeRoom,
    reloadRoom(id){
      const room=rooms.get(id);
      if(!room||!alive(room))return;
      native.sessions.closeOwner(room.contents.id);
      audio.loading(id);observeAudio(room);
      try{room.contents.reload();}catch{navigation(room,'error',-2);}
    },
    applyBoundsBatch(geometries,revision){
      if(disposed||!Number.isSafeInteger(revision)||revision<=geometryRevision)return;
      // Validate the whole batch before changing any view.
      const batch:Array<{room:Room;geometry:NonNullable<ReturnType<typeof nativeGeometry>>;z:number}>=[];
      for(const [id,geometry] of Object.entries(geometries)) {
        const room=rooms.get(id);
        if(!room)continue;
        const value=nativeGeometry(geometry,options.canvasOffset);
        if(!value)return;
        batch.push({room,geometry:value,z:geometry.z});
      }
      geometryRevision=revision;
      for(const {room,geometry} of batch) {
        if(!current(room))continue;
        const previous=room.geometry;
        const changed=(key:'group'|'chrome'|'page')=>!previous||Object.keys(geometry[key]).some(field=>geometry[key][field as keyof typeof geometry.group]!==previous[key][field as keyof typeof geometry.group]);
        if(changed('group'))room.group.setBounds(geometry.group);
        if(changed('chrome'))room.chrome.setBounds(geometry.chrome);
        if(changed('page'))room.page.setBounds(geometry.page);
        room.geometry=geometry;
        const visible=geometry.group.width>0&&geometry.group.height>0;
        if(room.visible!==visible){room.visible=visible;room.group.setVisible(visible);}
      }
      // Native groups contain chrome and page, so z-order never separates them.
      manager.setZOrder(batch.sort((a,b)=>a.z-b.z).map(item=>item.room.id));
    },
    setZOrder(order){
      if(disposed||options.window.isDestroyed())return;
      const seen=new Set<RoomId>();
      const next:RoomId[]=[];
      for(const id of order){
        const room=rooms.get(id);
        if(!room||seen.has(id))continue;
        seen.add(id);next.push(id);
      }
      // Unmentioned groups keep their existing relative position underneath.
      const complete=[...zOrder.filter(id=>rooms.has(id)&&!seen.has(id)),...next];
      if(complete.length===zOrder.length&&complete.every((id,index)=>id===zOrder[index]))return;
      for(const id of next)options.window.contentView.addChildView(rooms.get(id)!.group);
      zOrder=complete;
    },
    applyAudio(intent){
      if(disposed)return new Map();
      const allowed=audio.apply(intent);
      for(const room of rooms.values())observeAudio(room);
      return allowed;
    },
    getAudioAllowed:()=>audio.snapshot(),
    getRuntimeIdentity(id){const room=rooms.get(id);return room?identity(room):undefined;},
    getContents(id){const room=rooms.get(id);return room&&alive(room)?room.contents:undefined;},
    permitLoginPopup(id){const room=rooms.get(id);if(room&&alive(room))native.sessions.permit(room.contents.id);},
    openLoginWindow(id){const room=rooms.get(id);if(room&&alive(room))native.sessions.openLogin(room.platform,room.contents.id);},
    dispose(){
      if(disposed)return;
      for(const id of [...rooms.keys()])closeRoom(id);
      disposed=true;native.sessions.dispose();
    },
  };
  return manager;
}
