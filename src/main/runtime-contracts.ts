import type { BaseWindow, WebContents } from 'electron';
import type { RoomConfig, RoomId, RoomGeometry, PlatformId } from '../shared/contracts.ts';
import type { AudioIntent } from '../shared/app-contracts.ts';

/** Privileged main-process contract. Never expose this interface through preload. */
export interface RuntimeIdentity {roomId:RoomId;generation:number;webContentsId:number}
export type RuntimeEvent =
  | {kind:'navigation';identity:RuntimeIdentity;state:'loading'|'ready'|'error';documentNavigations:number;errorCode?:number}
  | {kind:'audio';identity:RuntimeIdentity;pageAudioActive:boolean;containerMuted:boolean}
  | {kind:'focus';identity:RuntimeIdentity}
  | {kind:'crashed';identity:RuntimeIdentity}
  | {kind:'blocked';identity:RuntimeIdentity;category:'navigation'|'popup'|'download'|'permission'};
export interface RuntimeOptions {
  window:BaseWindow;
  chromeUrl:(roomId:RoomId)=>string;
  chromePreloadPath:string;
  canvasOffset:{x:number;y:number};
  registerChrome:(contents:WebContents,roomId:RoomId)=>()=>void;
  onEvent:(event:RuntimeEvent)=>void;
}
export interface RoomRuntimeManager {
  createRoom(room:RoomConfig):Promise<RuntimeIdentity>;
  closeRoom(roomId:RoomId):void;
  reloadRoom(roomId:RoomId):void;
  applyBoundsBatch(rooms:Readonly<Record<RoomId,RoomGeometry>>,revision:number):void;
  setZOrder(order:readonly RoomId[]):void;
  applyAudio(intent:AudioIntent):ReadonlyMap<RoomId,boolean>;
  getAudioAllowed():ReadonlyMap<RoomId,boolean>;
  getRuntimeIdentity(roomId:RoomId):RuntimeIdentity|undefined;
  getContents(roomId:RoomId):WebContents|undefined;
  permitLoginPopup(roomId:RoomId):void;
  openLoginWindow(roomId:RoomId):void;
  dispose():void;
}
export interface SessionPolicy {
  partition(platform:PlatformId):string;
  configure(contents:WebContents,platform:PlatformId,ownerId:number,onBlocked:(category:'navigation'|'popup'|'download'|'permission')=>void):()=>void;
  permit(ownerId:number):void;
  openLogin(platform:PlatformId,ownerId:number):void;
  closeOwner(ownerId:number):void;
  dispose():void;
}
