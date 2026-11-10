import { randomUUID } from 'node:crypto';
import type { BaseWindow, MenuItemConstructorOptions } from 'electron';
import type { AppCommand, AppState, CommandResult, RoomRuntimeState, WorkspaceEntry, PlatformPresentation,OperationResult } from '../../shared/app-contracts.ts';
import { APP_CONTRACT_VERSION, emptyCapabilities, cleanAnchorNickname } from '../../shared/app-contracts.ts';
import { historyKey } from '../../shared/history-contracts.ts';
import type { HistoryAddress, HistoryNicknameResolver } from '../../shared/history-contracts.ts';
import type { PlatformId, RoomConfig, WorkspaceSnapshot, WorkspaceLoadResult } from '../../shared/contracts.ts';
import { PLATFORM_DETAILS } from '../../shared/platforms.ts';
import { WorkspaceModel } from '../../domain/workspace/index.ts';
import { AdapterService } from '../../platforms/shared/service.ts';
import type { RoomRuntimeManager, RuntimeEvent } from '../runtime-contracts.ts';
import type { WorkspaceCatalog } from '../storage/catalog.ts';
import type { resolveRoom } from './resolve-room.ts';
import type { HistoryCoordinator } from '../history/service.ts';

export function emptyWorkspace():WorkspaceSnapshot {
  return {schemaVersion:1,id:randomUUID(),name:'我的工作台',rooms:[],stableOrder:[],layout:{base:'equal',editing:'auto',equal:{variant:'balanced',order:[]},focus:{variant:'balanced',order:[]},free:{rects:{},from:'equal'}}};
}
export function recoveredSnapshot(result:WorkspaceLoadResult):WorkspaceSnapshot {
  const snapshot=structuredClone(result.snapshot??emptyWorkspace());
  // A backup may predate room deletion or sound changes. Never restore its sound automatically.
  if(result.source==='backup'||result.warnings.length)for(const room of snapshot.rooms)room.audio.allowed=false;
  return snapshot;
}
interface Options {
  window:BaseWindow;runtime:RoomRuntimeManager;catalog:WorkspaceCatalog;
  snapshot:WorkspaceSnapshot;entries:WorkspaceEntry[];canvas:{width:number;height:number};
  adapters:Record<PlatformId,PlatformPresentation>;
  publish:(state:AppState)=>void;layoutChrome:(empty:boolean,historyOpen?:boolean)=>void;
  resolveRoom:typeof resolveRoom;showMenu:(items:MenuItemConstructorOptions[])=>void;
  history?:HistoryCoordinator;
  nickname?:HistoryNicknameResolver;
}
export class Controller {
  private model:WorkspaceModel;
  private states:Record<string,RoomRuntimeState>={};
  private presentations:Record<string,OperationResult>={};
  private entries:WorkspaceEntry[];
  private revision=0;private layoutRevision=0;private epoch=0;private disposed=false;private switching=false;
  private muteDuringSwitch=false;
  private viewSizes=new Map<string,string>();
  private saveTimer:ReturnType<typeof setTimeout>|undefined;private mediaTimer:ReturnType<typeof setInterval>;
  private saveQueue:Promise<void>=Promise.resolve();private saveSequence=0;
  private saveStatus:AppState['saveStatus']='saved';private message:AppState['message'];
  private canvas:{width:number;height:number};
  private historyOpen=false;
  private anchorNames=new Map<string,string>();
  private anchorAddresses=new Map<string,HistoryAddress>();
  private anchorRequests=new Map<string,AbortController>();
  readonly adapters:AdapterService;
  private readonly options:Options;
  constructor(options:Options){
    this.options=options;
    this.model=new WorkspaceModel(options.snapshot,options.canvas);this.entries=options.entries;this.canvas=options.canvas;
    this.adapters=new AdapterService({runtime:options.runtime,adapters:options.adapters,
      getRoom:id=>this.room(id),isNative:id=>this.model.nativeRoomId===id,
      onPresentation:(id,generation,result)=>{
        const state=this.states[id];if(!state||state.generation!==generation)return;
        if(this.presentations[id]?.status===result.status&&this.presentations[id]?.reason===result.reason)return;
        this.presentations[id]=result;
        state.adaptation=result.status==='applied'||result.status==='restored'?'ready':result.status==='notReady'?'detecting':result.status==='unsupported'?'unsupported':'degraded';
        state.capabilities.compactPage=result.status==='applied'?'supported':result.status==='unsupported'?'unsupported':'unknown';
        state.capabilities.chatVisibility=result.status==='applied'?'supported':'unknown';
        state.message=result.status==='unsupported'?'当前尺寸或页面结构需要放大原网页。':result.status==='failed'?'页面整理失败，可放大原网页。':result.reason==='controls-need-zoom'?'原生控件较窄，可在更多菜单放大原网页操作。':undefined;
        this.publish();
      },onMedia:(id,generation,media)=>{
        const state=this.states[id];if(!state||state.generation!==generation)return;
        state.media=media;
        // Dimensions alone do not prove live playback, login, quality entitlement or native chat.
        this.publish();
      }});
    this.mediaTimer=setInterval(()=>{for(const id of this.model.snapshot.stableOrder)void this.adapters.observe(id);},4000);
  }
  private room(id:string):RoomConfig|undefined{return this.model.snapshot.rooms.find(room=>room.id===id);}
  private async refreshLive(id:string,generation:number):Promise<void>{
    const room=this.room(id);if(!room)return;
    const epoch=this.epoch;
    try{
      const result=await this.options.resolveRoom(room.canonicalUrl),state=this.states[id];
      if(!this.disposed&&epoch===this.epoch&&state?.generation===generation&&this.room(id)&&state.navigation==='ready'&&result.live!=='unknown'){state.live=result.live;this.publish();}
    }catch{/* Public live metadata can be unavailable; do not guess from page load. */}
  }
  presentation(id:string):OperationResult|undefined{return this.presentations[id]?{...this.presentations[id]}:undefined;}
  get state():AppState{return {contractVersion:APP_CONTRACT_VERSION,revision:this.revision,workspace:this.model.snapshot,workspaces:structuredClone(this.entries),runtime:structuredClone(this.states),geometry:this.model.geometry,canvas:{...this.canvas},selectedId:this.model.selectedId,zoomedId:this.model.zoomedId,nativeRoomId:this.model.nativeRoomId,undoAvailable:this.model.undoAvailable,saveStatus:this.saveStatus,history:this.options.history?.state,historyOpen:this.historyOpen,message:this.message};}
  publish():void {if(!this.disposed){
    // Seed confirmed saved names without making titles depend on removable history.
    for(const entry of this.options.history?.state.entries??[]){const name=cleanAnchorNickname(entry.nickname);if(name&&!this.anchorNames.has(historyKey(entry)))this.anchorNames.set(historyKey(entry),name);}
    for(const room of this.model.snapshot.rooms){const name=this.anchorNames.get(historyKey(this.anchorAddresses.get(room.id)??room));if(name&&this.states[room.id])this.states[room.id].anchorNickname=name;}
    this.revision++;this.options.publish(this.state);
  }}
  updateAnchorNickname(address:HistoryAddress,value:string):void {
    const name=cleanAnchorNickname(value);if(this.disposed||!name)return;
    const key=historyKey(address);this.anchorNames.set(key,name);let changed=false;
    for(const room of this.model.snapshot.rooms){
      if(historyKey(this.anchorAddresses.get(room.id)??room)===key&&this.states[room.id]&&this.states[room.id].anchorNickname!==name){this.states[room.id].anchorNickname=name;changed=true;}
      // A history lookup may confirm an old short-ID after the room's initial
      // identity attempts ended. Re-associate that still-running room now.
      else if(room.platform===address.platform&&!this.anchorAddresses.has(room.id)&&!this.anchorRequests.has(room.id)&&(room.platform==='bilibili'||room.platform==='huya'&&!/^\d+$/.test(room.platformRoomId)))this.refreshAnchor(room);
    }
    if(changed)this.publish();
  }
  private cancelAnchor(id:string):void {this.anchorRequests.get(id)?.abort();this.anchorRequests.delete(id);this.anchorAddresses.delete(id);}
  private refreshAnchor(room:RoomConfig):void {
    if(!this.options.nickname)return;this.cancelAnchor(room.id);
    const request=new AbortController(),generation=this.states[room.id]?.generation;
    this.anchorRequests.set(room.id,request);
    void (async()=>{
      try{
        let address:HistoryAddress|undefined;
        for(let attempt=0;attempt<3&&!request.signal.aborted;attempt++){
          try{address=await (this.options.history?.resolveIdentity(room)??Promise.resolve(room));break;}
          catch{if(attempt===2)return;await new Promise<void>(resolve=>{
            const done=()=>{clearTimeout(timer);request.signal.removeEventListener('abort',done);resolve();};
            const timer=setTimeout(done,[1000,4000][attempt]);request.signal.addEventListener('abort',done,{once:true});if(request.signal.aborted)done();
          });}
        }
        if(!address)return;
        if(this.disposed||request.signal.aborted||this.anchorRequests.get(room.id)!==request||this.states[room.id]?.generation!==generation||this.room(room.id)?.canonicalUrl!==room.canonicalUrl)return;
        this.anchorAddresses.set(room.id,address);
        const known=this.anchorNames.get(historyKey(address));if(known)this.updateAnchorNickname(address,known);
        const name=await this.options.nickname!(address,request.signal);
        if(!this.disposed&&!request.signal.aborted&&this.anchorRequests.get(room.id)===request&&this.states[room.id]?.generation===generation&&this.room(room.id)?.canonicalUrl===room.canonicalUrl&&name)this.updateAnchorNickname(address,name);
      }catch{/* Public metadata is optional and never changes playback. */}
      finally{if(this.anchorRequests.get(room.id)===request)this.anchorRequests.delete(room.id);}
    })();
  }
  warn(text:string):void {this.message={level:'warning',text};this.publish();}
  private sync():void {
    if(this.disposed)return;
    this.options.layoutChrome(this.model.snapshot.rooms.length===0,this.historyOpen);
    const geometry=this.model.geometry;
    this.options.runtime.applyBoundsBatch(geometry.rooms,++this.layoutRevision);
    const sizes=new Map<string,string>();
    for(const [id,value] of Object.entries(geometry.rooms)){
      const rect=value.content;
      const size=`${Math.round(rect.x+rect.width)-Math.round(rect.x)}:${Math.round(rect.y+rect.height)-Math.round(rect.y)}`;
      sizes.set(id,size);
      if(this.viewSizes.get(id)!==size)this.adapters.schedule(id,[80]);
    }
    this.viewSizes=sizes;
    this.publish();
  }
  resize(canvas:{width:number;height:number}):void {this.canvas=canvas;this.model.setCanvas(canvas);this.sync();}
  private async create(room:RoomConfig):Promise<void>{
    if(this.switching&&this.muteDuringSwitch)room={...room,audio:{...room.audio,allowed:false}};
    if(this.states[room.id]?.generation===0)delete this.states[room.id];
    const identity=await this.options.runtime.createRoom(room);
    if(this.disposed||!this.room(room.id))return;
    this.states[room.id]??={id:room.id,generation:identity.generation,webContentsId:identity.webContentsId,navigation:'loading',live:'unknown',login:'unknown',adaptation:'detecting',capabilities:emptyCapabilities(),pageAudioActive:false,containerMuted:true,documentNavigations:0};
    this.refreshAnchor(room);
  }
  private creationFailed(id:string):void{
    if(this.disposed||!this.room(id))return;
    this.states[id]={id,generation:0,webContentsId:0,navigation:'error',live:'failed',login:'unknown',adaptation:'degraded',capabilities:emptyCapabilities(),pageAudioActive:false,containerMuted:true,documentNavigations:0,message:'房间未能创建，可在顶部重试；其他房间继续运行。'};
  }
  private async restoreRooms():Promise<number>{
    let failures=0;
    for(const room of this.model.snapshot.rooms)try{await this.create(room);}catch{this.creationFailed(room.id);failures++;}
    return failures;
  }
  async initialize():Promise<void>{
    void this.options.history?.initialize();
    const failures=await this.restoreRooms();
    if(failures)this.message={level:'warning',text:`${failures} 间未能创建，可在顶部重试；其余房间继续运行。`};
    this.sync();
    if(!this.entries.some(entry=>entry.id===this.model.snapshot.id))await this.flushSave();
  }
  event(event:RuntimeEvent):void {
    if(this.disposed||!this.room(event.identity.roomId))return;
    const {roomId,generation,webContentsId}=event.identity;
    let state=this.states[roomId];
    if(state&&state.generation!==generation)return;
    state??=this.states[roomId]={id:roomId,generation,webContentsId,navigation:'loading',live:'unknown',login:'unknown',adaptation:'detecting',capabilities:emptyCapabilities(),pageAudioActive:false,containerMuted:true,documentNavigations:0};
    if(event.kind==='navigation'){
      state.navigation=event.state;state.documentNavigations=event.documentNavigations;state.errorCode=event.errorCode;
      if(event.state==='loading'){delete this.presentations[roomId];state.media=undefined;state.message=undefined;if(state.live==='failed')state.live='unknown';state.adaptation='detecting';this.adapters.cancel(roomId);}
      if(event.state==='ready'){this.adapters.schedule(roomId);void this.refreshLive(roomId,generation);}
      if(event.state==='error'){state.live='failed';state.message='页面加载失败，可仅刷新此房间。';}
    }else if(event.kind==='audio'){
      if(state.pageAudioActive===event.pageAudioActive&&state.containerMuted===event.containerMuted)return;
      state.pageAudioActive=event.pageAudioActive;state.containerMuted=event.containerMuted;
    }
    else if(event.kind==='focus'){if(this.model.selectedId===roomId)return;this.model.apply({type:'selectRoom',roomId});}
    else if(event.kind==='crashed'){state.navigation='error';state.live='failed';state.media=undefined;state.message='房间进程异常，可仅刷新此房间。';this.adapters.cancel(roomId);}
    else if(event.kind==='blocked')state.message=event.category==='popup'?'弹窗被阻止；可在菜单允许一次原生登录弹窗。':'页面请求已按应用边界拦截。';
    this.publish();
  }
  private dirty():void {
    if(this.disposed)return;
    this.saveStatus='saving';this.saveSequence++;
    if(this.switching)return;
    if(this.saveTimer)clearTimeout(this.saveTimer);
    this.saveTimer=setTimeout(()=>{this.saveTimer=undefined;void this.flushSave();},300);
  }
  async flushSave():Promise<boolean>{
    if(this.saveTimer){clearTimeout(this.saveTimer);this.saveTimer=undefined;}
    const snapshot=this.model.snapshot,sequence=this.saveSequence;
    let saved=false;
    const operation=this.saveQueue.then(async()=>{
      try{
        await this.options.catalog.save(snapshot);this.entries=await this.options.catalog.list();
        saved=true;if(sequence===this.saveSequence&&snapshot.id===this.model.snapshot.id)this.saveStatus='saved';
      }catch{this.saveStatus='error';this.message={level:'error',text:'工作台未能保存；请保留当前窗口并检查本地数据目录。'};}
      this.publish();
    });
    this.saveQueue=operation;await operation;return saved;
  }
  private async flushLatest():Promise<boolean>{
    for(;;){const sequence=this.saveSequence;if(!await this.flushSave())return false;if(sequence===this.saveSequence)return true;}
  }
  async command(command:AppCommand):Promise<CommandResult>{
    try{
      if(this.disposed)return{ok:false,error:'工作台正在关闭'};
      if(command.type==='getState'){this.publish();return{ok:true,revision:this.revision};}
      if(this.switching&&command.type!=='muteAll')return{ok:false,error:'正在切换工作台，请稍后重试'};
      if(command.type==='setHistoryOpen'){
        this.historyOpen=command.open;
        this.options.layoutChrome(this.model.snapshot.rooms.length===0,this.historyOpen);
        if(command.open)this.options.history?.refreshMetadata();
        this.publish();return{ok:true,revision:this.revision};
      }
      if(command.type==='removeHistoryRoom'||command.type==='clearHistory'){
        if(!this.options.history)return{ok:false,error:'历史记录暂不可用'};
        try{if(command.type==='clearHistory')await this.options.history.clear();else await this.options.history.remove(command.historyId);}
        catch{return{ok:false,error:'历史记录未能更新，当前直播与组合不受影响'};}
        this.publish();return{ok:true,revision:this.revision};
      }
      if(command.type==='refreshHistoryMetadata'){
        this.options.history?.refreshMetadata(command.historyIds);return{ok:true,revision:this.revision};
      }
      if(command.type==='addHistoryRoom'){
        const entry=this.options.history?.entry(command.historyId);
        if(!entry)return{ok:false,error:'这条历史记录已删除或暂不可用'};
        let existing=this.model.snapshot.rooms.find(room=>room.platform===entry.platform&&room.platformRoomId===entry.platformRoomId);
        if(!existing){
          const epoch=this.epoch,workspaceId=this.model.snapshot.id;
          const candidates=this.model.snapshot.rooms.filter(room=>room.platform===entry.platform);
          let unresolved=false;
          const identities=await Promise.all(candidates.map(async room=>{try{return{id:room.id,address:await this.options.history!.resolveIdentity(room)};}catch{unresolved=true;return undefined;}}));
          if(this.disposed||this.switching||this.epoch!==epoch||this.model.snapshot.id!==workspaceId)return{ok:false,error:'工作台已切换，请重新选择历史房间'};
          if(!this.options.history?.entry(command.historyId))return{ok:false,error:'这条历史记录已删除'};
          existing=this.model.snapshot.rooms.find(room=>room.platform===entry.platform&&room.platformRoomId===entry.platformRoomId||identities.some(value=>value?.id===room.id&&value.address.platform===entry.platform&&value.address.platformRoomId===entry.platformRoomId));
          if(!existing&&unresolved)return{ok:false,error:'现有房号暂时无法核对，请稍后重试，已保留原直播'};
        }
        if(existing){
          this.model.apply({type:'selectRoom',roomId:existing.id});this.historyOpen=false;
          this.options.layoutChrome(false,false);this.publish();return{ok:true,revision:this.revision};
        }
        const result=await this.command({type:'addRoom',url:entry.canonicalUrl});
        if(result.ok){this.historyOpen=false;this.options.layoutChrome(this.model.snapshot.rooms.length===0,false);this.publish();return{ok:true,revision:this.revision};}
        return result;
      }
      const beforeNative=this.model.nativeRoomId;
      switch(command.type){
        case 'addRoom':{
          const epoch=this.epoch,workspaceId=this.model.snapshot.id;
          let address:Awaited<ReturnType<typeof resolveRoom>>;
          try{address=await this.options.resolveRoom(command.url);}catch{return{ok:false,error:'暂时无法确认平台房间，请检查链接或稍后重试'};}
          if(this.disposed||this.switching||epoch!==this.epoch||workspaceId!==this.model.snapshot.id)return{ok:false,error:'工作台已切换，请重新添加房间'};
          const existing=this.model.snapshot.rooms.find(room=>room.canonicalUrl===address.canonicalUrl);
          if(existing){this.model.apply({type:'selectRoom',roomId:existing.id});this.publish();return{ok:false,error:'该房间已在工作台中'};}
          const room:RoomConfig={id:randomUUID(),platform:address.platform,platformRoomId:address.platformRoomId,canonicalUrl:address.canonicalUrl,chat:{visible:false,preferredWidthDip:PLATFORM_DETAILS[address.platform].chatWidthDip},audio:{allowed:false}};
          this.model.addRoom(room);
          try{await this.create(room);}catch{this.model.removeRoom(room.id);throw new Error('房间创建失败');}
          if(this.states[room.id])this.states[room.id].live=address.live;
          void this.options.history?.record({platform:address.platform,platformRoomId:address.platformRoomId,canonicalUrl:address.canonicalUrl}).catch(()=>this.warn('房间已添加，但历史记录未能保存。'));
          break;
        }
        case 'removeRoom':this.cancelAnchor(command.roomId);this.adapters.release(command.roomId);this.options.runtime.closeRoom(command.roomId);delete this.states[command.roomId];delete this.presentations[command.roomId];this.model.removeRoom(command.roomId);break;
        case 'reloadRoom':{
          const room=this.room(command.roomId);if(!room)return{ok:false,error:'房间已关闭'};
          if(!this.options.runtime.getRuntimeIdentity(command.roomId)){
            try{await this.create(room);}catch{this.creationFailed(room.id);this.sync();return{ok:false,error:'房间仍未能创建，其余房间继续运行'};}
            this.sync();
          }else{this.options.runtime.reloadRoom(command.roomId);this.refreshAnchor(room);this.publish();}
          return{ok:true,revision:this.revision};
        }
        case 'setAudio':this.model.setAudioAllowed(this.options.runtime.applyAudio({kind:'set',roomId:command.roomId,allowed:command.allowed}));break;
        case 'soloAudio':this.model.setAudioAllowed(this.options.runtime.applyAudio({kind:'solo',roomId:command.roomId}));break;
        case 'muteAll':{
          if(this.switching)this.muteDuringSwitch=true;
          this.options.runtime.applyAudio({kind:'muteAll'});
          this.model.setAudioAllowed(new Map(this.model.snapshot.stableOrder.map(id=>[id,false])));break;
        }
        case 'showRoomMenu':this.menu(command.roomId);return{ok:true,revision:this.revision};
        case 'toggleFullscreen':this.options.window.setFullScreen(!this.options.window.isFullScreen());return{ok:true,revision:this.revision};
        case 'saveWorkspaceAs':{
          this.switching=true;this.muteDuringSwitch=false;this.epoch++;
          try{
            if(!await this.flushLatest())return{ok:false,error:'当前组合保存失败，已保留当前工作台'};
            const next=await this.options.catalog.saveAs(this.model.snapshot,command.name);
            // Runtime owns the latest sound intent, including muteAll during the write.
            const allowed=this.options.runtime.getAudioAllowed();for(const room of next.rooms)room.audio.allowed=allowed.get(room.id)??false;
            this.model.replaceSnapshot(next,true);this.entries=await this.options.catalog.list();
            if(!await this.flushLatest())return{ok:false,error:'新组合已建立，但最新设置未保存，请保留当前工作台'};
          }
          finally{this.switching=false;if(this.saveStatus==='saving')this.dirty();}
          this.publish();return{ok:true,revision:this.revision};
        }
        case 'openWorkspace':{
          this.switching=true;this.muteDuringSwitch=false;this.epoch++;
          try{
            if(!await this.flushLatest())return{ok:false,error:'当前组合保存失败，已保留当前工作台'};const result=await this.options.catalog.open(command.workspaceId);
            for(const id of this.model.snapshot.stableOrder){this.cancelAnchor(id);this.adapters.release(id);this.options.runtime.closeRoom(id);}
            this.states={};this.presentations={};const next=recoveredSnapshot(result);
            if(this.muteDuringSwitch)for(const room of next.rooms)room.audio.allowed=false;
            this.model.replaceSnapshot(next);
            const failures=await this.restoreRooms();
            const warnings=[...(result.warnings.length?['已恢复较早的备份，房间和设置可能较旧；声音已全部关闭，请核对。']:[]),...(failures?[`${failures} 间未能创建，可在顶部重试；其余房间继续运行。`]:[])];
            this.message=warnings.length?{level:'warning',text:warnings.join(' ')}:undefined;
            if(this.muteDuringSwitch)await this.flushLatest();
          }finally{this.switching=false;if(this.saveStatus==='saving')this.dirty();}
          this.sync();return{ok:true,revision:this.revision};
        }
        default:if(!this.model.apply(command))return{ok:false,error:'此操作暂不可用'};
      }
      if(!['getState','selectRoom','setZoom','setNative','geometryBegin','geometryDelta'].includes(command.type))this.dirty();
      if(['setAudio','soloAudio','muteAll','selectRoom','renameWorkspace'].includes(command.type))this.publish();
      else this.sync();
      // Apply native bounds first, then inspect their settled viewport without navigating.
      const targets=new Set<string>();
      if(beforeNative!==this.model.nativeRoomId){if(beforeNative)targets.add(beforeNative);if(this.model.nativeRoomId)targets.add(this.model.nativeRoomId);}
      if(command.type==='setChat'||command.type==='setChatWidth')targets.add(command.roomId);
      if(command.type==='setAllChat')for(const id of this.model.snapshot.stableOrder)targets.add(id);
      if(['setTemplate','setFree','arrange','undoGeometry','setZoom','geometryEnd'].includes(command.type))for(const id of this.model.snapshot.stableOrder){const result=this.presentations[id];if(result&&['unsupported','failed','notReady'].includes(result.status))targets.add(id);}
      for(const id of targets)this.adapters.schedule(id,[80]);
      return{ok:true,revision:this.revision};
    }catch{return{ok:false,error:'操作未完成，请检查房间链接或本地保存状态后重试'};}
  }
  private menu(id:string):void {
    const room=this.room(id);if(!room)return;
    const run=(command:AppCommand)=>()=>{void this.command(command);};
    const items:MenuItemConstructorOptions[]=[
      {label:'允许此房间发声',type:'checkbox',checked:room.audio.allowed,click:run({type:'setAudio',roomId:id,allowed:!room.audio.allowed})},
      {label:'独听此房间',click:run({type:'soloAudio',roomId:id})},
      {label:'显示原生聊天侧栏',type:'checkbox',checked:room.chat.visible,click:run({type:'setChat',roomId:id,visible:!room.chat.visible})},
      {label:'聊天侧栏宽度',submenu:[200,240,300,340,380,440].map(widthDip=>({label:`${widthDip} DIP`,type:'radio' as const,checked:room.chat.preferredWidthDip===widthDip,click:run({type:'setChatWidth',roomId:id,widthDip})}))},
      {type:'separator'},
      {label:'设为主视角',click:run({type:'setPrimary',roomId:id})},
      {label:'置于最前（自由编辑）',enabled:this.model.snapshot.layout.editing==='free',click:run({type:'raiseRoom',roomId:id})},
      {label:this.model.zoomedId===id?'还原临时放大':'临时放大',click:run({type:'setZoom',roomId:id,enabled:this.model.zoomedId!==id})},
      {label:this.model.nativeRoomId===id?'返回整理视图':'放大原网页（登录／清晰度／弹幕设置）',click:run({type:'setNative',roomId:id,enabled:this.model.nativeRoomId!==id})},
      {label:'允许一次原生登录弹窗（30秒）',click:()=>this.options.runtime.permitLoginPopup(id)},
      ...(room.platform==='douyu'?[{label:'斗鱼原生登录窗口',click:()=>this.options.runtime.openLoginWindow(id)}]:[]),
      {type:'separator'},{label:'仅刷新此房间',click:run({type:'reloadRoom',roomId:id})},
      {label:'关闭此房间',click:run({type:'removeRoom',roomId:id})},
    ];
    this.options.showMenu(items);
  }
  async shutdown():Promise<void>{
    if(this.disposed)return;this.epoch++;this.switching=true;this.disposed=true;
    clearInterval(this.mediaTimer);this.adapters.dispose();
    for(const id of [...this.anchorRequests.keys()])this.cancelAnchor(id);this.anchorNames.clear();
    // Native resources are released before a possibly stalled filesystem write.
    this.options.runtime.dispose();await Promise.all([this.flushSave(),this.options.history?.shutdown()]);
  }
}
