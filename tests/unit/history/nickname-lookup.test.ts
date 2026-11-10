import test from 'node:test';
import assert from 'node:assert/strict';
import { AnchorNicknameLookup } from '../../../src/main/metadata/nickname.ts';
import type { HistoryAddress } from '../../../src/shared/history-contracts.ts';
const address:HistoryAddress={platform:'douyu',platformRoomId:'5566',canonicalUrl:'https://www.douyu.com/5566'};
const signal=()=>new AbortController().signal;
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}

test('transient unknown is automatically retried, shared and cached without hardcoded names',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});let calls=0;const events:string[]=[];
  const lookup=new AnchorNicknameLookup({lookup:async()=>++calls===1?undefined:'Simkn',onNickname:(_address,name)=>events.push(name)});t.after(()=>lookup.dispose());
  const first=lookup.resolve(address,signal()),second=lookup.resolve(address,signal());await flush();assert.equal(calls,1);
  t.mock.timers.tick(999);await flush();assert.equal(calls,1);t.mock.timers.tick(1);await flush();
  assert.equal(await first,'Simkn');assert.equal(await second,'Simkn');assert.equal(calls,2);assert.deepEqual(events,['Simkn']);
  assert.equal(await lookup.resolve(address,signal()),'Simkn');assert.equal(calls,2);assert.deepEqual(events,['Simkn','Simkn']);
  t.mock.timers.tick(300001);await lookup.resolve(address,signal());assert.equal(calls,3);
});

test('unknown retries stop after three attempts and never store a room-number nickname',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const lookup=new AnchorNicknameLookup({lookup:async()=>{calls++;throw Error('private transport text');}});t.after(()=>lookup.dispose());
  const value=lookup.resolve(address,signal());await flush();t.mock.timers.tick(1000);await flush();t.mock.timers.tick(4000);await flush();
  assert.equal(await value,undefined);assert.equal(calls,3);t.mock.timers.tick(60000);await flush();assert.equal(calls,3);
});

test('history cancellation does not cancel the current-room consumer of the same query',async t=>{
  let finish!:(name:string)=>void,calls=0,transportSignal:AbortSignal|undefined;
  const lookup=new AnchorNicknameLookup({lookup:async(_address,s)=>{calls++;transportSignal=s;return new Promise(resolve=>{finish=resolve;});}});t.after(()=>lookup.dispose());
  const history=new AbortController(),currentRoom=new AbortController();
  const first=lookup.resolve(address,history.signal),second=lookup.resolve(address,currentRoom.signal);
  history.abort();assert.equal(await first,undefined);assert.equal(transportSignal?.aborted,false);finish('Simkn');assert.equal(await second,'Simkn');assert.equal(calls,1);
});

test('last consumer cancellation and shutdown stop retries and ignore late successful responses',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let finish!:(name:string)=>void;const events:string[]=[];
  const lookup=new AnchorNicknameLookup({lookup:async()=>new Promise(resolve=>{finish=resolve;}),onNickname:(_address,name)=>events.push(name)});
  const controller=new AbortController(),pending=lookup.resolve(address,controller.signal);controller.abort();assert.equal(await pending,undefined);finish('late name');await flush();assert.deepEqual(events,[]);
  lookup.dispose();assert.equal(await lookup.resolve(address,signal()),undefined);t.mock.timers.tick(60000);await flush();assert.deepEqual(events,[]);
});

test('no more than two independent queries run and a cancelled queued room never starts',async t=>{
  const active=new Map<string,(name:string)=>void>(),calls:string[]=[];let peak=0;
  const lookup=new AnchorNicknameLookup({lookup:async a=>{calls.push(a.platformRoomId);return new Promise(resolve=>{active.set(a.platformRoomId,name=>{active.delete(a.platformRoomId);resolve(name);});peak=Math.max(peak,active.size);});}});t.after(()=>lookup.dispose());
  const controllers=Array.from({length:6},()=>new AbortController());
  const pending=controllers.map((controller,i)=>lookup.resolve({...address,platformRoomId:String(5566+i),canonicalUrl:`https://www.douyu.com/${5566+i}`},controller.signal));
  assert.equal(active.size,2);controllers[3].abort();await flush();
  while(active.size){for(const [id,finish] of [...active])finish('主播'+id);await flush();}
  const names=await Promise.all(pending);assert.equal(names[3],undefined);assert.equal(calls.includes('5569'),false);assert.equal(peak,2);assert.equal(calls.length,5);
});

test('cross-platform identities stay separate and invalid saved addresses cannot request metadata',async t=>{
  let calls=0;
  const lookup=new AnchorNicknameLookup({lookup:async a=>{calls++;return a.platform+'主播';}});t.after(()=>lookup.dispose());
  assert.equal(await lookup.resolve(address,signal()),'douyu主播');
  assert.equal(await lookup.resolve({platform:'huya',platformRoomId:'5566',canonicalUrl:'https://www.huya.com/5566'},signal()),'huya主播');
  assert.equal(await lookup.resolve({...address,canonicalUrl:'https://www.douyu.com.evil.test/5566'},signal()),undefined);assert.equal(calls,2);
});

test('aborting a waiting retry leaves no background retry or successful event',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0;
  const lookup=new AnchorNicknameLookup({lookup:async()=>{calls++;return undefined;}});t.after(()=>lookup.dispose());
  const controller=new AbortController(),pending=lookup.resolve(address,controller.signal);await flush();controller.abort();assert.equal(await pending,undefined);
  t.mock.timers.tick(60000);await flush();assert.equal(calls,1);
});
