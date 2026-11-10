import { session } from 'electron';
import { normalizeRoomUrl,type RoomAddress } from '../../platforms/shared/urls.ts';
import { platformPartition } from '../../shared/platforms.ts';
import { douyuLiveState } from './public-room-state.ts';
export async function resolveRoom(input:string):Promise<RoomAddress&{live:'live'|'offline'|'unknown'}>{
  const address=normalizeRoomUrl(input);
  const client=session.fromPartition(platformPartition(address.platform));
  try{
    if(address.platform==='douyu'){
      const response=await client.fetch(`https://www.douyu.com/betard/${address.platformRoomId}`,{signal:AbortSignal.timeout(8000),redirect:'error',credentials:'omit'});
      return{...address,live:douyuLiveState(await response.json())};
    }else if(address.platform==='bilibili'){
      const response=await client.fetch(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${address.platformRoomId}`,{signal:AbortSignal.timeout(8000),redirect:'error',credentials:'omit'});
      const result=await response.json() as {code?:unknown;data?:{room_id?:unknown;live_status?:unknown}};
      if(result.code===0&&typeof result.data?.room_id==='number'&&Number.isSafeInteger(result.data.room_id)&&result.data.room_id>0){
        const id=String(result.data.room_id);
        return{platform:'bilibili',platformRoomId:id,canonicalUrl:`https://live.bilibili.com/${id}`,live:result.data.live_status===1?'live':result.data.live_status===0?'offline':'unknown'};
      }
    }else{
      const response=await client.fetch(address.canonicalUrl,{signal:AbortSignal.timeout(8000),redirect:'error'});
      const html=await response.text();
      const match=/["']profileRoom["']\s*:\s*["']?([1-9][0-9]{0,19})/.exec(html.slice(0,2_000_000));
      if(match){const id=match[1],state=/["']state["']\s*:\s*["'](ON|OFF|REPLAY)["']/.exec(html);return{platform:'huya',platformRoomId:id,canonicalUrl:`https://www.huya.com/${id}`,live:state?.[1]==='ON'?'live':state?.[1]==='OFF'?'offline':'unknown'};}
    }
  }catch{/* Keep diagnostics free of response contents, tokens and request URLs. */}
  // Numeric native identities remain usable if the optional public resolver is unavailable.
  // Alias resolution must succeed rather than creating an unprovable second identity.
  if(address.platform==='huya'&&!/^[0-9]+$/.test(address.platformRoomId))throw new Error('暂时无法确认该别名房间，请改用平台数字房间链接');
  // Bilibili short numbers and long room IDs share the same numeric syntax.
  // An unresolved number cannot safely be treated as an independent identity.
  if(address.platform==='bilibili')throw new Error('暂时无法确认B站房间身份，请稍后重试');
  return{...address,live:'unknown'};
}
