import { normalizeRoomUrl } from '../../platforms/shared/urls.ts';
import { cleanAnchorNickname } from '../../shared/app-contracts.ts';
import { historyKey } from '../../shared/history-contracts.ts';
import type { HistoryAddress, HistoryNicknameResolver } from '../../shared/history-contracts.ts';

interface Waiter {signal:AbortSignal;abort:()=>void;resolve:(value:string|undefined)=>void}
interface Job {address:HistoryAddress;controller:AbortController;waiters:Set<Waiter>;attempt:number;phase:'queued'|'active'|'waiting';timer?:ReturnType<typeof setTimeout>}
interface Options {lookup:HistoryNicknameResolver;onNickname?:(address:HistoryAddress,nickname:string)=>void}
/** Anonymous public names shared by history and current-room consumers. */
export class AnchorNicknameLookup {
  private readonly options:Options;
  private readonly jobs=new Map<string,Job>();
  private readonly queue:Job[]=[];
  private readonly cache=new Map<string,{nickname:string;expires:number}>();
  private active=0;
  private disposed=false;
  constructor(options:Options){this.options=options;}
  readonly resolve:HistoryNicknameResolver=(address,signal)=>{
    if(this.disposed||signal.aborted)return Promise.resolve(undefined);
    let clean:HistoryAddress;
    try{clean=normalizeRoomUrl(address.canonicalUrl);if(clean.platform!==address.platform||clean.platformRoomId!==address.platformRoomId||clean.canonicalUrl!==address.canonicalUrl)return Promise.resolve(undefined);}catch{return Promise.resolve(undefined);}
    const key=historyKey(clean),cached=this.cache.get(key);
    if(cached&&cached.expires>Date.now()){
      // A cache hit can be the first usable result after an old short-ID room
      // failed its identity attempts; notify current-room consumers as well.
      try{this.options.onNickname?.({...clean},cached.nickname);}catch{/* No external text in diagnostics. */}
      return Promise.resolve(cached.nickname);
    }
    if(cached)this.cache.delete(key);
    let job=this.jobs.get(key);
    if(!job){job={address:clean,controller:new AbortController(),waiters:new Set(),attempt:0,phase:'queued'};this.jobs.set(key,job);this.queue.push(job);}
    const current=job;
    return new Promise(resolve=>{
      const waiter:Waiter={signal,resolve,abort:()=>{signal.removeEventListener('abort',waiter.abort);current.waiters.delete(waiter);resolve(undefined);if(!current.waiters.size)this.cancel(current);}};
      current.waiters.add(waiter);signal.addEventListener('abort',waiter.abort,{once:true});
      if(signal.aborted)waiter.abort();else this.drain();
    });
  };
  private current(job:Job):boolean{return !this.disposed&&this.jobs.get(historyKey(job.address))===job&&!job.controller.signal.aborted&&job.waiters.size>0;}
  private cancel(job:Job):void {
    if(this.jobs.get(historyKey(job.address))!==job)return;
    this.jobs.delete(historyKey(job.address));if(job.timer)clearTimeout(job.timer);job.controller.abort();
    for(const waiter of job.waiters){waiter.signal.removeEventListener('abort',waiter.abort);waiter.resolve(undefined);}job.waiters.clear();
  }
  private finish(job:Job,nickname?:string):void {
    if(!this.current(job))return;
    this.jobs.delete(historyKey(job.address));
    if(nickname){
      // Cache only successes; a transient miss must never become a stored name.
      for(const [key,value] of this.cache)if(value.expires<=Date.now())this.cache.delete(key);
      if(this.cache.size>=512)this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(historyKey(job.address),{nickname,expires:Date.now()+300_000});
      try{this.options.onNickname?.({...job.address},nickname);}catch{/* No external text in diagnostics. */}
    }
    for(const waiter of job.waiters){waiter.signal.removeEventListener('abort',waiter.abort);waiter.resolve(nickname);}job.waiters.clear();
  }
  private drain():void {
    while(!this.disposed&&this.active<2&&this.queue.length){const job=this.queue.shift()!;if(this.current(job)&&job.phase==='queued')void this.run(job);}
  }
  private async run(job:Job):Promise<void>{
    this.active++;job.phase='active';job.attempt++;
    let nickname:string|undefined;
    try{nickname=cleanAnchorNickname(await this.options.lookup(job.address,job.controller.signal));}catch{/* A bounded unknown result follows the same retry policy. */}
    try{
      if(!this.current(job))return;
      if(nickname){this.finish(job,nickname);return;}
      if(job.attempt>=3){this.finish(job);return;}
      job.phase='waiting';job.timer=setTimeout(()=>{job.timer=undefined;if(this.current(job)){job.phase='queued';this.queue.push(job);this.drain();}},[1000,4000][job.attempt-1]);
    }finally{this.active--;this.drain();}
  }
  dispose():void {if(this.disposed)return;this.disposed=true;for(const job of [...this.jobs.values()])this.cancel(job);this.queue.length=0;this.cache.clear();}
}
