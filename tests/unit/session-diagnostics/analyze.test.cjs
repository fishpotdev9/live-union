'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {analyze,parseInput,EVENTS}=require('../../../scripts/session-diagnostics/analyze.cjs');
const BASE=Date.parse('2026-11-07T01:00:00.000Z');
function sample(seconds=0) {return {runId:'run-1',sourceSha256:'a'.repeat(64),at:new Date(BASE+seconds*1000).toISOString(),versions:{app:'0.1.0-dev.4'},
  rooms:[{id:'stable-internal-id',platform:'douyu',platformRoomId:'6770423',runtime:{generation:1,webContentsId:2,navigation:'ready',documentNavigations:1,adaptation:'ready',
    media:{width:1920,height:1080,documentEpoch:123,videoInstance:1,paused:false,readyState:4,networkState:2}}}]};}
function report(samples) {return analyze(samples.map((value,index)=>({line:index+1,value})));}
function names(r) {return r.events.map(event=>event.event);}
const runtime=s=>s.rooms[0].runtime;
test('no change never means diagnosis complete or login/server cause known',()=>{
  const r=report([sample(),sample(10)]);assert.deepEqual(r.events,[]);assert.equal(r.completeDiagnosis,false);
  assert.equal(r.observationsAvailable,false);assert.equal(r.loginLossCauseConfirmed,false);assert.equal(r.serverCauseVerified,false);
  assert.equal(r.counts.comparedRoomPairs,1);assert.equal(r.counts.uncertainRoomPairs,0);
});
test('generation and WebContents identity changes each establish only runtime recreation',()=>{
  for(const field of ['generation','webContentsId']) {const a=sample(),b=sample(10);runtime(b)[field]++;
    const r=report([a,b]);assert.deepEqual(names(r),['app-room-runtime-recreated']);
    assert.equal(r.events[0].beforeAt,a.at);assert.equal(r.events[0].afterAt,b.at);assert.equal(r.events[0].publicRoomId,6770423);
  }
});
test('zero generation or WebContents placeholder recovery cannot establish runtime recreation',()=>{
  for(const field of ['generation','webContentsId']) {
    const a=sample(),b=sample(10);runtime(a)[field]=0;
    // Even a change in the other valid component cannot establish the full prior identity.
    runtime(b)[field==='generation'?'webContentsId':'generation']++;
    const r=report([a,b]);assert.equal(r.events.length,0);assert.equal(r.counts.uncertainRoomPairs,1);
    assert.ok(r.uncertainComparisons[0].uncertaintyReasons.includes('diagnostic-fields-missing-or-invalid'));
    assert.equal(r.loginLossCauseConfirmed,false);
  }
  const a=sample(),b=sample(10);runtime(a).generation=0;runtime(a).webContentsId=0;
  assert.equal(report([a,b]).events.length,0);
});
test('navigation count increase in the same runtime is observed without inferring trigger',()=>{
  const b=sample(10);runtime(b).documentNavigations=3;
  const r=report([sample(),b]);assert.deepEqual(names(r),['document-navigation-observed']);
  assert.equal(r.events[0].after.documentNavigations-r.events[0].before.documentNavigations,2);
  assert.equal(r.loginLossCauseConfirmed,false);
});
test('navigation counts are not compared across recreated runtimes',()=>{
  const b=sample(10);runtime(b).generation++;runtime(b).webContentsId++;runtime(b).documentNavigations++;
  assert.deepEqual(names(report([sample(),b])),['app-room-runtime-recreated']);
});
test('media epoch change is not mislabeled as reload or video recreation',()=>{
  const b=sample(10);runtime(b).media.documentEpoch++;runtime(b).media.videoInstance++;
  const r=report([sample(),b]);assert.deepEqual(names(r),['media-observation-epoch-changed']);
  assert.equal(r.events[0].uncertain,false);assert.equal(r.completeDiagnosis,false);
  runtime(b).documentNavigations++;
  const nav=report([sample(),b]);assert.deepEqual(names(nav),['document-navigation-observed','media-observation-epoch-changed']);
  assert.equal(nav.events[1].uncertain,true);
  assert.ok(nav.events[1].uncertaintyReasons.includes('document-navigation-context-not-stable'));
});
test('same epoch/runtime/navigation with changed video id observes candidate change',()=>{
  const b=sample(10);runtime(b).media.videoInstance++;
  assert.deepEqual(names(report([sample(),b])),['media-candidate-instance-changed']);
  runtime(b).webContentsId++;
  assert.equal(names(report([sample(),b])).includes('media-candidate-instance-changed'),false);
});
test('switching between two existing video candidates and back only observes candidate changes',()=>{
  const a=sample(),b=sample(10),c=sample(20);runtime(b).media.videoInstance=2;
  const r=report([a,b,c]);
  assert.deepEqual(names(r),['media-candidate-instance-changed','media-candidate-instance-changed']);
  assert.deepEqual(r.events.map(e=>[e.before.videoInstance,e.after.videoInstance]),[[1,2],[2,1]]);
  assert.equal(r.completeDiagnosis,false);assert.equal(r.loginLossCauseConfirmed,false);
  assert.ok(r.limitations.includes('media-candidate-selection-can-change-without-main-document-navigation'));
});
test('width or height decrease is observation, never proof of quality selection or login loss',()=>{
  for(const dimension of ['width','height']) {const b=sample(10);runtime(b).media[dimension]/=2;
    const r=report([sample(),b]);assert.deepEqual(names(r),['media-dimensions-decreased']);
    assert.equal(r.loginLossCauseConfirmed,false);assert.equal(r.serverCauseVerified,false);
    assert.ok(r.limitations.includes('observed-dimensions-do-not-confirm-native-quality-selection-or-login-loss'));
  }
});
test('zero dimensions are unavailable media, not observed quality decrease',()=>{
  const b=sample(10);runtime(b).media.width=0;
  const r=report([sample(),b]);assert.equal(r.events.length,0);assert.equal(r.counts.uncertainRoomPairs,1);
});
test('entry into runtime navigation error is event; persistent error is not repeated',()=>{
  const a=sample(),b=sample(10),c=sample(20);runtime(b).navigation='error';runtime(c).navigation='error';
  const r=report([a,b,c]);assert.deepEqual(names(r),['runtime-error']);assert.equal(r.events[0].after.navigation,'error');
  assert.equal(report([b]).observationsAvailable,false);
});
test('source SHA changes reset baseline instead of comparing different builds',()=>{
  const a=sample(),b=sample(10),c=sample(20);b.sourceSha256='b'.repeat(64);c.sourceSha256=b.sourceSha256;
  runtime(b).generation=99;runtime(c).generation=100;
  const r=report([a,b,c]);assert.equal(r.runs[0].segments.length,2);assert.equal(r.events.length,1);
  assert.equal(r.events[0].before.generation,99);assert.equal(r.events[0].sourceSegmentIndex,2);
});
test('interleaved runs remain independent, with room order fixed by first occurrence',()=>{
  const a=sample(),b=sample(5),c=sample(10),d=sample(15);b.runId='run-2';d.runId='run-2';runtime(b).generation=90;runtime(d).generation=90;
  runtime(c).media.videoInstance++;
  const r=report([a,b,c,d]);assert.equal(r.runs.length,2);assert.deepEqual(names(r),['media-candidate-instance-changed']);assert.equal(r.events[0].runIndex,1);
  const x=sample(20);x.rooms.push({...structuredClone(x.rooms[0]),id:'other-id',platformRoomId:'88660'});
  const y=structuredClone(x);y.at=sample(30).at;y.rooms.reverse();y.rooms[0].runtime.generation++;
  const ordered=report([x,y]);assert.equal(ordered.events[0].roomIndex,2);
});
test('out-of-order and repeated timestamps are explicitly counted and skipped',()=>{
  const a=sample(),b=sample(20),c=sample(10),d=sample(30);runtime(c).generation=99;runtime(d).media.videoInstance++;
  const r=report([a,b,c,a,d]);assert.equal(r.counts.outOfOrderRecords,1);assert.equal(r.counts.duplicateTimestamps,1);
  assert.deepEqual(names(r),['media-candidate-instance-changed']);assert.equal(r.events[0].uncertain,true);
  assert.ok(r.events[0].uncertaintyReasons.includes('bad-or-unordered-records-between-samples'));
});
test('partial malformed JSON and invalid schema records remain visible in strict counts',()=>{
  const b=sample(10);runtime(b).media.videoInstance++;
  const text=JSON.stringify(sample())+'\nnot-json\nnull\n'+JSON.stringify(b);
  const r=analyze(parseInput(text));assert.equal(r.counts.malformedLines,1);assert.equal(r.counts.invalidRecords,1);
  assert.equal(r.counts.acceptedRecords,2);assert.equal(r.events[0].uncertain,true);
  assert.deepEqual(r.notices.filter(n=>n.code==='malformed-json-line').map(n=>n.line),[2]);
});
test('gap over 30 seconds is uncertain even if no changes are observed',()=>{
  const r=report([sample(),sample(30.001)]);assert.equal(r.events.length,0);assert.equal(r.counts.uncertainRoomPairs,1);
  assert.ok(r.uncertainComparisons[0].uncertaintyReasons.includes('sample-gap-over-30s'));
  assert.equal(report([sample(),sample(30)]).counts.uncertainRoomPairs,0);
});
test('missing observation fields never fabricate changes and stay marked uncertain',()=>{
  const b=sample(10);delete runtime(b).media;
  const r=report([sample(),b]);assert.equal(r.events.length,0);assert.equal(r.counts.uncertainRoomPairs,1);
  assert.ok(r.uncertainComparisons[0].uncertaintyReasons.includes('diagnostic-fields-missing-or-invalid'));
});
test('room absence and reappearance does not masquerade as continuous comparison',()=>{
  const b=sample(10);b.rooms=[];const c=sample(20);runtime(c).media.videoInstance++;
  const r=report([sample(),b,c]);assert.equal(r.events[0].uncertain,true);
  assert.ok(r.events[0].uncertaintyReasons.includes('room-absent-between-samples'));
});
test('room/platform number context change resets reused internal key',()=>{
  const b=sample(10);b.rooms[0].platformRoomId='88660';runtime(b).generation++;
  const r=report([sample(),b]);assert.equal(r.events.length,0);assert.ok(r.notices.some(n=>n.code==='room-identity-context-changed-baseline-reset'));
});
test('bad numeric bounds and unknown enums are stripped, never coerced into valid state',()=>{
  const b=sample(10);Object.assign(runtime(b),{generation:'2',webContentsId:Infinity,documentNavigations:-1,navigation:'private-error',adaptation:'private-url'});
  Object.assign(runtime(b).media,{width:32769,height:NaN,documentEpoch:MAX_SAFE(),videoInstance:1e12+1,readyState:5,networkState:4,paused:'false'});
  const r=report([sample(),b]);assert.equal(r.events.length,0);assert.equal(r.counts.uncertainRoomPairs,1);
  assert.equal(JSON.stringify(r).includes('private-error'),false);
});
function MAX_SAFE(){return Number.MAX_SAFE_INTEGER+1;}
test('navigation counter decrease is uncertainty, not navigation or reload',()=>{
  const b=sample(10);runtime(b).documentNavigations=0;
  const r=report([sample(),b]);assert.equal(r.events.length,0);assert.ok(r.uncertainComparisons[0].uncertaintyReasons.includes('navigation-counter-regressed'));
});
test('invalid rooms, duplicate IDs and invalid dates explicitly report bad data',()=>{
  const a=sample(),b=sample(10);a.rooms.push(structuredClone(a.rooms[0]),{id:'x',platform:'private'});
  b.at='2026-02-30T01:00:00Z';const r=report([a,b]);assert.equal(r.counts.invalidRooms,3);assert.equal(r.counts.invalidRecords,1);
});
test('ambiguous duplicate room samples are excluded rather than selecting one identity arbitrarily',()=>{
  const a=sample(),b=sample(10),c=sample(20);b.rooms.push(structuredClone(b.rooms[0]));runtime(b).generation=99;
  const r=report([a,b,c]);assert.equal(r.events.length,0);assert.equal(r.counts.invalidRooms,2);
  assert.ok(r.uncertainComparisons[0].uncertaintyReasons.includes('room-absent-between-samples'));
});
test('public room IDs must be positive safe numeric identifiers; missing runtime identity cannot prove recreation',()=>{
  for(const invalid of ['9007199254740992','0','6770423?token=private',-1,{},1.5]) {
    const a=sample(),b=sample(10);a.rooms[0].platformRoomId=invalid;b.rooms[0].platformRoomId=invalid;
    delete runtime(a).generation;delete runtime(b).generation;runtime(b).media.documentEpoch++;
    const r=report([a,b]);assert.equal(r.events[0].publicRoomId,null);assert.equal(names(r).includes('app-room-runtime-recreated'),false);
    assert.equal(r.events[0].uncertain,true);
  }
});
test('unknown URLs, messages, cookie and identity/version strings cannot leak through output',()=>{
  const secret='https://private.invalid/?token=never-output',a=sample(),b=sample(10);
  for(const s of [a,b]) {s.runId=secret;s.versions={app:secret};s.rooms[0].id=secret;s.url=secret;s.cookies=secret;runtime(s).message=secret;s.rooms[0].platformRoomId=secret;}
  runtime(b).generation++;
  const r=report([a,b]),json=JSON.stringify(r);assert.equal(json.includes(secret),false);assert.equal(json.includes('cookies'),false);
  assert.equal(r.events[0].publicRoomId,null);assert.ok(EVENTS.includes(r.events[0].event));
});
test('parser accepts pretty single JSON and BOM JSONL, rejects arrays as sample schema',()=>{
  assert.equal(analyze(parseInput(JSON.stringify(sample(),null,2))).counts.acceptedRecords,1);
  assert.equal(analyze(parseInput('\uFEFF'+JSON.stringify(sample())+'\n')).counts.acceptedRecords,1);
  assert.equal(analyze(parseInput(JSON.stringify([sample()]))).counts.invalidRecords,1);
});
test('CLI exits 0 for observations, 1 for incomplete no-change diagnosis, 2 for bad input',()=>{
  const cli=path.resolve(__dirname,'../../../scripts/session-diagnostics/analyze.cjs'),b=sample(10);runtime(b).generation++;
  for(const [input,status] of [[JSON.stringify(sample()),1],[JSON.stringify(sample())+'\n'+JSON.stringify(b),0],['bad-json',2],['',2]]) {
    const result=spawnSync(process.execPath,[cli,'-'],{input,encoding:'utf8',windowsHide:true});
    assert.equal(result.status,status);assert.equal(JSON.parse(result.stdout).completeDiagnosis,false);assert.equal(result.stderr,'');
  }
  const invalid=spawnSync(process.execPath,[cli,'sensitive-path','extra'],{encoding:'utf8',windowsHide:true});
  assert.equal(invalid.status,2);assert.equal(invalid.stderr.includes('sensitive-path'),false);
});
