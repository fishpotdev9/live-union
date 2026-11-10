'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {analyze,parseRecords,LIMITS}=require('../../../scripts/performance/analyze.cjs');
const BASE=Date.parse('2026-11-07T00:00:00.000Z'),SOURCE='a'.repeat(64);
function fixture({duration=3900000,step=10000,fps=30,drop=.01,memory=4*1024**3}={}) {
  const times=[];for(let t=0;t<=duration;t+=step)times.push(t);if(times.at(-1)!==duration)times.push(duration);
  return times.map(t=>({at:new Date(BASE+t).toISOString(),runId:'test-run',sourceSha256:SOURCE,kind:'real-platform-development',
    window:{visible:true,minimized:false,focused:true,ownedVisibleWindows:0},canvas:{width:900,height:900},
    layout:{base:'equal',editing:'auto',zoomed:false,native:false},
    rooms:Array.from({length:9},(_,i)=>({id:`internal-${i}`,platform:['huya','douyu','bilibili'][Math.floor(i/3)],
      audioAllowed:false,geometry:{outer:{x:i%3*300,y:Math.floor(i/3)*300,width:300,height:300}},
      runtime:{generation:i+1,webContentsId:i+10,documentNavigations:1,navigation:'ready',containerMuted:true,
        media:{width:1920,height:1080,paused:false,currentTime:t/1000,frames:Math.round(t/1000*fps),dropped:Math.floor(t/1000*fps*drop),documentEpoch:100,videoInstance:1}}})),
    processes:[{pid:100,cpuPercent:125,privateKiB:(typeof memory==='function'?memory(t):memory)/1024,memoryKiB:5*1024**2}]}));
}
function hardware(samples,cpu=50) {return samples.map(s=>({at:s.at,sourceSampleAt:s.at,sourceSha256:s.sourceSha256,roomCount:9,systemCpuPercent:cpu}));}
function selected(report) {return report.segments[report.selectedSegmentIndex];}
function codes(report) {return report.issues.map(i=>i.code);}

test('complete numerical hour passes while full real acceptance stays explicitly unverified',()=>{
  const samples=fixture(),r=analyze(samples,hardware(samples));
  assert.equal(r.measuredCriteriaPass,true);assert.equal(r.completePass,false);assert.equal(r.fullAt30Pass,false);
  const s=selected(r);assert.equal(s.stableCoverageMs,3600000);assert.equal(s.rooms.length,9);
  assert.equal(s.rooms[0].minPresentedFps,29.7);assert.equal(s.rooms[0].maxDropRatio,.01);
  assert.equal(s.memory.ratio,1);assert.equal(s.systemCpu.status,'passed');
  assert.equal(s.appProcessCpuApiPercent[0].max,125);assert.equal(s.systemCpu.p95Percent,50);
});
test('totalVideoFrames includes dropped: do not let 30 total/24 presented pass',()=>{
  const samples=fixture({drop:.2}),r=analyze(samples,hardware(samples));
  assert.equal(r.measuredCriteriaPass,false);assert.equal(selected(r).rooms[0].totalFps.mean,30);
  assert.equal(selected(r).rooms[0].minPresentedFps,24);assert.ok(selected(r).rooms[0].failedMinuteWindows.length);
  assert.ok(selected(r).rooms[0].failedFiveMinuteWindows.length);
});
test('checks rolling windows rather than hourly average or minute buckets',()=>{
  const samples=fixture({fps:40,drop:0});
  // 35s stall straddles two minute buckets: those buckets stay >=25fps, rolling window fails.
  for(const s of samples) {const t=(Date.parse(s.at)-BASE)/1000,stall=Math.max(0,Math.min(35,t-345));for(const r of s.rooms)r.runtime.media.frames=Math.round(40*(t-stall));}
  const r=analyze(samples,hardware(samples));assert.equal(r.measuredCriteriaPass,false);
  assert.ok(selected(r).rooms[0].minPresentedFps<25);
});
test('zero frame progress fails; silence in counters is not playback',()=>{
  const samples=fixture({fps:0,drop:0}),r=analyze(samples,hardware(samples));assert.equal(r.measuredCriteriaPass,false);
  assert.equal(selected(r).rooms[0].minPresentedFps,0);assert.ok(selected(r).rooms[0].failedFiveMinuteWindows.length);
});
test('reasonable 10.3s sampling drift still gives exact 60 minute stable coverage',()=>{
  const samples=fixture({step:10300}),r=analyze(samples,hardware(samples));
  assert.equal(r.measuredCriteriaPass,true);assert.equal(selected(r).stableCoverageMs,LIMITS.stableMs);
});
test('short history never substitutes for warmup plus one hour',()=>{
  const samples=fixture({duration:3600000}),r=analyze(samples,hardware(samples));
  assert.equal(r.measuredCriteriaPass,false);assert.equal(selected(r).stableCoverageMs,3300000);
});
test('missing samples split, and partial segments never concatenate',()=>{
  const samples=fixture({duration:4200000}).filter(s=>Date.parse(s.at)!==BASE+2000000&&Date.parse(s.at)!==BASE+2010000&&Date.parse(s.at)!==BASE+2020000);
  const r=analyze(samples,hardware(samples));assert.equal(r.segments.length,2);assert.equal(r.measuredCriteriaPass,false);
  assert.ok(codes(r).includes('sample-gap-exceeds-30-seconds'));
});
for(const [name,mutate,code] of [
  ['epoch',s=>s.rooms[0].runtime.media.documentEpoch++,'document-epoch-changed'],
  ['video',s=>s.rooms[0].runtime.media.videoInstance++,'video-instance-changed'],
  ['runtime',s=>s.rooms[0].runtime.generation++,'runtime-identity-changed'],
  ['navigation',s=>s.rooms[0].runtime.documentNavigations++,'main-document-navigation-count-changed'],
  ['source',s=>s.sourceSha256='b'.repeat(64),'source-or-run-changed'],
  ['run',s=>s.runId='other-run','source-or-run-changed'],
  ['room id',s=>s.rooms[0].id='replacement','room-set-changed'],
  ['audio intent',s=>{s.rooms[0].audioAllowed=true;s.rooms[0].runtime.containerMuted=false;},'audio-intent-changed'],
  ['quality',s=>s.rooms[0].runtime.media.width=2560,'media-dimensions-changed']
])test(`${name} changes split continuity`,()=>{
  const samples=fixture();samples.filter(s=>Date.parse(s.at)>=BASE+1800000).forEach(mutate);
  const r=analyze(samples,hardware(samples));assert.equal(r.measuredCriteriaPass,false);assert.equal(r.segments.length,2);assert.ok(codes(r).includes(code));
});
test('frame, dropped and current time regression split and are reported separately',()=>{
  const samples=fixture();for(const s of samples.filter(s=>Date.parse(s.at)>=BASE+1800000)) {const m=s.rooms[0].runtime.media;m.frames-=50000;m.dropped-=500;m.currentTime-=1700;}
  const r=analyze(samples,hardware(samples));assert.equal(r.measuredCriteriaPass,false);
  assert.ok(codes(r).includes('frame-counter-regression'));assert.ok(codes(r).includes('media-time-regression'));
});
for(const [name,mutate,code] of [
  ['unfocus',s=>s.window.focused=false,'window-unfocused-occlusion-unverified'],
  ['minimized',s=>s.window.minimized=true,'window-minimized-or-unknown'],
  ['hidden',s=>s.window.visible=false,'window-not-visible'],
  ['login window',s=>s.window.ownedVisibleWindows=1,'owned-visible-window-or-unknown'],
  ['zoom',s=>s.layout.zoomed=true,'zoom-overlay-or-unknown'],
  ['native overlay',s=>s.layout.native=true,'native-overlay-or-unknown'],
  ['paused',s=>s.rooms[0].runtime.media.paused=true,'media-paused-or-unknown'],
  ['low resolution',s=>s.rooms[0].runtime.media.width=1280,'media-below-1920x1080-or-unknown'],
  ['missing media',s=>delete s.rooms[0].runtime.media,'media-unavailable'],
  ['missing frame',s=>delete s.rooms[0].runtime.media.frames,'frame-counters-unavailable-or-invalid'],
  ['same-platform',s=>s.rooms[0].platform='douyu','requires-three-rooms-per-platform'],
  ['off canvas',s=>s.rooms[0].geometry.outer.x=-20,'room-not-within-visible-canvas'],
  ['overlap',s=>s.rooms[0].geometry.outer.x=100,'room-outer-overlap'],
  ['free edit',s=>s.layout.editing='free','layout-not-eligible-auto-template'],
  ['missing memory',s=>delete s.processes[0].privateKiB,'process-memory-unavailable-or-invalid']
])test(`${name} does not count as valid visible continuous playback`,()=>{
  const samples=fixture();mutate(samples[180]);const r=analyze(samples,hardware(samples));assert.equal(r.measuredCriteriaPass,false);assert.ok(codes(r).includes(code));
});
test('fixed nine distinct IDs; duplicate ID cannot stand in for a ninth room',()=>{
  const samples=fixture();for(const s of samples)s.rooms[8].id=s.rooms[7].id;
  assert.ok(codes(analyze(samples)).includes('requires-nine-distinct-room-ids'));
});
test('unknown media identity cannot join potentially replaced players',()=>{
  const samples=fixture();for(const s of samples)delete s.rooms[0].runtime.media.documentEpoch;
  const r=analyze(samples);assert.equal(r.measuredCriteriaPass,false);assert.ok(codes(r).includes('media-identity-unavailable'));
});
test('private cap, relative growth and absolute growth are independent fixed checks',()=>{
  for(const [memory,failure] of [
    [()=>13*1024**3,'private-bytes-exceeds-12-GiB'],
    [t=>(2+(.5*t/3900000))*1024**3,'private-bytes-growth-exceeds-20-percent'],
    [t=>(8+(2.8*t/3900000))*1024**3,'private-bytes-growth-exceeds-2-GiB']
  ]) {const samples=fixture({memory}),r=analyze(samples,hardware(samples));assert.equal(r.measuredCriteriaPass,false);assert.ok(selected(r).failures.includes(failure));}
});
test('memory means are weighted by elapsed time rather than dense command samples',()=>{
  const samples=fixture({memory:t=>(4+t/3900000)*1024**3});
  for(let t=301000;t<330000;t+=1000)if(t%10000!==0) {
    const s=structuredClone(samples[30]);s.at=new Date(BASE+t).toISOString();
    s.processes[0].privateKiB=(4+t/3900000)*1024**2;
    for(const room of s.rooms) {room.runtime.media.currentTime=t/1000;room.runtime.media.frames=t/1000*30;room.runtime.media.dropped=Math.floor(t/1000*30*.01);}
    samples.push(s);
  }
  samples.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));const r=analyze(samples);
  const expected=(4+450000/3900000)*1024**3;
  assert.ok(Math.abs(selected(r).memory.firstFiveMinuteMeanPrivateBytes-expected)<1);
});
test('CPU absent or sparse stays unverified, application CPU is not system CPU',()=>{
  const samples=fixture();for(const hw of [[],[hardware(samples)[35]],hardware(samples).filter((_,i)=>i%4===0)]) {
    const r=analyze(samples,hw);assert.equal(r.measuredCriteriaPass,false);assert.equal(selected(r).systemCpu.status,'unverified');
  }
});
test('CPU must correspond to exact sample/source and stable measurement hour',()=>{
  const samples=fixture(),hw=hardware(samples);for(const x of hw)x.sourceSha256='b'.repeat(64);
  const r=analyze(samples,hw);assert.equal(selected(r).systemCpu.status,'unverified');assert.equal(selected(r).systemCpu.sampleCount,0);
});
test('system CPU P95 uses nearest-rank percentile and the 85% locked threshold',()=>{
  const samples=fixture();assert.equal(analyze(samples,hardware(samples,85)).measuredCriteriaPass,true);
  const r=analyze(samples,hardware(samples,85.01));assert.equal(r.measuredCriteriaPass,false);assert.equal(selected(r).systemCpu.status,'failed');
});
test('malformed, empty and duplicate timestamp input cannot pass or throw',()=>{
  assert.equal(analyze([]).measuredCriteriaPass,false);
  const parsed=parseRecords('{"token":"private"}\nnot-json\nnull\n');assert.equal(parsed.length,3);
  assert.equal(analyze(parsed).measuredCriteriaPass,false);
  const samples=fixture();samples.splice(180,0,structuredClone(samples[179]));assert.ok(codes(analyze(samples)).includes('timestamp-not-increasing'));
});
test('unknown fields and arbitrary input strings are never copied into summary',()=>{
  const samples=fixture({duration:10000}),secret='https://private.example/?token=do-not-output';
  for(const s of samples) {s.chatText=secret;s.rooms[0].platformRoomId=secret;s.rooms[0].id=secret;s.rooms[0].runtime.message=secret;s.runId=secret;s.processes[0].type=secret;}
  const r=JSON.stringify(analyze(samples,[{token:secret}]));assert.equal(r.includes(secret),false);assert.equal(r.includes('platformRoomId'),false);assert.equal(r.includes('chatText'),false);
});
test('invalid scene still reports per-room observations without calling their span eligible',()=>{
  const samples=fixture({duration:600000});for(const s of samples)s.window.focused=false;
  const r=analyze(samples);assert.equal(r.segments.length,0);assert.equal(r.observedRooms.length,9);
  assert.equal(r.input.observedSpanMs,600000);assert.equal(r.input.observedSpanIsContinuousEligibleCoverage,false);
  assert.equal(r.observedRooms[0].totalFrameCounter.max,18000);assert.equal(r.measuredCriteriaPass,false);
});
test('parser supports existing pretty hardware JSON, arrays and JSONL',()=>{
  const record={at:'2026-11-07T00:00:00Z',systemCpuPercent:50};
  for(const text of [JSON.stringify(record,null,2),JSON.stringify([record]),JSON.stringify(record)+'\n'+JSON.stringify(record)])
    assert.equal(parseRecords(text,{hardware:true})[0].systemCpuPercent,50);
});
test('CLI reads stdin without starting Electron; emits JSON and nonpass exit 1',()=>{
  const cli=path.resolve(__dirname,'../../../scripts/performance/analyze.cjs');
  const result=spawnSync(process.execPath,[cli,'-'],{input:fixture({duration:10000}).map(s=>JSON.stringify(s)).join('\n'),encoding:'utf8',windowsHide:true});
  assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).completePass,false);assert.equal(result.stderr,'');
  const error=spawnSync(process.execPath,[cli,'-','--unknown','sensitive-url'],{input:'',encoding:'utf8',windowsHide:true});
  assert.equal(error.status,2);assert.equal(error.stderr.includes('sensitive-url'),false);
});
