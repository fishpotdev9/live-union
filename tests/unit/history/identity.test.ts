import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHistoryIdentity } from '../../../src/main/history/identity.ts';
import type { HistoryAddress } from '../../../src/shared/history-contracts.ts';
const b:HistoryAddress={platform:'bilibili',platformRoomId:'6',canonicalUrl:'https://live.bilibili.com/6'};
const h:HistoryAddress={platform:'huya',platformRoomId:'anAlias',canonicalUrl:'https://www.huya.com/anAlias'};

test('legacy identity refresh rejects mismatched addresses before network and skips stable native numbers',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must not fetch');});
  await assert.rejects(resolveHistoryIdentity({...b,canonicalUrl:'https://api.example/6'}));
  await assert.rejects(resolveHistoryIdentity({...b,platformRoomId:'7'}));
  for(const address of [{platform:'huya' as const,platformRoomId:'340204',canonicalUrl:'https://www.huya.com/340204'},{platform:'douyu' as const,platformRoomId:'9999',canonicalUrl:'https://www.douyu.com/9999'}])assert.deepEqual(await resolveHistoryIdentity(address),address);
  assert.equal(calls,0);
});

test('B short identity uses fixed anonymous endpoint and rejects unknown or unsafe identities',async t=>{
  let payload:unknown={code:0,data:{room_id:7734200}};
  t.mock.method(globalThis,'fetch',async(url:unknown,options:RequestInit)=>{
    assert.equal(url,'https://api.live.bilibili.com/room/v1/Room/room_init?id=6');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify(payload));
  });
  assert.deepEqual(await resolveHistoryIdentity(b),{platform:'bilibili',platformRoomId:'7734200',canonicalUrl:'https://live.bilibili.com/7734200'});
  for(const bad of [{code:-352,data:{room_id:7734200}},{code:0,data:{room_id:0}},{code:0,data:{room_id:9007199254740992}},{code:0,data:{room_id:'7734200'}}]){payload=bad;await assert.rejects(resolveHistoryIdentity(b));}
});

test('legacy identity bounds streamed bodies and cancels oversized responses',async t=>{
  let cancelled=false;
  t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(65537));},cancel(){cancelled=true;}})));
  await assert.rejects(resolveHistoryIdentity(b));assert.equal(cancelled,true);
});

test('Huya aliases require a unique parsed native profile and do not execute page code',async t=>{
  let source='<script>var TT_PROFILE_INFO = {"profileRoom":340204,"nick":"主播"};</script>';
  t.mock.method(globalThis,'fetch',async(url:unknown,options:RequestInit)=>{assert.equal(url,h.canonicalUrl);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return new Response(source);});
  assert.deepEqual(await resolveHistoryIdentity(h),{platform:'huya',platformRoomId:'340204',canonicalUrl:'https://www.huya.com/340204'});
  source='<script>var TT_PROFILE_INFO = (() => {throw Error("do not execute")})();</script>';await assert.rejects(resolveHistoryIdentity(h));
  source='<script>var TT_PROFILE_INFO = {"profileRoom":340204};var TT_PROFILE_INFO = {"profileRoom":138297};</script>';await assert.rejects(resolveHistoryIdentity(h));
});
