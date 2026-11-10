import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryRepository } from '../../../src/main/history/repository.ts';
import { RoomHistoryService } from '../../../src/main/history/service.ts';
import type { HistoryAddress } from '../../../src/shared/history-contracts.ts';
const a:HistoryAddress={platform:'douyu',platformRoomId:'9999',canonicalUrl:'https://www.douyu.com/9999'};
const b:HistoryAddress={platform:'bilibili',platformRoomId:'7734200',canonicalUrl:'https://live.bilibili.com/7734200'};
async function until(fn:()=>boolean){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.ok(fn());}

test('legacy aliases merge, concurrent actual addition stays MRU, no legacy time is invented',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'live-union-history-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let release!:(value:{rooms:HistoryAddress[];warnings:string[]})=>void;
  const source=new Promise<{rooms:HistoryAddress[];warnings:string[]}>(r=>{release=r;});
  const store=new HistoryRepository(dir),service=new RoomHistoryService({store,sources:()=>source,canonicalize:async()=>b,nickname:async()=>undefined,changed(){}});
  t.after(()=>service.shutdown());const init=service.initialize();await service.record(a);
  release({rooms:[{platform:'bilibili',platformRoomId:'6',canonicalUrl:'https://live.bilibili.com/6'},b],warnings:[]});await init;
  assert.equal(service.state.status,'ready');assert.deepEqual(service.state.entries.map(e=>e.platformRoomId),['9999','7734200']);assert.equal(service.state.entries[1].lastAddedAt,null);assert.equal(typeof service.state.entries[0].lastAddedAt,'number');
});

test('late anonymous nickname never recreates removed/cleared entries or updates a re-add UUID',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'live-union-history-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const releases:Array<(value:string|undefined)=>void>=[];
  const store=new HistoryRepository(dir),service=new RoomHistoryService({store,sources:async()=>({rooms:[],warnings:[]}),nickname:()=>new Promise(r=>releases.push(r)),changed(){}});
  await service.initialize();await service.record(a);await until(()=>releases.length===1);const id=service.state.entries[0].id;
  await service.remove(id);await service.record(a);const newId=service.state.entries[0].id;assert.notEqual(newId,id);
  releases[0]('旧异步主播');await until(()=>releases.length===2);assert.equal(service.state.entries[0].nickname,undefined);
  await service.clear();releases[1]('迟到主播');await new Promise(r=>setTimeout(r,20));assert.deepEqual(service.state.entries,[]);
  await service.shutdown();const reopened=new HistoryRepository(dir);assert.deepEqual((await reopened.load()).snapshot.entries,[]);assert.equal(reopened.snapshot.bootstrapComplete,true);
});

test('anonymous unknown keeps room-ID fallback, and nickname enrichment changes neither order nor add time',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'live-union-history-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const service=new RoomHistoryService({store:new HistoryRepository(dir),sources:async()=>({rooms:[a,b],warnings:[]}),nickname:async address=>address.platform==='douyu'?'yyfyyf':undefined,changed(){}});
  await service.initialize();await until(()=>service.state.entries.some(e=>e.nickname==='yyfyyf'));assert.ok(service.state.entries.every(e=>e.lastAddedAt===null));assert.equal(service.state.entries.find(e=>e.platform==='bilibili')?.nickname,undefined);
  const id=service.state.entries[0].id;await service.remove(id);await service.shutdown();
});

test('history source failure is honest and leaves normal record storage isolated',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'live-union-history-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const service=new RoomHistoryService({store:new HistoryRepository(dir),sources:async()=>{throw Error('PRIVATE_COOKIE');},nickname:async()=>undefined,changed(){}});
  await service.initialize();assert.equal(service.state.status,'error');assert.ok(!service.state.warning?.includes('PRIVATE'));
  await service.record(a);assert.equal(service.state.entries.length,1);await service.shutdown();
});

test('unresolved legacy identities persist separately, retry and merge without duplicate entries',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'live-union-history-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));const short={...b,platformRoomId:'6',canonicalUrl:'https://live.bilibili.com/6'};
  const first=new RoomHistoryService({store:new HistoryRepository(dir),sources:async()=>({rooms:[a,short],warnings:[]}),canonicalize:async address=>{if(address.platform==='bilibili')throw Error('offline');return address;},nickname:async()=>undefined,changed(){}});
  await first.initialize();assert.deepEqual(first.state.entries.map(e=>e.platformRoomId),['9999']);await first.record(b);await first.shutdown();
  const saved=new HistoryRepository(dir);const snap=(await saved.load()).snapshot;assert.equal(snap.bootstrapComplete,false);assert.equal(snap.pendingBackfill?.[0].platformRoomId,'6');
  const second=new RoomHistoryService({store:saved,sources:async()=>{throw Error('must use pending seeds');},canonicalize:async()=>b,nickname:async()=>undefined,changed(){}});await second.initialize();assert.equal(second.state.entries.filter(e=>e.platform==='bilibili').length,1);assert.equal(saved.snapshot.bootstrapComplete,true);assert.equal(saved.snapshot.pendingBackfill,undefined);await second.shutdown();
});

test('clearing pending bootstrap prevents later network recovery from repopulating old rooms',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'live-union-history-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const first=new RoomHistoryService({store:new HistoryRepository(dir),sources:async()=>({rooms:[b],warnings:[]}),canonicalize:async()=>{throw Error();},nickname:async()=>undefined,changed(){}});await first.initialize();await first.clear();await first.shutdown();
  let calls=0;const second=new RoomHistoryService({store:new HistoryRepository(dir),sources:async()=>{calls++;return{rooms:[b],warnings:[]};},canonicalize:async()=>b,nickname:async()=>undefined,changed(){}});await second.initialize();assert.deepEqual(second.state.entries,[]);assert.equal(calls,0);await second.shutdown();
});

test('single deletion preserves unrelated pending aliases and excludes deleted canonical room after recovery',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'live-union-history-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const alias={...b,platformRoomId:'6',canonicalUrl:'https://live.bilibili.com/6'},other={...b,platformRoomId:'7',canonicalUrl:'https://live.bilibili.com/7'},resolvedOther={...b,platformRoomId:'7000',canonicalUrl:'https://live.bilibili.com/7000'};
  const first=new RoomHistoryService({store:new HistoryRepository(dir),sources:async()=>({rooms:[a,alias,other],warnings:[]}),canonicalize:async address=>{if(address.platform==='bilibili')throw Error();return address;},nickname:async()=>undefined,changed(){}});
  await first.initialize();await first.record(b);await first.remove(first.state.entries.find(e=>e.platform==='bilibili')!.id);await first.shutdown();
  const store=new HistoryRepository(dir);assert.equal((await store.load()).snapshot.pendingBackfill?.length,2);
  const second=new RoomHistoryService({store,sources:async()=>{throw Error();},canonicalize:async address=>address.platformRoomId==='6'?b:resolvedOther,nickname:async()=>undefined,changed(){}});
  await second.initialize();assert.deepEqual(second.state.entries.map(e=>e.platformRoomId),['9999','7000']);assert.equal(store.snapshot.bootstrapComplete,true);
  await second.record(b);assert.equal(second.state.entries[0].platformRoomId,'7734200');await second.shutdown();
});

test('visible/search metadata requests can reach entries beyond the initial forty',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'live-union-history-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));const calls:string[]=[];
  const rooms=Array.from({length:41},(_,i)=>({platform:'douyu' as const,platformRoomId:String(1000+i),canonicalUrl:`https://www.douyu.com/${1000+i}`}));
  const service=new RoomHistoryService({store:new HistoryRepository(dir),sources:async()=>({rooms,warnings:[]}),nickname:async address=>{calls.push(address.platformRoomId);return undefined;},changed(){}});await service.initialize();await until(()=>calls.length===40);const tail=service.state.entries[40];service.refreshMetadata([tail.id]);await until(()=>calls.includes(tail.platformRoomId));await service.shutdown();
});

test('shutdown flushes accepted history records even when initial disk load finishes later',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'live-union-history-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new HistoryRepository(dir),load=store.load.bind(store);let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});store.load=async()=>{await gate;return load();};
  const service=new RoomHistoryService({store,sources:async()=>({rooms:[],warnings:[]}),nickname:async()=>undefined,changed(){}});const recording=service.record(a);let done=false;const closing=service.shutdown().then(()=>{done=true;});await Promise.resolve();assert.equal(done,false);release();await Promise.all([recording,closing]);assert.equal((await new HistoryRepository(dir).load()).snapshot.entries[0].platformRoomId,'9999');
});
