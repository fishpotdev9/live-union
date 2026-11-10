import type { HistoryAddress, HistoryNicknameResolver, RoomHistoryEntry, RoomHistoryState, RoomHistoryStore } from '../../shared/history-contracts.ts';
import { historyKey } from '../../shared/history-contracts.ts';

export interface HistoryCoordinator {
  readonly state:RoomHistoryState;
  initialize():Promise<void>;
  record(address:HistoryAddress):Promise<void>;
  entry(id:string):RoomHistoryEntry|undefined;
  remove(id:string):Promise<void>;
  clear():Promise<void>;
  refreshMetadata(ids?:readonly string[]):void;
  resolveIdentity(address:HistoryAddress):Promise<HistoryAddress>;
  shutdown():Promise<void>;
}
interface Options {
  store:RoomHistoryStore;
  sources:()=>Promise<{rooms:HistoryAddress[];warnings:string[]}>;
  canonicalize?:(address:HistoryAddress)=>Promise<HistoryAddress>;
  nickname:HistoryNicknameResolver;
  changed:()=>void;
}

/** History owns neither playback nor sessions. Metadata cannot create entries. */
export class RoomHistoryService implements HistoryCoordinator {
  private current:RoomHistoryState={status:'loading',entries:[]};
  private loadPromise:Promise<void>|undefined;
  private initialization:Promise<void>|undefined;
  private disposed=false;
  private readonly pending:string[]=[];
  private readonly requests=new Map<string,AbortController>();
  private readonly attempts=new Map<string,number>();
  private active=0;
  private readonly options:Options;
  private backfillPromise:Promise<void>|undefined;
  private readonly identities=new Map<string,HistoryAddress>();
  private readonly recordings=new Set<Promise<void>>();
  constructor(options:Options){this.options=options;}
  get state():RoomHistoryState{return structuredClone(this.current);}
  entry(id:string):RoomHistoryEntry|undefined {const entry=this.current.entries.find(value=>value.id===id);return entry?{...entry}:undefined;}
  private publish():void {if(!this.disposed)this.options.changed();}
  private snapshot():void {this.current.entries=this.options.store.snapshot.entries;this.publish();}
  private fail(message:string):void {this.current.status='error';this.current.warning=message;this.publish();}
  private ensureLoaded():Promise<void>{
    return this.loadPromise??=this.options.store.load().then(result=>{
      if(this.disposed)return;
      this.current.entries=result.snapshot.entries;
      for(const entry of result.snapshot.entries)this.identities.set(historyKey(entry),{platform:entry.platform,platformRoomId:entry.platformRoomId,canonicalUrl:entry.canonicalUrl});
      if(result.warnings.length)this.current.warning='历史记录已从有效备份恢复，请核对。';
      this.publish();
    }).catch(()=>{this.fail('历史记录无法读取，现有直播与组合不受影响。');throw new Error('History unavailable.');});
  }
  initialize():Promise<void>{
    return this.initialization??=this.initializeOnce();
  }
  private async initializeOnce():Promise<void>{
    try{
      await this.ensureLoaded();if(this.disposed)return;
      await this.backfill();
      if(this.disposed)return;
      this.current.status='ready';this.snapshot();
      for(const entry of this.current.entries.slice(0,40))this.enqueue(entry.id,false);
    }catch{if(!this.disposed)this.fail('历史记录初始化未完成，现有直播与组合不受影响。');}
  }
  resolveIdentity(address:HistoryAddress):Promise<HistoryAddress>{
    const known=this.identities.get(historyKey(address));if(known)return Promise.resolve({...known});
    return (this.options.canonicalize?this.options.canonicalize(address):Promise.resolve(address)).then(value=>{
      if(value.platform!==address.platform)throw new Error('Room identity unavailable.');
      this.identities.set(historyKey(address),{...value});return value;
    });
  }
  private backfill():Promise<void>{
    if(this.options.store.snapshot.bootstrapComplete||this.disposed)return Promise.resolve();
    return this.backfillPromise??=this.fillPending().finally(()=>{this.backfillPromise=undefined;});
  }
  private async fillPending():Promise<void>{
    const pending=this.options.store.snapshot.pendingBackfill;
    const source=pending?{rooms:pending,warnings:[]}:await this.options.sources();if(this.disposed)return;
    const distinct=[...new Map(source.rooms.map(address=>[historyKey(address),address])).values()],canonical:HistoryAddress[]=[],unresolved:HistoryAddress[]=[];
    let cursor=0;const worker=async()=>{while(!this.disposed&&cursor<distinct.length){const address=distinct[cursor++];try{canonical.push(await this.resolveIdentity(address));}catch{unresolved.push(address);}}};
    await Promise.all([worker(),worker()]);if(this.disposed)return;
    await this.options.store.bootstrap(canonical,{pending:unresolved});
    if(unresolved.length)this.current.warning='部分旧房号等待确认，将在下次打开历史或重启后继续补入。';
    else if(source.warnings.length)this.current.warning='部分旧组合未能完整读取，已补入可恢复的房间。';
    else if(this.current.warning?.includes('旧房号'))delete this.current.warning;
    this.snapshot();
  }
  record(address:HistoryAddress):Promise<void>{
    if(this.disposed)return Promise.resolve();const captured={platform:address.platform,platformRoomId:address.platformRoomId,canonicalUrl:address.canonicalUrl};
    const operation=(async()=>{try{await this.ensureLoaded();const entry=await this.options.store.record(captured);
      this.identities.set(historyKey(captured),captured);if(this.disposed)return;this.snapshot();this.enqueue(entry.id,true);
    }catch{if(!this.disposed)this.fail('房间已添加，但历史记录未能保存。');}})();
    this.recordings.add(operation);void operation.finally(()=>this.recordings.delete(operation));return operation;
  }
  async remove(id:string):Promise<void>{
    if(this.disposed||this.current.status!=='ready')throw new Error('History not ready.');
    this.requests.get(id)?.abort();this.requests.delete(id);
    for(let index=this.pending.length-1;index>=0;index--)if(this.pending[index]===id)this.pending.splice(index,1);
    try{await this.options.store.remove(id);this.snapshot();}
    catch{this.fail('历史条目未能删除，组合与播放偏好不受影响。');throw new Error('History update failed.');}
  }
  async clear():Promise<void>{
    if(this.disposed||this.current.status!=='ready')throw new Error('History not ready.');
    for(const request of this.requests.values())request.abort();this.requests.clear();this.pending.length=0;
    try{await this.options.store.clear();this.snapshot();}
    catch{this.fail('历史记录未能清空，组合与播放偏好不受影响。');throw new Error('History update failed.');}
  }
  refreshMetadata(ids?:readonly string[]):void {
    if(this.disposed||this.current.status!=='ready')return;
    if(!ids)void this.backfill().catch(()=>{if(!this.disposed){this.current.warning='部分旧房号暂未确认，稍后可重新打开历史重试。';this.publish();}});
    const entries=ids?ids.map(id=>this.entry(id)).filter((entry):entry is RoomHistoryEntry=>!!entry):this.current.entries.slice(0,40);
    for(const entry of entries)this.enqueue(entry.id,false);
  }
  private enqueue(id:string,force:boolean):void {
    if(this.disposed||!this.entry(id))return;
    if(force){this.requests.get(id)?.abort();this.requests.delete(id);this.attempts.delete(id);}
    if(this.requests.has(id)||this.pending.includes(id)||Date.now()-(this.attempts.get(id)??0)<60_000)return;
    this.attempts.set(id,Date.now());this.pending.push(id);this.drain();
  }
  private drain():void {
    while(!this.disposed&&this.active<2&&this.pending.length){
      const id=this.pending.shift()!,entry=this.entry(id);if(!entry)continue;
      const abort=new AbortController();this.requests.set(id,abort);this.active++;
      void (async()=>{
        try{const nickname=await this.options.nickname(entry,abort.signal);
          if(this.disposed||abort.signal.aborted||this.requests.get(id)!==abort||nickname===undefined)return;
          if(await this.options.store.updateNickname(id,nickname)){if(!this.disposed)this.snapshot();}
        }catch{/* Unknown/blocked public metadata must not affect playback or leak responses. */}
        finally{if(this.requests.get(id)===abort)this.requests.delete(id);this.active--;this.drain();}
      })();
    }
  }
  async shutdown():Promise<void>{
    this.disposed=true;this.pending.length=0;for(const request of this.requests.values())request.abort();this.requests.clear();
    await Promise.all([...this.recordings]);
    await this.options.store.flush();
  }
}
