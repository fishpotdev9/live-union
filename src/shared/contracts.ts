/** LU data/layout contract v1.0. Container and adapter contracts remain pending G0. */
export const CONTRACT_VERSION = '1.0' as const;
export type PlatformId = 'huya' | 'douyu' | 'bilibili';
export type RoomId = string; // Persisted room and workspace IDs are UUIDs.
export type BaseLayout = 'equal' | 'focus';
export interface RectDip { x:number; y:number; width:number; height:number }
/** Persisted x/y in [0,1], width/height in (0,1], z is a nonnegative safe integer. */
export interface NormalizedRect extends RectDip { z:number }
export interface RoomConfig {
  id:RoomId; platform:PlatformId; platformRoomId:string; canonicalUrl:string; label?:string;
  chat:{visible:boolean;preferredWidthDip:number};
  audio:{allowed:boolean;preferredVolume?:number};
  preferredQuality?:string;
}
export interface WorkspaceSnapshot {
  schemaVersion:1; id:string; name:string; rooms:RoomConfig[]; stableOrder:RoomId[];
  layout:{
    base:BaseLayout; editing:'auto'|'free'; primaryRoomId?:RoomId;
    equal:{variant:string;order:RoomId[]};
    focus:{variant:string;order:RoomId[];primaryShare?:number};
    free:{rects:Record<RoomId,NormalizedRect>;from:BaseLayout};
  };
}
export interface LayoutChrome {
  headerDip:number; footerDip:number; gapDip:number; minWidthDip:number; minHeightDip:number;
}
export interface LayoutInput {
  canvas:{width:number;height:number};
  roomIds:readonly RoomId[];
  template:BaseLayout|'free';
  primaryRoomId?:RoomId;
  chat:Readonly<Record<RoomId,{visible:boolean;preferredWidthDip:number}>>;
  freeRects?:Readonly<Record<RoomId,NormalizedRect>>;
  primaryShare?:number;
  chrome?:Partial<LayoutChrome>;
}
export interface RoomGeometry { outer:RectDip; content:RectDip; z:number }
export interface LayoutResult {
  rooms:Record<RoomId,RoomGeometry>; order:RoomId[]; spaceConstrained:boolean;
  grid?:{columns:number;rows:number};
}
export interface WorkspaceLoadResult {
  snapshot?:WorkspaceSnapshot; source:'primary'|'backup'|'empty'; warnings:string[];
}
