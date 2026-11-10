import type { PlatformId } from '../../shared/contracts.ts';
import { PLATFORM_DETAILS } from '../../shared/platforms.ts';
export interface RoomAddress {platform:PlatformId;platformRoomId:string;canonicalUrl:string}
export function normalizeRoomUrl(input:string):RoomAddress {
  let url:URL;
  try{url=new URL(input.trim());}catch{throw new Error('请输入完整的 HTTPS 直播间链接');}
  if(url.protocol!=='https:'||url.username||url.password||url.port)throw new Error('仅支持三平台的 HTTPS 直播间链接');
  const host=url.hostname.toLowerCase();
  let platform:PlatformId;
  if(['huya.com','www.huya.com'].includes(host))platform='huya';
  else if(['douyu.com','www.douyu.com'].includes(host))platform='douyu';
  else if(host==='live.bilibili.com')platform='bilibili';
  else throw new Error('此链接不属于支持的直播平台');
  const pattern=platform==='bilibili'?/^\/(?:blanc\/)?([0-9]+)\/?$/:platform==='douyu'?/^\/([0-9]+)\/?$/:/^\/([A-Za-z0-9_-]+)\/?$/;
  const match=pattern.exec(url.pathname);
  if(!match)throw new Error('请使用主播直播间链接，而不是首页或分类页');
  let id=match[1];
  if(/^[0-9]+$/.test(id)){id=id.replace(/^0+(?=\d)/,'');if(id==='0')throw new Error('直播间编号无效');}
  if(id.length>128||platform==='huya'&&['g','v','about','download','category','directory','my','user'].includes(id.toLowerCase()))throw new Error('未识别为直播间地址');
  return{platform,platformRoomId:id,canonicalUrl:`https://${PLATFORM_DETAILS[platform].host}/${id}`};
}
