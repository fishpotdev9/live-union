import type { RoomConfig,RoomId,WorkspaceSnapshot,LayoutResult } from './contracts.ts';
import type { AppCommand } from './app-contracts.ts';
export interface WorkspaceModelApi {
  readonly snapshot:WorkspaceSnapshot;
  readonly geometry:LayoutResult;
  readonly selectedId:RoomId|undefined;
  readonly zoomedId:RoomId|undefined;
  readonly nativeRoomId:RoomId|undefined;
  readonly undoAvailable:boolean;
  setCanvas(canvas:{width:number;height:number}):void;
  addRoom(room:RoomConfig):void;
  removeRoom(roomId:RoomId):void;
  setAudioAllowed(allowed:ReadonlyMap<RoomId,boolean>):void;
  replaceSnapshot(snapshot:WorkspaceSnapshot,preserveTransient?:boolean):void;
  /** Handles only synchronous geometry, selection, chat and rename commands.
   * Runtime/audio/network/catalog commands return false, without effects. */
  apply(command:AppCommand):boolean;
}
