import type { WebFrameMain } from 'electron';
import type { RoomId,RoomConfig,PlatformId } from '../../shared/contracts.ts';
import type { MediaObservation,OperationResult,PlatformPresentation } from '../../shared/app-contracts.ts';
import type { RoomRuntimeManager } from '../../main/runtime-contracts.ts';
import { operationResult,operationFilter,dynamicOperationScript } from './observation.ts';
const timeout=<T>(promise:Promise<T>,ms=1800):Promise<T>=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Platform operation timeout')),ms);
  promise.then(value=>{clearTimeout(timer);resolve(value);},()=>{clearTimeout(timer);reject(new Error('Platform operation failed'));});
});
const number=(value:unknown,max:number)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?value:undefined;
const mediaScript=`(() => {const key=Symbol.for('live-union.media-observation.v1');let state=globalThis[key];if(!state||!(state.ids instanceof WeakMap)||!Number.isSafeInteger(state.epoch)||!Number.isSafeInteger(state.next))state=globalThis[key]={ids:new WeakMap(),next:0,epoch:Math.floor(Math.random()*Number.MAX_SAFE_INTEGER)};return [...document.querySelectorAll('video')].slice(0,4).map(v=>{const b=v.getBoundingClientRect(),q=v.getVideoPlaybackQuality?.();if(!state.ids.has(v))state.ids.set(v,++state.next);return {width:v.videoWidth,height:v.videoHeight,paused:v.paused,currentTime:v.currentTime,frames:q?.totalVideoFrames,dropped:q?.droppedVideoFrames,documentEpoch:state.epoch,videoInstance:state.ids.get(v),readyState:v.readyState,networkState:v.networkState,area:b.width*b.height}})})()`;
export interface AdapterServiceOptions {
  runtime:RoomRuntimeManager;
  adapters:Record<PlatformId,PlatformPresentation>;
  getRoom:(roomId:RoomId)=>RoomConfig|undefined;
  isNative:(roomId:RoomId)=>boolean;
  onPresentation:(roomId:RoomId,generation:number,result:OperationResult)=>void;
  onMedia:(roomId:RoomId,generation:number,media:MediaObservation|undefined)=>void;
}
export class AdapterService {
  private disposed=false;
  private timers=new Map<RoomId,Set<ReturnType<typeof setTimeout>>>();
  private revision=new Map<RoomId,number>();
  private nextRevision=0;
  private recoveries=new Map<RoomId,{attempt:number;pending:boolean}>();
  private readonly options:AdapterServiceOptions;
  constructor(options:AdapterServiceOptions){this.options=options;}
  schedule(roomId:RoomId,delays=[150,1000,3500,8000,15000,30000]):void {
    this.cancel(roomId);
    this.recoveries.set(roomId,{attempt:0,pending:false});
    const timers=new Set<ReturnType<typeof setTimeout>>();this.timers.set(roomId,timers);
    for(const delay of delays){const timer=setTimeout(()=>{timers.delete(timer);void this.present(roomId);},delay);timers.add(timer);}
  }
  async present(roomId:RoomId):Promise<void>{
    const room=this.options.getRoom(roomId),contents=this.options.runtime.getContents(roomId),identity=this.options.runtime.getRuntimeIdentity(roomId);
    if(this.disposed||!room||!contents||!identity)return;
    const revision=++this.nextRevision;this.revision.set(roomId,revision);
    const adapter=this.options.adapters[room.platform];
    const validWidth=room.chat.preferredWidthDip>=140&&room.chat.preferredWidthDip<=500;
    const prefs={compact:!this.options.isNative(roomId)&&validWidth,chatVisible:room.chat.visible,chatWidthDip:validWidth?room.chat.preferredWidthDip:240};
    try{
      const raw=await timeout(contents.executeJavaScript(`(${operationFilter})(${adapter.build(prefs)})`));
      if(!this.current(roomId,identity.generation)||this.revision.get(roomId)!==revision)return;
      const result:OperationResult=validWidth?operationResult(raw):{status:'unsupported',reason:'invalid-chat-width'};
      this.options.onPresentation(roomId,identity.generation,result);this.recover(roomId,result);
    }catch{if(this.current(roomId,identity.generation)&&this.revision.get(roomId)===revision)this.options.onPresentation(roomId,identity.generation,{status:'notReady',reason:'unknown'});}
  }
  async observe(roomId:RoomId):Promise<void>{
    const config=this.options.getRoom(roomId),contents=this.options.runtime.getContents(roomId),identity=this.options.runtime.getRuntimeIdentity(roomId);
    if(this.disposed||!config||!contents||!identity)return;
    const revision=this.revision.get(roomId)??++this.nextRevision;this.revision.set(roomId,revision);
    try{
      const root=contents.mainFrame;
      const frames:WebFrameMain[]=[root];
      if(config.platform==='bilibili')for(const frame of root.framesInSubtree.slice(0,16)){
        if(frame===root)continue;
        try{const url=new URL(frame.url);if(url.hostname==='live.bilibili.com'&&/^\/blanc\/[0-9]+\/?$/.test(url.pathname))frames.push(frame);}catch{}
      }
      const [results,operation]=await Promise.all([
        Promise.all(frames.slice(0,4).map(frame=>timeout(frame.executeJavaScript(mediaScript)).catch(()=>undefined))),
        timeout(contents.executeJavaScript(dynamicOperationScript)).catch(()=>undefined),
      ]);
      const candidates:Array<MediaObservation&{area:number}>=[];
      for(const raw of results)if(Array.isArray(raw))for(const value of raw.slice(0,4)){
        const width=number(value?.width,32768),height=number(value?.height,32768),time=number(value?.currentTime,1e12),area=number(value?.area,1e10);
        if(!width||!height||time===undefined||!area||typeof value.paused!=='boolean')continue;
        const optional:Partial<MediaObservation>={};
        for(const [key,max] of [['documentEpoch',Number.MAX_SAFE_INTEGER],['videoInstance',1e12],['readyState',4],['networkState',3]] as const){const parsed=number(value[key],max);if(parsed!==undefined&&Number.isSafeInteger(parsed))optional[key]=parsed;}
        candidates.push({width,height,currentTime:time,paused:value.paused,frames:number(value.frames,1e12),dropped:number(value.dropped,1e12),...optional,area});
      }
      candidates.sort((a,b)=>Number(a.paused)-Number(b.paused)||b.area-a.area);
      if(!this.current(roomId,identity.generation)||this.revision.get(roomId)!==revision)return;
      if(operation){const result=operationResult(operation);this.options.onPresentation(roomId,identity.generation,result);this.recover(roomId,result);}
      const chosen=candidates[0];
      if(chosen){const {area,...media}=chosen;this.options.onMedia(roomId,identity.generation,media);}else this.options.onMedia(roomId,identity.generation,undefined);
    }catch{/* A frame can be replaced between lookup and its bounded sample. */}
  }
  private current(roomId:RoomId,generation:number):boolean{return !this.disposed&&this.options.getRoom(roomId)!==undefined&&this.options.runtime.getRuntimeIdentity(roomId)?.generation===generation;}
  private recover(roomId:RoomId,result:OperationResult):void{
    const state=this.recoveries.get(roomId),delays=[1000,3000,8000,20000,40000];
    if(!state||state.pending||state.attempt>=delays.length||this.options.isNative(roomId)||!['unsupported','notReady'].includes(result.status)||!['structure','player-structure','player-not-ready','document-not-ready','structure-changed','structure-invalidated','required-structure-missing'].includes(result.reason??''))return;
    state.pending=true;const delay=delays[state.attempt++];
    const timers=this.timers.get(roomId)??new Set<ReturnType<typeof setTimeout>>();this.timers.set(roomId,timers);
    const timer=setTimeout(()=>{timers.delete(timer);state.pending=false;void this.present(roomId);},delay);timers.add(timer);
  }
  cancel(roomId:RoomId):void{for(const timer of this.timers.get(roomId)??[])clearTimeout(timer);this.timers.delete(roomId);this.recoveries.delete(roomId);this.revision.set(roomId,++this.nextRevision);}
  release(roomId:RoomId):void{this.cancel(roomId);this.revision.delete(roomId);}
  dispose():void{this.disposed=true;for(const id of this.timers.keys())this.cancel(id);this.revision.clear();}
}
