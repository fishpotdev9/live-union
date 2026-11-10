import type { HistoryAddress } from '../../shared/history-contracts.ts';
import { normalizeRoomUrl } from '../../platforms/shared/urls.ts';
import { parseHuyaHistoryIdentity } from './metadata.ts';

/** Optional legacy B short-ID refresh, anonymous and separate from account sessions. */
export async function resolveHistoryIdentity(address:HistoryAddress):Promise<HistoryAddress>{
  const clean=normalizeRoomUrl(address.canonicalUrl);
  if(clean.platform!==address.platform||clean.platformRoomId!==address.platformRoomId||clean.canonicalUrl!==address.canonicalUrl)throw new Error('Invalid saved room identity.');
  const huyaAlias=clean.platform==='huya'&&!/^[0-9]+$/.test(clean.platformRoomId);
  if(clean.platform!=='bilibili'&&!huyaAlias)return clean;
  const url=huyaAlias?clean.canonicalUrl:`https://api.live.bilibili.com/room/v1/Room/room_init?id=${clean.platformRoomId}`;
  const response=await fetch(url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok||!response.body)throw new Error('Saved room identity unavailable.');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>(huyaAlias?2*1024*1024:64*1024))throw new Error('Saved room identity unavailable.');chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
  const text=Buffer.concat(chunks).toString('utf8');
  if(huyaAlias){const id=parseHuyaHistoryIdentity(text);if(!id)throw new Error('Saved alias requires confirmation.');return{platform:'huya',platformRoomId:id,canonicalUrl:`https://www.huya.com/${id}`};}
  const data=JSON.parse(text) as {code?:unknown;data?:{room_id?:unknown}};
  const id=data.data?.room_id;if(data.code!==0||typeof id!=='number'||!Number.isSafeInteger(id)||id<=0)throw new Error('Saved room identity unavailable.');
  return{platform:'bilibili',platformRoomId:String(id),canonicalUrl:`https://live.bilibili.com/${id}`};
}
