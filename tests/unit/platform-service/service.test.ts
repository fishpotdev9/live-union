import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, FakeContents, FakeFrame, harness, media } from './fakes.ts';

test('cancelled same-generation navigation cannot overwrite a fresh presentation/media result',async t=>{
  const h=await harness();t.after(()=>h.service.dispose());
  await h.service.present(h.room.id);
  const pending=deferred<unknown>();h.contents.mainFrame.replies.push(pending.promise);
  h.contents.setDynamic({status:'unsupported',reason:'structure'});
  const old=h.service.observe(h.room.id);
  try {
    h.service.cancel(h.room.id); // Navigation can keep both contents and generation.
    assert.equal(h.runtime.getRuntimeIdentity(h.room.id)?.generation,1);
    // Do not call present here: it advances revision independently and could
    // conceal a missing cancel invalidation. A fresh observe keeps the revision.
    h.contents.setDynamic({status:'applied',reason:'layout'});
    h.contents.mainFrame.replies.push([media({currentTime:250})]);await h.service.observe(h.room.id);
    const before={presentations:h.presentations.length,samples:h.samples.length};
    pending.resolve([media({currentTime:5,width:640,height:360})]);await old;
    assert.deepEqual({presentations:h.presentations.length,samples:h.samples.length},before);
    assert.equal(h.state.presentation?.status,'applied');assert.equal(h.state.media?.currentTime,250);
  }finally{pending.resolve([]);await old;}
});

test('releasing and reusing an identity cannot revive pending observations from its previous lifetime',async t=>{
  const h=await harness();t.after(()=>h.service.dispose());
  const pending=deferred<unknown>();h.contents.mainFrame.replies.push(pending.promise);
  const old=h.service.observe(h.room.id);
  try{
    h.service.release(h.room.id);
    await h.service.present(h.room.id);
    h.contents.mainFrame.replies.push([media({currentTime:300})]);await h.service.observe(h.room.id);
    const count=h.samples.length;pending.resolve([media({currentTime:1})]);await old;
    assert.equal(h.samples.length,count);assert.equal(h.state.media?.currentTime,300);
  }finally{pending.resolve([]);await old;}
});

test('room close, removed config and replacement generation each discard late samples',async t=>{
  for(const condition of ['closed-runtime','removed-config','new-generation'] as const)await t.test(condition,async t=>{
    const h=await harness();t.after(()=>h.service.dispose());
    const pending=deferred<unknown>();h.contents.mainFrame.replies.push(pending.promise);h.contents.setDynamic({status:'unsupported',reason:'structure'});
    const old=h.service.observe(h.room.id);
    try {
      if(condition==='closed-runtime')h.runtime.closeRoom(h.room.id);
      else if(condition==='removed-config')h.rooms.delete(h.room.id);
      else {
        h.runtime.identities.set(h.room.id,{roomId:h.room.id,generation:2,webContentsId:22});
        const replacement=new FakeContents();h.runtime.contents.set(h.room.id,replacement);
        replacement.mainFrame.replies.push([media({currentTime:300})]);replacement.setDynamic({status:'restored',reason:'native-page'});
        await h.service.observe(h.room.id);
      }
      const before={presentations:h.presentations.length,samples:h.samples.length};
      pending.resolve([media({currentTime:1})]);await old;
      assert.deepEqual({presentations:h.presentations.length,samples:h.samples.length},before);
      if(condition==='new-generation'){
        assert.equal(h.state.media?.currentTime,300);assert.equal(h.state.presentation?.status,'restored');
        assert.ok(h.presentations.every(event=>event.generation===2));assert.ok(h.samples.every(event=>event.generation===2));
      }
    }finally{pending.resolve([]);await old;}
  });
});

test('a newer presentation supersedes pending presentation results without a generation change',async t=>{
  const h=await harness();t.after(()=>h.service.dispose());
  const pending=deferred<unknown>();h.contents.presentationReplies.push(pending.promise);
  const old=h.service.present(h.room.id);
  try {
    await h.service.present(h.room.id);
    pending.resolve({status:'unsupported',reason:'structure'});await old;
    assert.deepEqual(h.presentations.map(event=>event.result),[{status:'applied',reason:'layout'}]);
  }finally{pending.resolve({status:'failed'});await old;}
});

test('asynchronous Symbol status updates and resize recovery replace an earlier applied state',async t=>{
  const h=await harness();t.after(()=>h.service.dispose());
  await h.service.present(h.room.id);assert.equal(h.state.presentation?.status,'applied');
  h.contents.setDynamic({status:'unsupported',reason:'insufficient-space'});
  h.contents.mainFrame.replies.push([media()]);await h.service.observe(h.room.id);
  assert.deepEqual(h.state.presentation,{status:'unsupported',reason:'insufficient-space'});
  h.contents.setDynamic({status:'applied',reason:'layout'}); // Page's resize observer recovered.
  await h.service.observe(h.room.id);assert.deepEqual(h.state.presentation,{status:'applied',reason:'layout'});
  h.contents.setDynamic({status:'unsupported',reason:'structure-changed'});
  await h.service.observe(h.room.id);assert.equal(h.state.presentation?.status,'unsupported');
});

test('unknown operation text is reduced to fixed status/reason fields in both service paths',async t=>{
  const h=await harness();t.after(()=>h.service.dispose());
  h.contents.presentationReplies.push({status:'account-sensitive-status',reason:'token-sensitive-reason',token:'secret-token',chat:'secret-chat'});
  await h.service.present(h.room.id);assert.deepEqual(h.state.presentation,{status:'failed',reason:'unknown'});
  h.contents.setDynamic({status:'unsupported',reason:'account-sensitive-reason',account:'secret-account'});
  await h.service.observe(h.room.id);assert.deepEqual(h.state.presentation,{status:'unsupported',reason:'unknown'});
  assert.doesNotMatch(JSON.stringify(h.presentations),/secret|sensitive/);
});

test('untrusted media samples reject nonfinite/oversized required values and strip optional numbers and extra fields',async t=>{
  const h=await harness();t.after(()=>h.service.dispose());
  const invalid:Record<string,unknown>[]=[
    {width:Infinity},{height:NaN},{width:32769},{height:0},{currentTime:-1},{currentTime:1e12+1},
    {area:1e10+1},{area:Infinity},{paused:'false'},
  ];
  // Samples are bounded to four per frame; independent observations ensure every
  // invalid value is actually evaluated rather than hidden beyond a slice limit.
  for(const bad of invalid){h.contents.mainFrame.replies.push([media(bad)]);await h.service.observe(h.room.id);assert.equal(h.samples.at(-1)?.value,undefined,JSON.stringify(bad));}
  h.contents.mainFrame.replies.push([media({frames:Infinity,dropped:1e12+1,token:'secret-token',account:{name:'secret-account'},chat:'secret-chat'})]);
  await h.service.observe(h.room.id);
  assert.deepEqual(h.state.media,{width:1920,height:1080,currentTime:120,paused:false,frames:undefined,dropped:undefined});
  assert.doesNotMatch(JSON.stringify(h.samples),/secret|token|account|chat|area/);
});

test('media selection prefers a playing frame over a larger paused one, with bounded Bilibili frame traversal',async t=>{
  const h=await harness('bilibili');t.after(()=>h.service.dispose());
  const root=h.contents.mainFrame;root.replies.push([media({paused:true,area:9e6})]);
  const child=new FakeFrame();child.url='https://live.bilibili.com/blanc/123';child.replies.push([media({width:1280,height:720,currentTime:42,area:100})]);
  const unrelated=new FakeFrame();unrelated.url='https://elsewhere.example/blanc/123';unrelated.replies.push([media({currentTime:999,area:1e9})]);
  root.framesInSubtree=[root,unrelated,child];await h.service.observe(h.room.id);
  assert.equal(h.state.media?.currentTime,42);assert.equal(h.state.media?.width,1280);assert.equal(unrelated.calls.length,0);
});

test('Bilibili observation samples at most four frames and never traverses beyond sixteen candidates',async t=>{
  const h=await harness('bilibili');t.after(()=>h.service.dispose());
  const root=h.contents.mainFrame;
  const children=Array.from({length:20},(_,index)=>{
    const frame=new FakeFrame();frame.url=`https://live.bilibili.com/blanc/${index+1}`;frame.replies.push([media({currentTime:index+1})]);return frame;
  });
  root.framesInSubtree=[root,...children];await h.service.observe(h.room.id);
  assert.equal(root.calls.length+children.reduce((sum,frame)=>sum+frame.calls.length,0),4);
  assert.ok(children.slice(3).every(frame=>frame.calls.length===0));
  // Put the only eligible child outside the traversal window; it must not run.
  for(const child of children)child.url='https://elsewhere.example/frame';
  children[15].url='https://live.bilibili.com/blanc/999';
  root.framesInSubtree=[root,...children];await h.service.observe(h.room.id);
  assert.equal(children[15].calls.length,0);
});

test('schedule cancellation and disposal clear queued work and suppress in-flight callbacks',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=await harness();t.after(()=>h.service.dispose());
  h.service.schedule(h.room.id,[100,200]);h.service.cancel(h.room.id);t.mock.timers.tick(1000);
  assert.equal(h.contents.calls.length,0);
  const pending=deferred<unknown>();h.contents.mainFrame.replies.push(pending.promise);h.contents.setDynamic({status:'unsupported',reason:'structure'});
  const old=h.service.observe(h.room.id);
  h.service.schedule(h.room.id,[100,200]);h.service.dispose();
  pending.resolve([media()]);await old;t.mock.timers.tick(1000);
  assert.deepEqual(h.presentations,[]);assert.deepEqual(h.samples,[]);
});
