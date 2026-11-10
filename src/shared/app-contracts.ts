import type { LayoutResult, PlatformId, RoomConfig, RoomId, WorkspaceSnapshot } from './contracts.ts';
import type { RoomHistoryState } from './history-contracts.ts';

export const APP_CONTRACT_VERSION='1.2' as const;
export const UI_METRICS={toolbarDip:128,headerDip:36,footerDip:8,gapDip:8,minWidthDip:220,minHeightDip:120} as const;
export type Capability='supported'|'unsupported'|'unknown';
export interface RoomCapabilities {
  nativePlayback:Capability; nativeChat:Capability; chatVisibility:Capability;
  nativeDanmakuSettings:Capability; loginObservation:Capability; qualityObservation:Capability;
  volumeControl:Capability; compactPage:Capability;
}
export interface MediaObservation {
  width:number; height:number; paused:boolean; currentTime:number; frames?:number; dropped?:number;
  documentEpoch?:number;videoInstance?:number;readyState?:number;networkState?:number;
}
export interface RoomRuntimeState {
  id:RoomId; generation:number; webContentsId:number;
  navigation:'idle'|'loading'|'ready'|'error'|'closed';
  live:'unknown'|'live'|'offline'|'buffering'|'failed';
  login:'unknown'|'signedOut'|'signedIn'|'challenge';
  adaptation:'detecting'|'ready'|'degraded'|'unsupported';
  capabilities:RoomCapabilities;
  pageAudioActive:boolean; containerMuted:boolean; documentNavigations:number;
  media?:MediaObservation; errorCode?:number; message?:string;
  /** Public room-bound anchor name; independent of removable history entries. */
  anchorNickname?:string;
}
export interface WorkspaceEntry {id:string;name:string}
export interface AppState {
  contractVersion:typeof APP_CONTRACT_VERSION; revision:number;
  workspace:WorkspaceSnapshot; workspaces:WorkspaceEntry[];
  runtime:Record<RoomId,RoomRuntimeState>; geometry:LayoutResult;
  canvas:{width:number;height:number};
  selectedId?:RoomId; zoomedId?:RoomId; nativeRoomId?:RoomId;
  undoAvailable:boolean; saveStatus:'saved'|'saving'|'error';
  history?:RoomHistoryState;
  historyOpen?:boolean;
  message?:{level:'info'|'warning'|'error';text:string};
}
export type AppCommand =
  | {type:'getState'}
  | {type:'addRoom';url:string}
  | {type:'addHistoryRoom'|'removeHistoryRoom';historyId:string}
  | {type:'clearHistory'}
  | {type:'setHistoryOpen';open:boolean}
  | {type:'refreshHistoryMetadata';historyIds:string[]}
  | {type:'removeRoom'|'reloadRoom'|'selectRoom'|'raiseRoom'|'soloAudio'|'showRoomMenu';roomId:RoomId}
  | {type:'setAudio';roomId:RoomId;allowed:boolean}
  | {type:'muteAll'}
  | {type:'setChat';roomId:RoomId;visible:boolean}
  | {type:'setAllChat';visible:boolean}
  | {type:'setChatWidth';roomId:RoomId;widthDip:number}
  | {type:'setTemplate';template:'equal'|'focus'}
  | {type:'setPrimary';roomId:RoomId}
  | {type:'setFree';fromCurrent?:boolean}
  | {type:'arrange'|'undoGeometry'}
  | {type:'setZoom';roomId:RoomId;enabled:boolean}
  | {type:'setNative';roomId:RoomId;enabled:boolean}
  | {type:'geometryBegin';roomId:RoomId;gestureId:string;kind:'move'|'resize'}
  | {type:'geometryDelta';roomId:RoomId;gestureId:string;dx:number;dy:number}
  | {type:'geometryEnd';roomId:RoomId;gestureId:string}
  | {type:'renameWorkspace'|'saveWorkspaceAs';name:string}
  | {type:'openWorkspace';workspaceId:string}
  | {type:'toggleFullscreen'};
export type CommandResult={ok:true;revision:number}|{ok:false;error:string};
export interface LiveUnionBridge {
  command(command:AppCommand):Promise<CommandResult>;
  onState(listener:(state:AppState)=>void):()=>void;
}
export type AudioIntent={kind:'set';roomId:RoomId;allowed:boolean}|{kind:'solo';roomId:RoomId}|{kind:'muteAll'};
export interface PresentationPreferences {compact:boolean;chatVisible:boolean;chatWidthDip:number}
export interface OperationResult {status:'applied'|'restored'|'unsupported'|'notReady'|'failed';reason?:string}
export interface PlatformPresentation {
  readonly id:PlatformId; readonly version:string;
  build(prefs:PresentationPreferences):string;
}
export function emptyCapabilities():RoomCapabilities {
  return {nativePlayback:'unknown',nativeChat:'unknown',chatVisibility:'unknown',nativeDanmakuSettings:'unknown',loginObservation:'unknown',qualityObservation:'unknown',volumeControl:'unknown',compactPage:'unknown'};
}
export function cleanAnchorNickname(value:unknown):string|undefined {
  return typeof value==='string'&&value.trim()&&value.length<=256&&!/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(value)?value.trim():undefined;
}
export function roomDisplayName(room:RoomConfig,anchorNickname?:string):string {
  return cleanAnchorNickname(anchorNickname)||room.label||room.platformRoomId;
}
export function roomLabel(room:RoomConfig,anchorNickname?:string):string {
  return `${{huya:'虎牙',douyu:'斗鱼',bilibili:'B站'}[room.platform]}－${roomDisplayName(room,anchorNickname)}`;
}
