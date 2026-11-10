'use strict';

// Offline only: this module never connects to Electron, pages, profiles or the network.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const LIMITS = Object.freeze({ warmupMs:300000, stableMs:3600000, maxGapMs:30000,
  minuteMs:60000, dropWindowMs:300000, minPresentedFps:25, maxDropRatio:0.05,
  minWidth:1920, minHeight:1080, maxPrivateBytes:12*1024**3,
  maxMemoryRatio:1.2, maxMemoryGrowthBytes:2*1024**3, maxSystemCpuP95:85 });
const PLATFORMS = ['huya','douyu','bilibili'];
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = value => finite(value) && Number.isSafeInteger(value);
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : undefined;
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;
const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
const p95 = values => values.length ? [...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1] : null;
const stats = values => ({count:values.length,min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,mean:mean(values),p95:p95(values)});
function parseRecords(text, { hardware=false }={}) {
  const clean = String(text).replace(/^\uFEFF/,'').trim();
  if (!clean) return [];
  if (hardware && (clean.startsWith('[') || !clean.includes('\n'))) {
    try { const value=JSON.parse(clean); return Array.isArray(value)?value:[value]; } catch {}
  }
  // Hardware's existing writer produces a pretty-printed single JSON object.
  if (hardware) { try { const value=JSON.parse(clean); return Array.isArray(value)?value:[value]; } catch {} }
  return clean.split(/\r?\n/).filter(line=>line.trim()).map((line,index)=>{
    try { return JSON.parse(line); } catch { return { parseError:true, line:index+1 }; }
  });
}
function normalize(raw, index) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw) || raw.parseError) return {index,invalid:true};
  const rect = value => value && ['x','y','width','height'].every(k=>typeof value[k]==='number'&&Number.isFinite(value[k])) ?
    {x:value.x,y:value.y,width:value.width,height:value.height}:null;
  return { index, at:time(raw.at), run:typeof raw.runId==='string'&&raw.runId.length<=256?hash(raw.runId):null,
    source:typeof raw.sourceSha256==='string'&&/^[a-f0-9]{64}$/i.test(raw.sourceSha256)?raw.sourceSha256.toLowerCase():null,
    kind:['real-platform-development','real-platform-packaged'].includes(raw.kind)?raw.kind:'unknown',
    window:{visible:raw.window?.visible,minimized:raw.window?.minimized,focused:raw.window?.focused,owned:raw.window?.ownedVisibleWindows},
    canvas:{width:raw.canvas?.width,height:raw.canvas?.height},
    layout:{base:raw.layout?.base,editing:raw.layout?.editing,zoomed:raw.layout?.zoomed,native:raw.layout?.native},
    rooms:Array.isArray(raw.rooms)?raw.rooms.map(room=>({key:typeof room?.id==='string'&&room.id.length<=256?hash(room.id):null,
      platform:PLATFORMS.includes(room?.platform)?room.platform:null,outer:rect(room?.geometry?.outer),audio:room?.audioAllowed,
      generation:room?.runtime?.generation,webContentsId:room?.runtime?.webContentsId,navigation:room?.runtime?.navigation,
      documentNavigations:room?.runtime?.documentNavigations,muted:room?.runtime?.containerMuted,
      media:room?.runtime?.media?Object.fromEntries(['width','height','paused','currentTime','frames','dropped','documentEpoch','videoInstance'].map(k=>[k,room.runtime.media[k]])):null})):[],
    processes:Array.isArray(raw.processes)?raw.processes.map(p=>({pid:p?.pid,cpuPercent:p?.cpuPercent,privateKiB:p?.privateKiB,memoryKiB:p?.memoryKiB})):[] };
}
function analyze(rawSamples, rawHardware=[]) {
  const samples=rawSamples.map(normalize), issues=new Map(), aliases=new Map();
  function roomName(key) { if (!aliases.has(key)) aliases.set(key,`room-${String(aliases.size+1).padStart(2,'0')}`); return aliases.get(key); }
  function issue(code,sample,key) {
    const room=key?roomName(key):null, id=code+':'+room;
    const prior=issues.get(id);
    if (prior) { prior.count++; prior.lastAt=iso(sample.at); }
    else issues.set(id,{code,room,count:1,firstAt:iso(sample.at),lastAt:iso(sample.at)});
  }
  function check(s) {
    const bad=[]; const fail=(code,key)=>{bad.push(code);issue(code,s,key);};
    if(s.invalid||s.at===undefined) {fail('invalid-sample-or-timestamp');return false;}
    if(!s.run||!s.source)fail('missing-run-or-source-identity');
    if(s.kind==='unknown')fail('unknown-sample-kind');
    if(s.window.visible!==true)fail('window-not-visible');
    if(s.window.minimized!==false)fail('window-minimized-or-unknown');
    if(s.window.focused!==true)fail(s.window.focused===false?'window-unfocused-occlusion-unverified':'window-focus-unknown');
    if(s.window.owned!==0)fail('owned-visible-window-or-unknown');
    if(s.layout.zoomed!==false)fail('zoom-overlay-or-unknown');
    if(s.layout.native!==false)fail('native-overlay-or-unknown');
    if(!['equal','focus'].includes(s.layout.base)||s.layout.editing!=='auto')fail('layout-not-eligible-auto-template');
    if(!finite(s.canvas.width)||!finite(s.canvas.height)||!s.canvas.width||!s.canvas.height)fail('canvas-unavailable');
    const keys=s.rooms.map(r=>r.key);
    if(s.rooms.length!==9||keys.some(k=>!k)||new Set(keys).size!==9)fail('requires-nine-distinct-room-ids');
    for(const platform of PLATFORMS)if(s.rooms.filter(r=>r.platform===platform).length!==3)fail('requires-three-rooms-per-platform');
    for(const r of s.rooms) {
      if(!r.key)continue;roomName(r.key);
      const f=code=>fail(code,r.key),m=r.media,b=r.outer;
      if(!integer(r.generation)||!integer(r.webContentsId)||!integer(r.documentNavigations))f('runtime-identity-unavailable');
      if(r.navigation!=='ready')f('runtime-not-ready');
      if(typeof r.audio!=='boolean'||r.muted!==!r.audio)f('audio-intent-or-container-state-unverified');
      if(!b||b.width<=0||b.height<=0||b.x< -1||b.y< -1||b.x+b.width>s.canvas.width+1||b.y+b.height>s.canvas.height+1)f('room-not-within-visible-canvas');
      if(!m) {f('media-unavailable');continue;}
      if(!finite(m.width)||!finite(m.height)||m.width<LIMITS.minWidth||m.height<LIMITS.minHeight)f('media-below-1920x1080-or-unknown');
      if(m.paused!==false)f('media-paused-or-unknown');
      if(!integer(m.frames)||!integer(m.dropped)||m.dropped>m.frames)f('frame-counters-unavailable-or-invalid');
      if(!integer(m.documentEpoch)||!integer(m.videoInstance))f('media-identity-unavailable');
      if(!finite(m.currentTime))f('media-time-unavailable');
    }
    for(let a=0;a<s.rooms.length;a++)for(let b=a+1;b<s.rooms.length;b++) {
      const x=s.rooms[a].outer,y=s.rooms[b].outer;
      if(x&&y&&Math.min(x.x+x.width,y.x+y.width)-Math.max(x.x,y.x)>1&&Math.min(x.y+x.height,y.y+y.height)-Math.max(x.y,y.y)>1)fail('room-outer-overlap');
    }
    if(!s.processes.length||s.processes.some(p=>!integer(p.pid)||!finite(p.privateKiB)||!finite(p.memoryKiB))||new Set(s.processes.map(p=>p.pid)).size!==s.processes.length)fail('process-memory-unavailable-or-invalid');
    return !bad.length;
  }
  function transition(a,b) {
    const codes=[]; const f=(code,key)=>{codes.push(code);issue(code,b,key);};
    if(b.at<=a.at)f('timestamp-not-increasing');
    if(b.at-a.at>LIMITS.maxGapMs)f('sample-gap-exceeds-30-seconds');
    if(a.source!==b.source||a.run!==b.run||a.kind!==b.kind)f('source-or-run-changed');
    if(a.rooms.map(r=>r.key).sort().join()!==b.rooms.map(r=>r.key).sort().join())f('room-set-changed');
    for(const r of b.rooms) {
      const old=a.rooms.find(v=>v.key===r.key);if(!old)continue;
      if(old.platform!==r.platform)f('room-platform-changed',r.key);
      if(old.generation!==r.generation||old.webContentsId!==r.webContentsId)f('runtime-identity-changed',r.key);
      if(old.documentNavigations!==r.documentNavigations)f('main-document-navigation-count-changed',r.key);
      if(old.audio!==r.audio)f('audio-intent-changed',r.key);
      const x=old.media,y=r.media;if(!x||!y)continue;
      if(x.documentEpoch!==y.documentEpoch)f('document-epoch-changed',r.key);
      if(x.videoInstance!==y.videoInstance)f('video-instance-changed',r.key);
      if(x.width!==y.width||x.height!==y.height)f('media-dimensions-changed',r.key);
      if(y.frames<x.frames||y.dropped<x.dropped||y.frames-y.dropped<x.frames-x.dropped)f('frame-counter-regression',r.key);
      if(y.currentTime<x.currentTime)f('media-time-regression',r.key);
      if(y.dropped-x.dropped>y.frames-x.frames)f('frame-counter-delta-invalid',r.key);
    }
    return codes;
  }
  const segments=[];let current=null,previous=null,previousEligible=false;
  for(const s of samples) {
    const eligible=check(s);
    const breaks=previous&&previous.at!==undefined&&s.at!==undefined?transition(previous,s):[];
    if(eligible) {
      if(!current||!previousEligible||breaks.length) {current=[];segments.push(current);}
      current.push(s);
    } else current=null;
    previous=s;previousEligible=eligible;
  }
  const reports=segments.map((segment,index)=>analyzeSegment(segment,index,rawHardware,roomName));
  const selected=[...reports].sort((a,b)=>Number(b.measuredCriteriaPass)-Number(a.measuredCriteriaPass)||b.stableCoverageMs-a.stableCoverageMs||a.index-b.index)[0]||null;
  const eligibleMetricsPass=!!selected?.measuredCriteriaPass;
  const knownTimes=samples.map(s=>s.at).filter(Number.isFinite),observedRooms=new Map();
  for(const s of samples)for(const r of s.rooms||[])if(r.key) {
    if(!observedRooms.has(r.key))observedRooms.set(r.key,{room:roomName(r.key),idSha256:r.key,platform:r.platform,sampleCount:0,mediaSampleCount:0,pausedSampleCount:0,widths:[],heights:[],totals:[],drops:[]});
    const row=observedRooms.get(r.key);row.sampleCount++;
    if(r.media) {row.mediaSampleCount++;if(r.media.paused===true)row.pausedSampleCount++;
      for(const [field,target] of [['width','widths'],['height','heights'],['frames','totals'],['dropped','drops']])if(finite(r.media[field]))row[target].push(r.media[field]);}
  }
  return { schemaVersion:1,analysis:'offline-restricted-numeric-diagnostics',limits:LIMITS,
    definitions:{totalFps:'delta(totalVideoFrames) / elapsed seconds; includes dropped frames',
      presentedFps:'delta(totalVideoFrames - droppedVideoFrames) / elapsed seconds; counter estimate, not screen capture',
      dropRatio:'delta(droppedVideoFrames) / delta(totalVideoFrames)',
      windows:'Exact elapsed 60s/300s sliding windows at sample and boundary-aligned starts; linear interpolation between adjacent samples only, gap <=30s.',
      memory:'Time-weighted means; private bytes summed across app PIDs. Working set sum may double-count shared pages.',
      cpu:'Hardware systemCpuPercent P95, never substituted by sum of Electron process API CPU percentages.'},
    input:{sampleCount:samples.length,hardwareRecordCount:rawHardware.length,
      startAt:knownTimes.length?iso(Math.min(...knownTimes)):null,endAt:knownTimes.length?iso(Math.max(...knownTimes)):null,
      observedSpanMs:knownTimes.length?Math.max(...knownTimes)-Math.min(...knownTimes):0,
      observedSpanIsContinuousEligibleCoverage:false},
    observedRooms:[...observedRooms.values()].map(({widths,heights,totals,drops,...row})=>({...row,
      width:stats(widths),height:stats(heights),totalFrameCounter:stats(totals),droppedFrameCounter:stats(drops),
      note:'Raw counter observations only; never used to bridge ineligible or reset intervals.'})),
    issues:[...issues.values()],segments:reports,selectedSegmentIndex:selected?.index??null,
    measuredCriteriaPass:eligibleMetricsPass,completePass:false,fullAt30Pass:false,
    result:eligibleMetricsPass?'measured-numeric-criteria-pass-acceptance-unverified':'measured-numeric-criteria-not-passed',
    unverified:['Offline input provenance and real live playback cannot be authenticated.','Actual OS occlusion, source target >=30fps, selected native quality and manual environment/interference notes require separate evidence.',
      'No-crash outside sampled coverage, acoustic stability, 100 control latency operations and P07 lifecycle memory tests require separate evidence.',
      'Platform compatibility, login and chat acceptance are not established by performance counters.'] };
}

function interpolate(points,at,value) {
  if(at<points[0].at||at>points.at(-1).at)return null;
  let lo=0,hi=points.length-1;
  while(lo<hi) {const mid=Math.floor((lo+hi)/2);if(points[mid].at<at)lo=mid+1;else hi=mid;}
  if(points[lo].at===at)return value(points[lo]);
  const a=points[lo-1],b=points[lo];return value(a)+(value(b)-value(a))*(at-a.at)/(b.at-a.at);
}
function weightedMean(points,start,end,value) {
  const cuts=[start,...points.filter(p=>p.at>start&&p.at<end).map(p=>p.at),end];let area=0;
  for(let i=1;i<cuts.length;i++)area+=(interpolate(points,cuts[i-1],value)+interpolate(points,cuts[i],value))/2*(cuts[i]-cuts[i-1]);
  return area/(end-start);
}
function windowMetrics(points,start,end,size,value) {
  if(end-start<size)return [];
  const starts=[...new Set([start,end-size,...points.flatMap(p=>[p.at,p.at-size]).filter(t=>t>=start&&t+size<=end)])].sort((a,b)=>a-b);
  return starts.map(at=>({startAt:iso(at),endAt:iso(at+size),...value(at,at+size)}));
}
function analyzeSegment(points,index,rawHardware,roomName) {
  const first=points[0],last=points.at(-1),stableStart=first.at+LIMITS.warmupMs,
    stableEnd=Math.min(last.at,stableStart+LIMITS.stableMs),stableCoverageMs=Math.max(0,stableEnd-stableStart),failures=[];
  const complete=last.at-first.at>=LIMITS.warmupMs+LIMITS.stableMs;
  if(!complete)failures.push('insufficient-continuous-5-minute-warmup-plus-60-minute-stable-coverage');
  const rooms=first.rooms.map(room=>{
    const get=s=>s.rooms.find(r=>r.key===room.key).media;
    const total=at=>interpolate(points,at,s=>get(s).frames),dropped=at=>interpolate(points,at,s=>get(s).dropped);
    const minuteWindows=windowMetrics(points,stableStart,stableEnd,LIMITS.minuteMs,(a,b)=>({
      totalFps:(total(b)-total(a))/60,presentedFps:(total(b)-total(a)-dropped(b)+dropped(a))/60}));
    const dropWindows=windowMetrics(points,stableStart,stableEnd,LIMITS.dropWindowMs,(a,b)=>{
      const frames=total(b)-total(a),drops=dropped(b)-dropped(a);return {totalFrames:frames,droppedFrames:drops,dropRatio:frames>0?drops/frames:null};});
    const badMinutes=minuteWindows.filter(w=>w.presentedFps+1e-8<LIMITS.minPresentedFps),badDrops=dropWindows.filter(w=>w.dropRatio===null||w.dropRatio>LIMITS.maxDropRatio+1e-10);
    if(badMinutes.length)failures.push(`${roomName(room.key)}:presented-fps-below-25`);
    if(badDrops.length)failures.push(`${roomName(room.key)}:drop-ratio-above-5-percent-or-no-frames`);
    return {room:roomName(room.key),idSha256:room.key,platform:room.platform,
      width:room.media.width,height:room.media.height,
      minuteWindowCount:minuteWindows.length,minPresentedFps:minuteWindows.length?Math.min(...minuteWindows.map(w=>w.presentedFps)):null,
      totalFps:stats(minuteWindows.map(w=>w.totalFps)),presentedFps:stats(minuteWindows.map(w=>w.presentedFps)),
      fiveMinuteWindowCount:dropWindows.length,maxDropRatio:dropWindows.length?Math.max(...dropWindows.map(w=>w.dropRatio??Infinity)):null,
      failedMinuteWindows:badMinutes,failedFiveMinuteWindows:badDrops,
      passed:complete&&minuteWindows.length>0&&dropWindows.length>0&&!badMinutes.length&&!badDrops.length};
  });
  const privateBytes=s=>s.processes.reduce((sum,p)=>sum+p.privateKiB*1024,0),workingSet=s=>s.processes.reduce((sum,p)=>sum+p.memoryKiB*1024,0);
  const stablePoints=stableCoverageMs>0?points.filter(s=>s.at>=stableStart&&s.at<=stableEnd):[];
  const boundaryPrivate=stableCoverageMs>0?[interpolate(points,stableStart,privateBytes),interpolate(points,stableEnd,privateBytes)]:[];
  const maxPrivateBytes=stablePoints.length?Math.max(...boundaryPrivate,...stablePoints.map(privateBytes)):null;
  const firstFive=stableCoverageMs>=300000?weightedMean(points,stableStart,stableStart+300000,privateBytes):null;
  const lastFive=stableCoverageMs>=300000?weightedMean(points,stableEnd-300000,stableEnd,privateBytes):null;
  const ratio=firstFive>0?lastFive/firstFive:null,growth=firstFive!==null?lastFive-firstFive:null;
  if(maxPrivateBytes!==null&&maxPrivateBytes>LIMITS.maxPrivateBytes)failures.push('private-bytes-exceeds-12-GiB');
  if(ratio!==null&&ratio>LIMITS.maxMemoryRatio+1e-10)failures.push('private-bytes-growth-exceeds-20-percent');
  if(growth!==null&&growth>LIMITS.maxMemoryGrowthBytes)failures.push('private-bytes-growth-exceeds-2-GiB');
  if(ratio===null)failures.push('private-bytes-growth-unverified');
  const cpu=analyzeHardware(rawHardware,points,stableStart,stableEnd);
  if(cpu.status!=='passed')failures.push(cpu.status==='failed'?'system-cpu-p95-exceeds-85-percent':'system-cpu-unverified');
  const processes=new Map();for(const s of stablePoints)for(const p of s.processes)if(finite(p.cpuPercent)) {if(!processes.has(p.pid))processes.set(p.pid,[]);processes.get(p.pid).push(p.cpuPercent);}
  return {index,startAt:iso(first.at),endAt:iso(last.at),runIdSha256:first.run,sourceSha256:first.source,sampleCount:points.length,
    continuousCoverageMs:last.at-first.at,warmupCoverageMs:Math.min(LIMITS.warmupMs,last.at-first.at),stableStartAt:stableCoverageMs?iso(stableStart):null,
    stableEndAt:stableCoverageMs?iso(stableEnd):null,stableCoverageMs,completeDuration:complete,rooms,
    memory:{maxPrivateBytes,firstFiveMinuteMeanPrivateBytes:firstFive,lastFiveMinuteMeanPrivateBytes:lastFive,ratio,growthBytes:growth,
      workingSetBytes:stats(stablePoints.map(workingSet)),passed:complete&&maxPrivateBytes<=LIMITS.maxPrivateBytes&&ratio!==null&&ratio<=LIMITS.maxMemoryRatio+1e-10&&growth<=LIMITS.maxMemoryGrowthBytes},
    systemCpu:cpu,appProcessCpuApiPercent:[...processes].map(([pid,values])=>({pid,...stats(values)})),
    failures,measuredCriteriaPass:complete&&!failures.length&&rooms.every(r=>r.passed)};
}
function analyzeHardware(raw,points,start,end) {
  const matches=[];let rejected=0;
  for(const value of raw) {
    const at=time(value?.at),sourceAt=time(value?.sourceSampleAt);
    if(at===undefined||sourceAt===undefined||typeof value?.sourceSha256!=='string'||value.sourceSha256.toLowerCase()!==points[0].source||
      value.roomCount!==9||!finite(value.systemCpuPercent)||value.systemCpuPercent>100||Math.abs(at-sourceAt)>LIMITS.maxGapMs||
      !points.some(p=>p.at===sourceAt)||at<start||at>end) {rejected++;continue;}
    // Existing collector has no runId; exact sourceSampleAt membership binds it to this run.
    matches.push({at,cpu:value.systemCpuPercent});
  }
  matches.sort((a,b)=>a.at-b.at);
  const unique=matches.filter((p,i)=>i===0||p.at!==matches[i-1].at);
  const coverage=unique.length>=2&&unique[0].at-start<=LIMITS.maxGapMs&&end-unique.at(-1).at<=LIMITS.maxGapMs&&
    unique.every((p,i)=>i===0||p.at-unique[i-1].at<=LIMITS.maxGapMs)&&end-start>=LIMITS.stableMs;
  const percentile=p95(unique.map(p=>p.cpu));
  return {status:coverage?(percentile<=LIMITS.maxSystemCpuP95?'passed':'failed'):'unverified',sampleCount:unique.length,rejectedRecordCount:rejected,
    coverageMs:unique.length>=2?unique.at(-1).at-unique[0].at:0,p95Percent:percentile,
    reason:coverage?null:'requires-corresponding-system-CPU-samples-throughout-the-full-stable-hour-with-gaps-at-most-30s'};
}

function main(args) {
  if(args.includes('--help')) {process.stdout.write('Usage: node scripts/performance/analyze.cjs <samples.jsonl|-> [--hardware <JSON/JSONL file or directory>]...\nJSON summary goes to stdout. Exit 0: measured numeric criteria pass; 1: not passed/unverified; 2: invalid invocation/input. Offline analysis never establishes full AT30 acceptance.\n');return 0;}
  const [input,...rest]=args,hardwarePaths=[];
  if(!input)throw new Error('usage');
  for(let i=0;i<rest.length;i+=2) {if(rest[i]!=='--hardware'||!rest[i+1])throw new Error('usage');hardwarePaths.push(rest[i+1]);}
  const samples=parseRecords(fs.readFileSync(input==='-'?0:input,'utf8'));
  const hardware=hardwarePaths.flatMap(file=>{
    const files=fs.statSync(file).isDirectory()?fs.readdirSync(file).filter(name=>/\.jsonl?$/i.test(name)).sort().map(name=>path.join(file,name)):[file];
    return files.flatMap(item=>parseRecords(fs.readFileSync(item,'utf8'),{hardware:true}));
  });
  const result=analyze(samples,hardware);process.stdout.write(JSON.stringify(result,null,2)+'\n');return result.measuredCriteriaPass?0:1;
}
module.exports={analyze,parseRecords,LIMITS};
if(require.main===module) {try {process.exitCode=main(process.argv.slice(2));}catch {process.stderr.write('Cannot analyze input: invalid arguments, unreadable file or unsupported JSON data. No input text is echoed. Use --help.\n');process.exitCode=2;}}
