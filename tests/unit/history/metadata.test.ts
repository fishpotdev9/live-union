import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryNicknameResolver } from '../../../src/main/history/metadata.ts';
import type { HistoryAddress } from '../../../src/shared/history-contracts.ts';

const hosts={douyu:'www.douyu.com',huya:'www.huya.com',bilibili:'live.bilibili.com'};
function address(platform:HistoryAddress['platform']='douyu',id='9999'):HistoryAddress {
  return {platform,platformRoomId:id,canonicalUrl:`https://${hosts[platform]}/${id}`};
}
const signal=()=>new AbortController().signal;
function fixture(body:string,contentType='application/json',options:ResponseInit={}):typeof fetch {
  return (async()=>new Response(body,{status:200,headers:{'content-type':contentType},...options})) as typeof fetch;
}
const douyu=(id:unknown=9999,nick:unknown='主播昵称')=>JSON.stringify({room:{room_id:id,nickname:nick,room_name:'直播标题'},nickname:'登录账号'});
const bilibili=(id:unknown=7734200,nick:unknown='B站主播',code:unknown=0)=>JSON.stringify({code,data:{room_info:{room_id:id,title:'标题'},anchor_info:{base_info:{uname:nick}},uname:'其他账号'}});
const huya=(id:unknown=340204,nick:unknown='虎牙主播')=>`<title>直播标题</title><script>var TT_PROFILE_INFO = ${JSON.stringify({profileRoom:id,nick})};</script>`;

function douyuNativeFallback(html:string,changePage?:(response:Response)=>void):typeof fetch {
  return (async(url:unknown,options:RequestInit)=>{
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);
    if(url==='https://www.douyu.com/betard/5556')return new Response('<title>提示信息 -斗鱼</title>',{headers:{'content-type':'text/html; charset=UTF-8'}});
    assert.equal(url,'https://www.douyu.com/5556');const response=new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});changePage?.(response);return response;
  }) as typeof fetch;
}

test('Douyu informational metadata page falls back to the same public room native anchor heading',async()=>{
  const resolver=createHistoryNicknameResolver(douyuNativeFallback('<title>直播标题</title><h3 class="anchorName__6NXv9">果小果是个弟弟</h3>'));
  assert.equal(await resolver(address('douyu','5556'),signal()),'果小果是个弟弟');
  assert.equal(await createHistoryNicknameResolver(douyuNativeFallback('<h3 class="anchorName__abc">Tom &amp; Jerry &#x1F600;</h3>'))(address('douyu','5556'),signal()),'Tom & Jerry 😀');
});

test('Douyu native fallback refuses ambiguous headings, titles, account nodes and executable or attribute decoys',async()=>{
  const heading='<h3 class="anchorName__abc">主播</h3>';
  for(const html of [heading+heading,'<title>主播的直播间</title>','<h3 class="login-user">账号</h3>',`<script>${heading}</script>`,`<!--${heading}-->`,`<template>${heading}</template>`,`<template><template></template>${heading}</template>`,`<xmp>${heading}</xmp>`,`<iframe>${heading}</iframe>`,`<select>${heading}</select>`,`<textarea>${heading}</textarea>`,`<script>${heading}`,`<div title="${heading.replaceAll('"',"'")}"></div>`,`<h3 title=" class='anchorName__abc' ">假名字</h3>`,'<h3 class="anchorName__abc">name&#10;private</h3>','<h3 class="anchorName__abc">&constructor;</h3>','<h3 class="anchorName__abc">&#x202e;name</h3>','<h3 class="anchorName__abc"><span>未知结构</span></h3>']){
    assert.equal(await createHistoryNicknameResolver(douyuNativeFallback(html))(address('douyu','5556'),signal()),undefined);
  }
  for(const html of [`<script>const s=\`</script-not>${heading}\`;</script>`,`<textarea></textarea-x>${heading}</textarea>`,`<h3.foo class="anchorName__abc">wrong tag</h3.foo>`])assert.equal(await createHistoryNicknameResolver(douyuNativeFallback(html))(address('douyu','5556'),signal()),undefined);
});

test('Douyu native fallback keeps origin, redirect and bounded-read checks',async()=>{
  const html='<h3 class="anchorName__abc">主播</h3>';
  for(const mutate of [(response:Response)=>Object.defineProperty(response,'url',{value:'https://www.douyu.com/9999'}),(response:Response)=>Object.defineProperty(response,'redirected',{value:true}),(response:Response)=>response.headers.set('content-length',String(2*1024*1024+1))]){
    assert.equal(await createHistoryNicknameResolver(douyuNativeFallback(html,mutate))(address('douyu','5556'),signal()),undefined);
  }
});

test('Douyu mismatched JSON room identities never fall through to page-name guessing',async()=>{
  let calls=0;const client=(async()=>{calls++;return new Response(douyu(9999,'wrong'),{headers:{'content-type':'application/json'}});}) as typeof fetch;
  assert.equal(await createHistoryNicknameResolver(client)(address('douyu','5556'),signal()),undefined);assert.equal(calls,1);
});

test('public sources read only the room-bound anchor nickname, trimming whitespace',async()=>{
  assert.equal(await createHistoryNicknameResolver(fixture(douyu(9999,'  主播昵称  ')))(address(),signal()),'主播昵称');
  assert.equal(await createHistoryNicknameResolver(fixture(huya(),'text/html'))(address('huya','340204'),signal()),'虎牙主播');
  assert.equal(await createHistoryNicknameResolver(fixture(bilibili()))(address('bilibili','7734200'),signal()),'B站主播');
  assert.equal(await createHistoryNicknameResolver(fixture(douyu('9999')))(address(),signal()),'主播昵称');
});

test('queries use fixed official HTTPS paths with no credentials, redirects or custom headers',async()=>{
  const expected={douyu:'https://www.douyu.com/betard/9999',huya:'https://www.huya.com/340204',bilibili:'https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=7734200'};
  for(const platform of ['douyu','huya','bilibili'] as const){
    const id=platform==='douyu'?'9999':platform==='huya'?'340204':'7734200';
    const client=(async(url:unknown,options:RequestInit)=>{
      assert.equal(url,expected[platform]);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
      assert.deepEqual(Object.keys(options).sort(),['credentials','redirect','signal']);assert.ok(options.signal instanceof AbortSignal);
      return new Response(platform==='huya'?huya():platform==='douyu'?douyu():bilibili(),{headers:{'content-type':platform==='huya'?'text/html; charset=utf-8':'application/json; charset=utf-8'}});
    }) as typeof fetch;
    assert.ok(await createHistoryNicknameResolver(client)(address(platform,id),signal()));
  }
});

test('invalid identities and non-exact canonical URLs cannot initiate network requests',async()=>{
  let calls=0;const resolver=createHistoryNicknameResolver((async()=>{calls++;throw new Error('must not fetch');}) as typeof fetch);
  const invalid:HistoryAddress[]=[
    {...address(),platformRoomId:'0'}, {...address(),platformRoomId:'0009999'},
    {...address(),platformRoomId:'9/../../login'}, {...address(),platformRoomId:'9999?token=x'},
    {...address(),platformRoomId:'9'.repeat(21)},address('huya','alias'),
    {...address(),canonicalUrl:'https://www.douyu.com.evil.test/9999'},
    {...address(),canonicalUrl:'https://www.douyu.com:443/9999'},
    {...address(),canonicalUrl:'https://www.douyu.com/9999/'},
    {...address(),canonicalUrl:'https://user:secret@www.douyu.com/9999'},
    {...address(),canonicalUrl:'https://www.douyu.com/9999?tracking=1'},
    {...address(),canonicalUrl:'http://www.douyu.com/9999'},
    {...address(),canonicalUrl:'https://WWW.DOUYU.COM/9999'},
    {...address(),platform:'unknown' as HistoryAddress['platform']},
  ];
  for(const item of invalid)assert.equal(await resolver(item,signal()),undefined);
  assert.equal(calls,0);
});

test('wrong, missing, unsafe or ambiguous room IDs remain unknown',async()=>{
  for(const id of [1,0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'0009999','9999junk',null]){
    assert.equal(await createHistoryNicknameResolver(fixture(douyu(id)))(address(),signal()),undefined);
  }
  assert.equal(await createHistoryNicknameResolver(fixture(huya(1),'text/html'))(address('huya','340204'),signal()),undefined);
  assert.equal(await createHistoryNicknameResolver(fixture(bilibili(6)))(address('bilibili','7734200'),signal()),undefined);
  for(const raw of ['{"room":{"room_id":1,"room_id":9999,"nickname":"wrong"}}','{"room":{"room_id":9999,"nickname":"one","nick\\u006eame":"two"}}','{"room":{},"room":{"room_id":9999,"nickname":"wrong"}}']){
    assert.equal(await createHistoryNicknameResolver(fixture(raw))(address(),signal()),undefined);
  }
});

test('no title, login name or arbitrary uname fallback; restrictions and malformed data are unknown',async()=>{
  for(const raw of ['{}','null','[]','not json','{"room":{"room_id":9999,"room_name":"title"},"nickname":"login"}']){
    assert.equal(await createHistoryNicknameResolver(fixture(raw))(address(),signal()),undefined);
  }
  for(const code of [-352,-101,'0',null])assert.equal(await createHistoryNicknameResolver(fixture(bilibili(7734200,'untrusted',code)))(address('bilibili','7734200'),signal()),undefined);
  assert.equal(await createHistoryNicknameResolver(fixture('<title>标题 - 主播 - 虎牙</title>','text/html'))(address('huya','340204'),signal()),undefined);
});

test('nicknames reject empty, long, non-string and control-character values',async()=>{
  for(const nick of ['', '   ', 'a'.repeat(257),42,{},null,'name\nsecret','name\x00','name\x7f','name\u0085','name\u2028']){
    assert.equal(await createHistoryNicknameResolver(fixture(douyu(9999,nick)))(address(),signal()),undefined);
  }
  assert.equal(await createHistoryNicknameResolver(fixture(douyu(9999,'a'.repeat(256))))(address(),signal()),'a'.repeat(256));
});

test('Huya only accepts one strict top-level JSON assignment; no eval, comments or quoted decoys',async()=>{
  const resolver=(html:string)=>createHistoryNicknameResolver(fixture(html,'text/html'))(address('huya','340204'),signal());
  const profile=JSON.stringify({profileRoom:340204,nick:'可信主播'});
  assert.equal(await resolver(`<script>window.TT_PROFILE_INFO = ${profile};</script>`),'可信主播');
  assert.equal(await resolver(`<script>var other = {profileRoom:1};\nvar TT_PROFILE_INFO = ${profile};</script>`),'可信主播');
  for(const html of [
    `<script>/* var TT_PROFILE_INFO = ${profile}; */</script>`,
    `<script>var decoy = 'var TT_PROFILE_INFO = ${profile};';</script>`,
    `<script src="https://untrusted.test/x">var TT_PROFILE_INFO = ${profile};</script>`,
    `<script type="application/json">var TT_PROFILE_INFO = ${profile};</script>`,
    `<script>const decoy = /\nvar TT_PROFILE_INFO = ${profile};\n/;</script>`,
    `<script>if(true){var TT_PROFILE_INFO = ${profile};}</script>`,
    `<script>var TT_PROFILE_INFO = {profileRoom:340204,nick:'bad'};</script>`,
    `<script>var TT_PROFILE_INFO = JSON.parse('${profile}');</script>`,
    `<script>var TT_PROFILE_INFO = ${profile} + runCode();</script>`,
    `<script>var TT_PROFILE_INFO = ${profile}; TT_PROFILE_INFO.nick = 'other';</script>`,
    `<script>var TT_PROFILE_INFO = ${profile};</script><script>var TT_PROFILE_INFO = ${profile};</script>`,
    '<script>var TT_PROFILE_INFO = {"profileRoom":1,"profileRoom":340204,"nick":"bad"};</script>',
    '<script>var TT_PROFILE_INFO = {"profileRoom":340204,"nick":(() => "bad")()};</script>',
    '<script>var TT_PROFILE_INFO = {"profileRoom":340204,"nick":"bad";</script>',
  ])assert.equal(await resolver(html),undefined);
  assert.equal(await resolver(`<script>var TT_PROFILE_INFO = ${JSON.stringify({profileRoom:340204,nick:'引号"和}括号'})};</script>`),'引号"和}括号');
});

test('HTTP, content-type, redirect and network failures return unknown without leaking errors',async()=>{
  const a=address();
  for(const status of [301,403,429,500])assert.equal(await createHistoryNicknameResolver(fixture(douyu(),'application/json',{status}))(a,signal()),undefined);
  for(const contentType of ['text/html','application/javascript','text/plain','application/octet-stream']){
    assert.equal(await createHistoryNicknameResolver(fixture(douyu(),contentType))(a,signal()),undefined);
  }
  for(const property of ['url','redirected']){
    const response=new Response(douyu(),{headers:{'content-type':'application/json'}});
    Object.defineProperty(response,property,{value:property==='url'?'https://evil.test/9999':true});
    assert.equal(await createHistoryNicknameResolver((async()=>response) as typeof fetch)(a,signal()),undefined);
  }
  assert.equal(await createHistoryNicknameResolver((async()=>{throw new Error('Cookie: sensitive-value');}) as typeof fetch)(a,signal()),undefined);
});

test('stream reads stop at two MiB even when content-length understates size',async()=>{
  let canceled=false;
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(2*1024*1024));controller.enqueue(new Uint8Array(1));},cancel(){canceled=true;}});
  const response=new Response(body,{headers:{'content-type':'application/json','content-length':'1'}});
  assert.equal(await createHistoryNicknameResolver((async()=>response) as typeof fetch)(address(),signal()),undefined);
  assert.equal(canceled,true);
  for(const size of [String(2*1024*1024+1),'invalid']){
    const rejected=new Response(douyu(),{headers:{'content-type':'application/json','content-length':size}});
    assert.equal(await createHistoryNicknameResolver((async()=>rejected) as typeof fetch)(address(),signal()),undefined);
    assert.equal(rejected.body?.locked,false);
  }
  const exact=douyu()+' '.repeat(2*1024*1024-new TextEncoder().encode(douyu()).byteLength);
  assert.equal(await createHistoryNicknameResolver(fixture(exact))(address(),signal()),'主播昵称');
});

test('UTF-8 split across chunks decodes correctly, malformed input is unknown',async()=>{
  const bytes=new TextEncoder().encode(douyu());
  const response=new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}),{headers:{'content-type':'application/json'}});
  assert.equal(await createHistoryNicknameResolver((async()=>response) as typeof fetch)(address(),signal()),'主播昵称');
  const bad=new Response(Uint8Array.of(0xff),{headers:{'content-type':'application/json'}});
  assert.equal(await createHistoryNicknameResolver((async()=>bad) as typeof fetch)(address(),signal()),undefined);
});

test('external abort skips requests and settles stalled transports/streams',async()=>{
  const aborted=new AbortController();aborted.abort();let called=false;
  assert.equal(await createHistoryNicknameResolver((async()=>{called=true;return new Response();}) as typeof fetch)(address(),aborted.signal),undefined);
  assert.equal(called,false);
  const controller=new AbortController();let requestSignal:AbortSignal|undefined;
  const pending=createHistoryNicknameResolver((async(_url:unknown,options:RequestInit)=>{
    requestSignal=options.signal as AbortSignal;return await new Promise<Response>(()=>{});
  }) as typeof fetch)(address(),controller.signal);
  controller.abort();assert.equal(await pending,undefined);assert.equal(requestSignal?.aborted,true);
  let canceled=false;
  const streamController=new AbortController();
  const response=new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'content-type':'application/json'}});
  const reading=createHistoryNicknameResolver((async()=>response) as typeof fetch)(address(),streamController.signal);
  await Promise.resolve();await Promise.resolve();streamController.abort();assert.equal(await reading,undefined);assert.equal(canceled,true);
});

test('eight-second deadline returns unknown and aborts a stalled transport',async(context)=>{
  context.mock.timers.enable({apis:['setTimeout']});let requestSignal:AbortSignal|undefined;
  const pending=createHistoryNicknameResolver((async(_url:unknown,options:RequestInit)=>{
    requestSignal=options.signal as AbortSignal;return await new Promise<Response>(()=>{});
  }) as typeof fetch)(address(),signal());
  context.mock.timers.tick(7999);assert.equal(requestSignal?.aborted,false);
  context.mock.timers.tick(1);assert.equal(await pending,undefined);assert.equal(requestSignal?.aborted,true);
});
