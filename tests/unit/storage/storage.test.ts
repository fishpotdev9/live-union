import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceRepository, validateWorkspace } from '../../../src/main/storage/index.ts';
import type { WorkspaceSnapshot } from '../../../src/shared/contracts.ts';

function sample(): WorkspaceSnapshot {
  const rooms = (['huya','douyu','bilibili'] as const).map((platform,index) => ({
    id:randomUUID(),platform,platformRoomId:String(index+123),
    canonicalUrl:`https://${{huya:'www.huya.com',douyu:'www.douyu.com',bilibili:'live.bilibili.com'}[platform]}/${index+123}`,
    chat:{visible:index !== 1,preferredWidthDip:280+index},audio:{allowed:index === 0,preferredVolume:0.5},preferredQuality:'original',
  }));
  const order = rooms.map(r => r.id);
  return {schemaVersion:1,id:randomUUID(),name:'三平台组合',rooms,stableOrder:order,
    layout:{base:'focus',editing:'free',primaryRoomId:order[1],
      equal:{variant:'balanced',order:[...order]},focus:{variant:'right',order:[...order].reverse(),primaryShare:0.7},
      free:{from:'equal',rects:Object.fromEntries(order.map((id,i)=>[id,{x:i/3,y:0.2,width:0.5,height:0.6,z:i}]))}}};
}
async function isolated(t: import('node:test').TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(),'live-union-storage-'));
  t.after(async () => { await rm(directory,{recursive:true,force:true}); });
  return directory;
}

test('empty directory returns empty without invented rooms or creating files',async t => {
  const directory = await isolated(t);
  assert.deepEqual(await new WorkspaceRepository(join(directory,'not-created')).load(),{source:'empty',warnings:[]});
  assert.deepEqual(await readdir(directory),[]);
});
test('full preferences survive reopening; stable IDs and independent layout orders survive',async t => {
  const directory = await isolated(t), snapshot = sample();
  await new WorkspaceRepository(directory).save(snapshot);
  assert.deepEqual(await new WorkspaceRepository(directory).load(),{snapshot,source:'primary',warnings:[]});
});
test('zero through nine rooms are ordinary snapshot data without special count modes',async t => {
  const directory = await isolated(t), repo = new WorkspaceRepository(directory);
  for (let count=0;count<=9;count++) {
    const snapshot=sample();
    snapshot.rooms=Array.from({length:count},(_,i)=>({...snapshot.rooms[0],id:randomUUID(),platformRoomId:String(i+100),canonicalUrl:`https://www.huya.com/${i+100}`}));
    const ids=snapshot.rooms.map(r=>r.id);
    snapshot.stableOrder=[...ids]; snapshot.layout.equal.order=[...ids]; snapshot.layout.focus.order=[...ids];
    snapshot.layout.free.rects=Object.fromEntries(ids.map((id,i)=>[id,{x:0,y:0,width:1,height:1,z:i}]));
    delete snapshot.layout.primaryRoomId;
    await repo.save(snapshot);
    assert.deepEqual((await repo.load()).snapshot,snapshot);
  }
});
test('invalid saves do not change disk state or prevent later valid saves',async t => {
  const directory = await isolated(t), repo = new WorkspaceRepository(directory), first=sample();
  await repo.save(first);
  await assert.rejects(repo.save({...first,stableOrder:[]}));
  assert.deepEqual((await repo.load()).snapshot,first);
  assert.deepEqual(await readdir(directory),['workspace.json']);
  await repo.save({...first,name:'next valid'});
  assert.equal((await repo.load()).snapshot?.name,'next valid');
});
test('second save keeps the previous valid state; removed room stays absent on normal restart',async t => {
  const directory = await isolated(t), repo = new WorkspaceRepository(directory), first = sample();
  await repo.save(first);
  const next = structuredClone(first), removed = next.rooms.pop()!.id;
  next.stableOrder = next.stableOrder.filter(id => id !== removed);
  next.layout.equal.order = next.layout.equal.order.filter(id => id !== removed);
  next.layout.focus.order = next.layout.focus.order.filter(id => id !== removed);
  delete next.layout.free.rects[removed];
  await repo.save(next);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'workspace.backup.json'),'utf8')),first);
  assert.deepEqual((await new WorkspaceRepository(directory).load()).snapshot,next);
});
for (const primaryState of ['corrupt','missing'] as const) test(`AT18/AT22: ${primaryState} primary recovery stays muted after restart without a save`,async t => {
  const directory = await isolated(t), repo = new WorkspaceRepository(directory), first = sample();
  for (const room of first.rooms) room.audio.allowed = true;
  await repo.save(first); await repo.save({...first,name:'newer'});
  const damaged = '{broken json';
  const backupBefore = await readFile(join(directory,'workspace.backup.json'),'utf8');
  if (primaryState === 'corrupt') await writeFile(join(directory,'workspace.json'),damaged);
  else await rm(join(directory,'workspace.json'));
  const expected = structuredClone(first);
  for (const room of expected.rooms) room.audio.allowed = false;
  const result = await repo.load();
  assert.equal(result.source,'backup'); assert.deepEqual(result.snapshot,expected);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'workspace.json'),'utf8')),expected);
  const preserved = (await readdir(directory)).filter(name=>name.startsWith('workspace.corrupt-'));
  assert.equal(preserved.length,primaryState === 'corrupt' ? 1 : 0);
  if (primaryState === 'corrupt') assert.equal(await readFile(join(directory,preserved[0]),'utf8'),damaged);
  // Simulate exit immediately after recovery: no save or controller cleanup.
  assert.deepEqual(await new WorkspaceRepository(directory).load(),{snapshot:expected,source:'primary',warnings:[]});
  assert.equal(await readFile(join(directory,'workspace.backup.json'),'utf8'),backupBefore);
  if (primaryState === 'corrupt') assert.equal(await readFile(join(directory,preserved[0]),'utf8'),damaged);
});
test('both invalid states return empty with warnings and preserve main; missing primary can recover backup',async t => {
  const directory = await isolated(t), repo = new WorkspaceRepository(directory);
  await writeFile(join(directory,'workspace.json'),'[]');
  await writeFile(join(directory,'workspace.backup.json'),'null');
  const result = await repo.load();
  assert.equal(result.source,'empty'); assert.equal(result.snapshot,undefined); assert.equal(result.warnings.length,2);
  const backup = sample();
  await rm(join(directory,'workspace.json'));
  await writeFile(join(directory,'workspace.backup.json'),JSON.stringify(backup));
  const expected = structuredClone(backup);
  for (const room of expected.rooms) room.audio.allowed = false;
  assert.deepEqual((await repo.load()).snapshot,expected);
});
test('unknown old and future schemas reject without inventing a migration or downgrading main',async t => {
  const directory = await isolated(t), repo = new WorkspaceRepository(directory), first=sample();
  for (const version of [0,2,'1',undefined]) {
    assert.throws(()=>validateWorkspace({...first,schemaVersion:version}),/Unsupported workspace schema/);
  }
  await repo.save(first); await repo.save(first);
  const future = JSON.stringify({...first,schemaVersion:2});
  await writeFile(join(directory,'workspace.json'),future);
  await assert.rejects(repo.load(),/Unsupported workspace schema/);
  await assert.rejects(repo.save(first),/Unsupported workspace schema/);
  assert.equal(await readFile(join(directory,'workspace.json'),'utf8'),future);
});
test('a newer backup survives an older valid primary and a refused save',async t => {
  const directory=await isolated(t),repo=new WorkspaceRepository(directory),first=sample();
  await repo.save(first);
  const newer=JSON.stringify({...first,schemaVersion:2});
  await writeFile(join(directory,'workspace.backup.json'),newer);
  await assert.rejects(repo.save({...first,name:'must not overwrite newer backup'}),/Unsupported workspace schema/);
  assert.equal(await readFile(join(directory,'workspace.backup.json'),'utf8'),newer);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'workspace.json'),'utf8')),first);
});
test('whitelist strips authentication, page content, paths and nested extras from both disk snapshots',async t => {
  const directory = await isolated(t), repo = new WorkspaceRepository(directory), first=sample();
  const dirty = structuredClone(first) as any;
  dirty.cookie='SECRET_COOKIE'; dirty.token='SECRET_TOKEN'; dirty.localPath='SECRET_PATH'; dirty.chatDraft='SECRET_CHAT';
  dirty.rooms[0].authentication={password:'SECRET_PASSWORD'};
  dirty.rooms[0].audio.authorization='SECRET_AUTH';
  dirty.layout.free.rects[first.rooms[0].id].session='SECRET_SESSION';
  assert.deepEqual(validateWorkspace(dirty),first);
  await repo.save(dirty); await repo.save(dirty);
  for (const filename of ['workspace.json','workspace.backup.json']) {
    const content = await readFile(join(directory,filename),'utf8');
    assert.ok(!content.includes('SECRET_')); assert.deepEqual(JSON.parse(content),first);
  }
});
test('room identity, URL authority and canonical live paths are validated without echoing input',() => {
  const first = sample();
  for (const url of ['http://www.huya.com/123','https://www.huya.com:443/123','https://user:SECRET@www.huya.com/123',
    'https://www.huya.com/123?token=SECRET','https://www.huya.com/123#SECRET','https://evil.test/123',
    'https://www.huya.com/123/','https://www.huya.com/abc/../123','https://www.huya.com/%31%32%33']) {
    const dirty=structuredClone(first); dirty.rooms[0].canonicalUrl=url;
    assert.throws(()=>validateWorkspace(dirty),error => error instanceof Error && error.message === 'Invalid workspace configuration.');
  }
  const dirty=structuredClone(first); dirty.rooms[0].platformRoomId='456';
  assert.throws(()=>validateWorkspace(dirty));
});
test('invalid orders, deleted references, duplicate rooms, runtime IDs and invalid geometry reject',() => {
  const mutations:((s:WorkspaceSnapshot)=>void)[] = [
    s=>{s.rooms[0].id='0';},s=>{s.stableOrder.reverse();s.stableOrder[0]=s.stableOrder[1];},
    s=>{s.layout.equal.order.pop();},s=>{s.layout.primaryRoomId=randomUUID();},
    s=>{s.layout.free.rects[randomUUID()]={x:0,y:0,width:1,height:1,z:0};},
    s=>{delete s.layout.free.rects[s.rooms[0].id];},
    s=>{s.rooms[1]={...s.rooms[0],id:s.rooms[1].id};},
    ...[-1,NaN,Infinity,1.01].map(value=>(s:WorkspaceSnapshot)=>{s.layout.free.rects[s.rooms[0].id].x=value;}),
    ...[0,-1,NaN,Infinity,1.01].map(value=>(s:WorkspaceSnapshot)=>{s.layout.free.rects[s.rooms[0].id].width=value;}),
    ...[-1,1.5,Number.MAX_SAFE_INTEGER+1].map(value=>(s:WorkspaceSnapshot)=>{s.layout.free.rects[s.rooms[0].id].z=value;}),
    s=>{s.rooms[0].audio.preferredVolume=2;},s=>{s.layout.focus.primaryShare=Infinity;},
  ];
  for (const mutate of mutations) { const dirty=sample(); mutate(dirty); assert.throws(()=>validateWorkspace(dirty)); }
});
test('getter errors and proxy errors are scrubbed and unknown fields are never accessed',() => {
  const first = sample();
  Object.defineProperty(first,'cookie',{get(){throw new Error('SECRET_COOKIE');}});
  assert.equal(validateWorkspace(first).id,first.id);
  Object.defineProperty(first,'name',{get(){throw new Error('SECRET_PASSWORD');}});
  assert.throws(()=>validateWorkspace(first),{message:'Invalid workspace configuration.'});
});
test('concurrent saves use call order and capture values before caller mutation',async t => {
  const directory = await isolated(t), repo = new WorkspaceRepository(directory), snapshot=sample();
  const saves = Array.from({length:25},(_,i)=>{
    snapshot.name=`save-${i}`;
    return repo.save(snapshot);
  });
  snapshot.name='unsaved mutation';
  await Promise.all(saves);
  assert.equal((await repo.load()).snapshot?.name,'save-24');
  assert.equal(JSON.parse(await readFile(join(directory,'workspace.backup.json'),'utf8')).name,'save-23');
  assert.deepEqual((await readdir(directory)).sort(),['workspace.backup.json','workspace.json']);
});
test('interrupted temporary file is ignored; a failed backup operation keeps the only valid primary',async t => {
  const directory = await isolated(t), repo = new WorkspaceRepository(directory), first=sample();
  await repo.save(first);
  await writeFile(join(directory,'.workspace-interrupted.tmp'),'{');
  assert.deepEqual((await repo.load()).snapshot,first);
  await mkdir(join(directory,'workspace.backup.json'));
  await assert.rejects(repo.save({...first,name:'should not win'}),/Workspace (read|write) failed/);
  assert.deepEqual((await repo.load()).snapshot,first);
  await rm(join(directory,'workspace.backup.json'),{recursive:true});
  await repo.save({...first,name:'queue recovered'});
  assert.equal((await repo.load()).snapshot?.name,'queue recovered');
});
test('recovery and saving never read, enumerate or delete the separate session directory',async t => {
  const directory = await isolated(t), sessions=join(directory,'sessions');
  await mkdir(sessions); await writeFile(join(sessions,'opaque.fixture'),'SESSION_SENTINEL');
  const repo=new WorkspaceRepository(directory),first=sample();
  await repo.save(first); await repo.save(first);
  await writeFile(join(directory,'workspace.json'),'invalid'); await repo.load();
  assert.equal(await readFile(join(sessions,'opaque.fixture'),'utf8'),'SESSION_SENTINEL');
  assert.deepEqual(await readdir(sessions),['opaque.fixture']);
});
