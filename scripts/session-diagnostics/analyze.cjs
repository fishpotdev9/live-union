'use strict';

// Restricted, offline comparisons. No Electron, browser, account, network or profile access.
const fs=require('node:fs');
const MAX=Number.MAX_SAFE_INTEGER;
const EVENTS=Object.freeze(['app-room-runtime-recreated','document-navigation-observed','media-observation-epoch-changed',
  'media-candidate-instance-changed','media-dimensions-decreased','runtime-error']);
const enums={platform:['huya','douyu','bilibili'],navigation:['idle','loading','ready','error','closed'],adaptation:['detecting','ready','degraded','unsupported']};
const num=(value,max=MAX)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
const positiveIdentity=value=>num(value)>0?num(value):null;
const choice=(value,values)=>values.includes(value)?value:null;
const opaque=value=>typeof value==='string'&&value.length>0&&value.length<=128?value:null;
function timestamp(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value))return null;
  const at=Date.parse(value);return Number.isFinite(at)&&new Date(at).toISOString().slice(0,19)===value.slice(0,19)?at:null;
}
const utc=at=>new Date(at).toISOString();
function publicRoomNumber(value) {
  const parsed=typeof value==='string'&&/^[0-9]{1,16}$/.test(value)?num(Number(value)):num(value);
  return parsed>0?parsed:null;
}
function parseInput(text) {
  const clean=String(text).replace(/^\uFEFF/,'').trim();if(!clean)return [];
  try {const value=JSON.parse(clean);return [{line:1,value}];} catch {}
  return clean.split(/\r?\n/).flatMap((line,index)=>{
    if(!line.trim())return [];
    try{return [{line:index+1,value:JSON.parse(line)}];}catch{return [{line:index+1,malformed:true}];}
  });
}
function normalize(raw) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const run=opaque(raw.runId),at=timestamp(raw.at),source=typeof raw.sourceSha256==='string'&&/^[a-fA-F0-9]{64}$/.test(raw.sourceSha256)?raw.sourceSha256.toLowerCase():null;
  if(!run||at===null||!source||!Array.isArray(raw.rooms)||raw.rooms.length>128)return null;
  const rooms=[],seen=new Set();let invalidRooms=0;
  for(const value of raw.rooms) {
    const key=opaque(value?.id),platform=choice(value?.platform,enums.platform);
    if(!key||!platform) {invalidRooms++;continue;}
    if(seen.has(key)) {
      invalidRooms++;
      const old=rooms.findIndex(room=>room.key===key);
      if(old!==-1) {rooms.splice(old,1);invalidRooms++;}
      continue;
    }
    seen.add(key);
    const r=value?.runtime,m=r?.media;
    rooms.push({key,platform,publicRoomId:publicRoomNumber(value?.platformRoomId),
      values:{generation:positiveIdentity(r?.generation),webContentsId:positiveIdentity(r?.webContentsId),documentNavigations:num(r?.documentNavigations),
        navigation:choice(r?.navigation,enums.navigation),adaptation:choice(r?.adaptation,enums.adaptation),
        width:num(m?.width,32768)>0?num(m.width,32768):null,height:num(m?.height,32768)>0?num(m.height,32768):null,documentEpoch:num(m?.documentEpoch),videoInstance:num(m?.videoInstance,1e12),
        paused:typeof m?.paused==='boolean'?m.paused:null,readyState:num(m?.readyState,4),networkState:num(m?.networkState,3)}});
  }
  return {run,at,source,rooms,invalidRooms};
}
function analyze(records) {
  const counts={inputRecords:records.length,malformedLines:0,invalidRecords:0,invalidRooms:0,acceptedRecords:0,
    duplicateTimestamps:0,outOfOrderRecords:0,comparedRoomPairs:0,uncertainRoomPairs:0};
  const runs=new Map(),events=[],notices=[],uncertainComparisons=[];let barrier=0;
  function notice(code,line,runIndex=null,roomIndex=null) {notices.push({code,line,runIndex,roomIndex});}
  for(const record of records) {
    const line=num(record?.line)??null;
    if(record?.malformed) {counts.malformedLines++;barrier++;notice('malformed-json-line',line);continue;}
    const sample=normalize(record?.value);
    if(!sample) {counts.invalidRecords++;barrier++;notice('invalid-sample-record',line);continue;}
    let run=runs.get(sample.run);
    if(!run) {run={index:runs.size+1,lastAt:null,seenTimes:new Set(),source:null,segment:0,segments:[],rooms:new Map(),previous:new Map(),sequence:0};runs.set(sample.run,run);}
    if(run.seenTimes.has(sample.at)||(run.lastAt!==null&&sample.at<run.lastAt)) {
      if(run.seenTimes.has(sample.at)) {counts.duplicateTimestamps++;notice('duplicate-run-timestamp-skipped',line,run.index);}
      else {counts.outOfOrderRecords++;notice('out-of-order-run-timestamp-skipped',line,run.index);}
      run.seenTimes.add(sample.at);barrier++;continue;
    }
    run.seenTimes.add(sample.at);
    if(run.source!==sample.source) {
      if(run.source!==null)notice('source-changed-new-segment',line,run.index);
      run.source=sample.source;run.segment++;run.previous.clear();
      run.segments.push({sourceSegmentIndex:run.segment,startAt:utc(sample.at),endAt:utc(sample.at),acceptedRecords:0});
    }
    run.sequence++;run.lastAt=sample.at;counts.acceptedRecords++;
    const segment=run.segments.at(-1);segment.endAt=utc(sample.at);segment.acceptedRecords++;
    counts.invalidRooms+=sample.invalidRooms;
    if(sample.invalidRooms) {notice('invalid-or-duplicate-room-records',line,run.index);barrier++;}
    for(const room of sample.rooms) {
      if(!run.rooms.has(room.key))run.rooms.set(room.key,run.rooms.size+1);
      const roomIndex=run.rooms.get(room.key),previous=run.previous.get(room.key);
      if(previous) {
        // A platform/public-room change changes the identity context despite a reused internal key.
        if(previous.room.platform!==room.platform||previous.room.publicRoomId!==room.publicRoomId) {
          notice('room-identity-context-changed-baseline-reset',line,run.index,roomIndex);
        } else {
          counts.comparedRoomPairs++;
          const a=previous.room.values,b=room.values,reasons=[];
          if(sample.at-previous.at>30000)reasons.push('sample-gap-over-30s');
          if(previous.sequence!==run.sequence-1)reasons.push('room-absent-between-samples');
          if(previous.barrier!==barrier)reasons.push('bad-or-unordered-records-between-samples');
          if(Object.values(a).includes(null)||Object.values(b).includes(null))reasons.push('diagnostic-fields-missing-or-invalid');
          if(room.publicRoomId===null)reasons.push('public-room-number-unavailable');
          const known=key=>a[key]!==null&&b[key]!==null;
          const identityKnown=known('generation')&&known('webContentsId');
          const sameRuntime=identityKnown&&a.generation===b.generation&&a.webContentsId===b.webContentsId;
          const runtimeChanged=identityKnown&&['generation','webContentsId'].some(key=>a[key]!==b[key]);
          const sameNav=known('documentNavigations')&&a.documentNavigations===b.documentNavigations;
          if(known('documentNavigations')&&b.documentNavigations<a.documentNavigations)reasons.push('navigation-counter-regressed');
          const observed=[];
          if(runtimeChanged)observed.push(['app-room-runtime-recreated',[]]);
          if(sameRuntime&&known('documentNavigations')&&b.documentNavigations>a.documentNavigations)observed.push(['document-navigation-observed',[]]);
          if(known('documentEpoch')&&a.documentEpoch!==b.documentEpoch)observed.push(['media-observation-epoch-changed',
            [...(!sameRuntime?['runtime-context-not-stable']:[]),...(!sameNav?['document-navigation-context-not-stable']:[])]]);
          if(sameRuntime&&sameNav&&known('documentEpoch')&&a.documentEpoch===b.documentEpoch&&known('videoInstance')&&a.videoInstance!==b.videoInstance)
            observed.push(['media-candidate-instance-changed',[]]);
          if(a.width>0&&a.height>0&&b.width>0&&b.height>0&&(b.width<a.width||b.height<a.height))observed.push(['media-dimensions-decreased',
            [...(!sameRuntime?['runtime-context-not-stable']:[]),...(!sameNav?['document-navigation-context-not-stable']:[]),
              ...(!known('documentEpoch')||a.documentEpoch!==b.documentEpoch?['media-observation-context-not-stable']:[])]]);
          if(b.navigation==='error'&&a.navigation!=='error')observed.push(['runtime-error',[]]);
          const pairReasons=[...new Set([...reasons,...observed.flatMap(([,extra])=>extra)])];
          if(pairReasons.length) {
            counts.uncertainRoomPairs++;
            uncertainComparisons.push({runIndex:run.index,sourceSegmentIndex:run.segment,roomIndex,beforeAt:utc(previous.at),afterAt:utc(sample.at),
              uncertain:true,uncertaintyReasons:pairReasons});
          }
          for(const [event,extra] of observed) {
            const uncertaintyReasons=[...new Set([...reasons,...extra])];
            events.push({event,runIndex:run.index,sourceSegmentIndex:run.segment,roomIndex,platform:room.platform,publicRoomId:room.publicRoomId,
              beforeAt:utc(previous.at),afterAt:utc(sample.at),intervalMs:sample.at-previous.at,
              uncertain:uncertaintyReasons.length>0,uncertaintyReasons,before:a,after:b});
          }
        }
      } else notice('initial-room-baseline-no-prior-sample',line,run.index,roomIndex);
      run.previous.set(room.key,{room,at:sample.at,barrier,sequence:run.sequence});
    }
  }
  return {schemaVersion:1,analysis:'offline-session-numeric-observations',loginLossCauseConfirmed:false,serverCauseVerified:false,
    completeDiagnosis:false,observationsAvailable:events.length>0,counts,
    runs:[...runs.values()].map(run=>({runIndex:run.index,roomCount:run.rooms.size,segments:run.segments})),
    events,notices,uncertainComparisons,limitations:['no-login-state-or-server-evidence','no-historical-replay-without-recorded-samples',
      'sampling-cannot-identify-every-intervening-event','media-candidate-selection-can-change-without-main-document-navigation',
      'observed-dimensions-do-not-confirm-native-quality-selection-or-login-loss','input-provenance-not-authenticated']};
}
function main(args) {
  if(args.length===1&&args[0]==='--help') {process.stdout.write('Usage: node scripts/session-diagnostics/analyze.cjs <sample.jsonl|sample.json|->\nRestricted offline observations only. Exit 0: events available; 1: no events, diagnosis incomplete; 2: invalid invocation/unreadable input/no valid samples.\n');return 0;}
  if(args.length!==1)throw new Error('arguments');
  const records=parseInput(fs.readFileSync(args[0]==='-'?0:args[0],'utf8')),report=analyze(records);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  return report.counts.acceptedRecords===0?2:report.observationsAvailable?0:1;
}
module.exports={analyze,parseInput,EVENTS};
if(require.main===module)try{process.exitCode=main(process.argv.slice(2));}catch{process.stderr.write('Cannot analyze input. Check arguments and readable diagnostic JSON/JSONL. Input text and paths are not echoed.\n');process.exitCode=2;}
