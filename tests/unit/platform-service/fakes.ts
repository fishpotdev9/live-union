import { createContext, runInContext } from 'node:vm';
import type { Context } from 'node:vm';
import type { WebContents } from 'electron';
import type { RoomConfig, RoomId, PlatformId } from '../../../src/shared/contracts.ts';
import type { MediaObservation, OperationResult, PlatformPresentation, PresentationPreferences } from '../../../src/shared/app-contracts.ts';
import type { RoomRuntimeManager, RuntimeIdentity } from '../../../src/main/runtime-contracts.ts';
import { AdapterService } from '../../../src/platforms/shared/service.ts';
import { dynamicOperationScript } from '../../../src/platforms/shared/observation.ts';

export function deferred<T>() {
  let resolve!:(value:T)=>void;
  let reject!:(reason?:unknown)=>void;
  const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
  return {promise,resolve,reject};
}
export function media(overrides:Record<string,unknown>={}) {
  return {width:1920,height:1080,currentTime:120,paused:false,frames:7200,dropped:3,area:640*360,...overrides};
}
export class FakeFrame {
  url='https://live.bilibili.com/123';
  framesInSubtree:FakeFrame[]=[this];
  replies:unknown[]=[];
  calls:string[]=[];
  executeJavaScript(script:string):Promise<unknown> {
    this.calls.push(script);
    const reply=this.replies.length?this.replies.shift():[];
    return Promise.resolve(reply);
  }
}
export class FakeContents {
  mainFrame=new FakeFrame();
  context:Context=createContext({});
  calls:string[]=[];
  reloadCalls=0;
  presentationReplies:unknown[]=[];
  reload():void {this.reloadCalls++;}
  executeJavaScript(script:string):Promise<unknown> {
    this.calls.push(script);
    if(script!==dynamicOperationScript&&this.presentationReplies.length)return Promise.resolve(this.presentationReplies.shift());
    try{return Promise.resolve(runInContext(script,this.context,{timeout:100}));}
    catch(error){return Promise.reject(error);}
  }
  setDynamic(value:unknown):void {
    this.context.nextOperation=value;
    runInContext("globalThis[Symbol.for('live-union.presentation.result')]=nextOperation",this.context);
    delete this.context.nextOperation;
  }
}
export class FakeRuntime implements RoomRuntimeManager {
  identities=new Map<RoomId,RuntimeIdentity>();
  contents=new Map<RoomId,FakeContents>();
  reloads:RoomId[]=[];
  async createRoom(room:RoomConfig):Promise<RuntimeIdentity> {
    const identity={roomId:room.id,generation:1,webContentsId:1};
    this.identities.set(room.id,identity);this.contents.set(room.id,new FakeContents());return identity;
  }
  closeRoom(id:RoomId):void {this.identities.delete(id);this.contents.delete(id);}
  reloadRoom(id:RoomId):void {this.reloads.push(id);}
  applyBoundsBatch():void {}
  setZOrder():void {}
  applyAudio():ReadonlyMap<RoomId,boolean> {return new Map();}
  getAudioAllowed():ReadonlyMap<RoomId,boolean> {return new Map();}
  getRuntimeIdentity(id:RoomId):RuntimeIdentity|undefined {const identity=this.identities.get(id);return identity?{...identity}:undefined;}
  getContents(id:RoomId):WebContents|undefined {return this.contents.get(id) as unknown as WebContents|undefined;}
  permitLoginPopup():void {}
  openLoginWindow():void {}
  dispose():void {this.identities.clear();this.contents.clear();}
}
export async function harness(platform:PlatformId='huya') {
  const room:RoomConfig={id:'room-a',platform,platformRoomId:'123',canonicalUrl:`https://${platform==='bilibili'?'live.bilibili.com':`www.${platform}.com`}/123`,chat:{visible:true,preferredWidthDip:280},audio:{allowed:false}};
  const rooms=new Map([[room.id,room]]);
  const runtime=new FakeRuntime();await runtime.createRoom(room);
  const contents=runtime.contents.get(room.id)!;
  const presentations:Array<{roomId:RoomId;generation:number;result:OperationResult}>=[];
  const samples:Array<{roomId:RoomId;generation:number;value:MediaObservation|undefined}>=[];
  const prefs:PresentationPreferences[]=[];
  const state:{presentation?:OperationResult;media?:MediaObservation}={};
  let native=false;
  const adapter:PlatformPresentation={id:platform,version:'offline-service-test',build(value){
    prefs.push({...value});
    return "(() => {const value={status:'applied',reason:'layout'};globalThis[Symbol.for('live-union.presentation.result')]=value;return value;})()";
  }};
  const service=new AdapterService({runtime,adapters:{huya:adapter,douyu:adapter,bilibili:adapter},getRoom:id=>rooms.get(id),isNative:()=>native,
    onPresentation(roomId,generation,result){presentations.push({roomId,generation,result});state.presentation=result;},
    onMedia(roomId,generation,value){samples.push({roomId,generation,value});state.media=value;},
  });
  return {room,rooms,runtime,contents,service,presentations,samples,state,prefs,setNative(value:boolean){native=value;}};
}
