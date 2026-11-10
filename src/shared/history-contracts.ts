import type { PlatformId } from './contracts.ts';

/** Room history v1.1. No account/session or playback preference fields. */
export const HISTORY_CONTRACT_VERSION='1.1' as const;
export interface HistoryAddress {
  platform:PlatformId;
  platformRoomId:string;
  canonicalUrl:string;
}
export interface RoomHistoryEntry extends HistoryAddress {
  id:string;
  nickname?:string;
  /** Actual successful addition time; null for legacy workspace backfill. */
  lastAddedAt:number|null;
}
export interface RoomHistorySnapshot {
  schemaVersion:1;
  bootstrapComplete:boolean;
  /** Most recent actual additions first; legacy seeds follow deterministically. */
  entries:RoomHistoryEntry[];
  /** Unconfirmed legacy aliases are retried, never exposed as duplicate entries. */
  pendingBackfill?:HistoryAddress[];
}
export interface RoomHistoryState {
  status:'loading'|'ready'|'error';
  entries:RoomHistoryEntry[];
  warning?:string;
}
export interface RoomHistoryLoadResult {snapshot:RoomHistorySnapshot;warnings:string[]}
/** Main-process boundary. The repository owns one trusted app Config directory. */
export interface RoomHistoryStore {
  readonly snapshot:RoomHistorySnapshot;
  load():Promise<RoomHistoryLoadResult>;
  bootstrap(addresses:readonly HistoryAddress[],options?:{pending?:readonly HistoryAddress[]}):Promise<void>;
  record(address:HistoryAddress):Promise<RoomHistoryEntry>;
  updateNickname(id:string,nickname:string):Promise<boolean>;
  remove(id:string):Promise<void>;
  clear():Promise<void>;
  flush():Promise<void>;
}
/** Public, anonymous, bounded lookup; undefined is a normal unknown result. */
export type HistoryNicknameResolver=(address:HistoryAddress,signal:AbortSignal)=>Promise<string|undefined>;
export function historyKey(address:HistoryAddress):string {return `${address.platform}:${address.platformRoomId}`;}
export function historyEntryLabel(entry:RoomHistoryEntry):string {
  return `${{huya:'虎牙',douyu:'斗鱼',bilibili:'B站'}[entry.platform]}－${entry.nickname||entry.platformRoomId}`;
}
