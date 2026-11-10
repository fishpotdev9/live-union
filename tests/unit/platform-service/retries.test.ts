import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, harness } from './fakes.ts';

async function flush():Promise<void> {for(let turn=0;turn<8;turn++)await Promise.resolve();}
const unavailable={status:'unsupported',reason:'player-structure'};

test('persistent structural failure retries finitely with increasing backoff and never reloads',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const h=await harness();t.after(()=>h.service.dispose());
  const times:number[]=[];
  const execute=h.contents.executeJavaScript.bind(h.contents);
  t.mock.method(h.contents,'executeJavaScript',(script:string)=>{times.push(Date.now());return execute(script);});
  h.contents.presentationReplies.push(...Array(30).fill(unavailable));
  // An empty initial schedule isolates recovery from the independent readiness probes.
  h.service.schedule(h.room.id,[]);await h.service.present(h.room.id);
  for(let elapsed=0;elapsed<120_000;elapsed+=500){t.mock.timers.tick(500);await flush();}
  assert.equal(times.length-1,5,'persistent failure must stop after five recovery attempts');
  const intervals=times.slice(1).map((time,index)=>time-times[index]);
  assert.ok(intervals[0]>=1000,'recovery must wait rather than spin immediately');
  assert.ok(intervals.slice(1).every((interval,index)=>interval>intervals[index]),'each successive recovery interval must increase');
  const stopped=times.length;t.mock.timers.tick(86_400_000);await flush();assert.equal(times.length,stopped);
  assert.deepEqual(h.runtime.reloads,[]);assert.equal(h.contents.reloadCalls,0);
});

test('initial readiness probes stay independent while duplicate structural observations share one pending retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const h=await harness();t.after(()=>h.service.dispose());
  h.contents.presentationReplies.push(...Array(20).fill(unavailable));
  h.contents.setDynamic(unavailable);
  h.service.schedule(h.room.id,[25,50]);
  t.mock.timers.tick(25);await flush();assert.equal(h.presentations.length,1);
  for(let index=0;index<5;index++)await h.service.observe(h.room.id);
  t.mock.timers.tick(25);await flush();
  assert.equal(h.prefs.length,2,'the second initial probe must run despite a pending recovery');
  t.mock.timers.tick(950);await flush();assert.equal(h.prefs.length,2,'observations must not create immediate retries');
  t.mock.timers.tick(25);await flush();assert.equal(h.prefs.length,3,'only one pending recovery should fire');
  assert.deepEqual(h.runtime.reloads,[]);assert.equal(h.contents.reloadCalls,0);
});

test('cancel and dispose remove pending recovery and initial timers',async t=>{
  for(const action of ['cancel','dispose'] as const)await t.test(action,async t=>{
    t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
    const h=await harness();t.after(()=>h.service.dispose());
    h.contents.presentationReplies.push(...Array(20).fill(unavailable));
    h.service.schedule(h.room.id,[100]);await h.service.present(h.room.id);
    const before={calls:h.contents.calls.length,presentations:h.presentations.length};
    if(action==='cancel')h.service.cancel(h.room.id);else h.service.dispose();
    t.mock.timers.tick(86_400_000);await flush();
    assert.deepEqual({calls:h.contents.calls.length,presentations:h.presentations.length},before);
    assert.deepEqual(h.runtime.reloads,[]);assert.equal(h.contents.reloadCalls,0);
  });
});

test('cancel during an in-flight recovery drops its late result and prevents another retry',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
  const h=await harness();t.after(()=>h.service.dispose());
  h.service.schedule(h.room.id,[]);h.contents.presentationReplies.push(unavailable);await h.service.present(h.room.id);
  const pending=deferred<unknown>();h.contents.presentationReplies.push(pending.promise);
  const running:Promise<void>[]=[];const present=h.service.present.bind(h.service);
  t.mock.method(h.service,'present',(roomId:string)=>{const result=present(roomId);running.push(result);return result;});
  t.mock.timers.tick(1000);await flush();assert.equal(running.length,1);
  try {
    const before=h.presentations.length;h.service.cancel(h.room.id);
    pending.resolve({status:'unsupported',reason:'structure'});await Promise.all(running);
    assert.equal(h.presentations.length,before,'a cancelled recovery cannot publish its late operation result');
    t.mock.timers.tick(86_400_000);await flush();assert.equal(running.length,1);
    assert.deepEqual(h.runtime.reloads,[]);assert.equal(h.contents.reloadCalls,0);
  }finally{pending.resolve({status:'failed'});await Promise.all(running);}
});

test('native mode, size constraints and overlays do not initiate structural recovery',async t=>{
  for(const scenario of [
    {name:'native mode',native:true,result:unavailable},
    {name:'insufficient space',native:false,result:{status:'unsupported',reason:'insufficient-space'}},
    {name:'chat width',native:false,result:{status:'unsupported',reason:'invalid-chat-width'}},
    {name:'native overlay',native:false,result:{status:'unsupported',reason:'native-overlay'}},
  ])await t.test(scenario.name,async t=>{
    t.mock.timers.enable({apis:['setTimeout','Date'],now:0});
    const h=await harness();t.after(()=>h.service.dispose());h.setNative(scenario.native);
    h.contents.presentationReplies.push(...Array(20).fill(scenario.result));h.contents.setDynamic(scenario.result);
    h.service.schedule(h.room.id,[]);await h.service.present(h.room.id);await h.service.observe(h.room.id);
    const initialCalls=h.contents.calls.length;
    t.mock.timers.tick(86_400_000);await flush();assert.equal(h.contents.calls.length,initialCalls);
    assert.equal(h.prefs.length,1);assert.deepEqual(h.runtime.reloads,[]);assert.equal(h.contents.reloadCalls,0);
  });
});
