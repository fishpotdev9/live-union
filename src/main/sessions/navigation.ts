import type { PlatformId } from '../../shared/contracts.ts';

const navigationHosts:Record<PlatformId,readonly string[]>={
  huya:['www.huya.com','huya.com','lgn.huya.com','aq.huya.com'],
  douyu:['www.douyu.com','douyu.com','passport.douyu.com'],
  bilibili:['live.bilibili.com','passport.bilibili.com','www.bilibili.com'],
};
const loginHosts:Record<PlatformId,readonly string[]>={
  huya:['lgn.huya.com','aq.huya.com'],
  douyu:['passport.douyu.com'],
  bilibili:['passport.bilibili.com'],
};
function secureUrl(raw:string):URL|undefined {
  try {
    const url=new URL(raw);
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port ? url : undefined;
  }catch{return undefined;}
}
export function allowedNavigation(platform:PlatformId,url:string):boolean {
  const parsed=secureUrl(url);
  return !!parsed&&navigationHosts[platform].includes(parsed.hostname);
}
export function allowedLogin(platform:PlatformId,url:string):boolean {
  const parsed=secureUrl(url);
  return !!parsed&&loginHosts[platform].includes(parsed.hostname);
}
export function allowedFrame(url:string):boolean {
  if(url==='about:blank'||url==='about:srcdoc')return true;
  if(secureUrl(url))return true;
  try {
    const parsed=new URL(url);
    return parsed.protocol==='blob:'&&!!secureUrl(parsed.origin);
  }catch{return false;}
}
/** Trusted UI permits one owner popup for 30 seconds; no remote text grants it. */
export class PopupPermits {
  private permits=new Map<number,number>();
  private now:()=>number;
  constructor(now:()=>number=Date.now){this.now=now;}
  permit(owner:number):void {this.permits.set(owner,this.now()+30_000);}
  revoke(owner:number):void {this.permits.delete(owner);}
  clear():void {this.permits.clear();}
  consume(owner:number):boolean {
    const until=this.permits.get(owner);
    this.permits.delete(owner);
    return until!==undefined&&until>this.now();
  }
}
