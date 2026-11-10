import type { PlatformId } from './contracts.ts';
export const PLATFORM_IDS:readonly PlatformId[]=['huya','douyu','bilibili'];
export const PLATFORM_DETAILS={
  huya:{label:'虎牙',host:'www.huya.com',chatWidthDip:340,partition:'persist:live-union-g0-huya'},
  douyu:{label:'斗鱼',host:'www.douyu.com',chatWidthDip:380,partition:'persist:live-union-g0-douyu'},
  bilibili:{label:'哔哩哔哩',host:'live.bilibili.com',chatWidthDip:320,partition:'persist:live-union-g0-bilibili'},
} as const;
export function platformPartition(platform:PlatformId):string{return PLATFORM_DETAILS[platform].partition;}
