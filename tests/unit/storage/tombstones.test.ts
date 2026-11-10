import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceRepository } from '../../../src/main/storage/index.ts';
import type { WorkspaceSnapshot } from '../../../src/shared/contracts.ts';

function sample():WorkspaceSnapshot {
  const ids=Array.from({length:3},()=>randomUUID());
  return {schemaVersion:1,id:randomUUID(),name:'删除恢复测试',
    rooms:ids.map((id,i)=>({id,platform:'huya',platformRoomId:String(100+i),canonicalUrl:`https://www.huya.com/${100+i}`,chat:{visible:true,preferredWidthDip:300},audio:{allowed:false}})),
    stableOrder:ids,layout:{base:'focus',editing:'free',primaryRoomId:ids[1],equal:{variant:'balanced',order:[...ids]},focus:{variant:'left',order:[...ids].reverse()},free:{from:'equal',rects:Object.fromEntries(ids.map((id,z)=>[id,{x:0,y:0,width:1,height:1,z}]))}}};
}
function remove(snapshot:WorkspaceSnapshot,roomId:string):WorkspaceSnapshot {
  const next=structuredClone(snapshot);
  next.rooms=next.rooms.filter(room=>room.id!==roomId);
  next.stableOrder=next.stableOrder.filter(id=>id!==roomId);
  next.layout.equal.order=next.layout.equal.order.filter(id=>id!==roomId);
  next.layout.focus.order=next.layout.focus.order.filter(id=>id!==roomId);
  delete next.layout.free.rects[roomId];
  if(next.layout.primaryRoomId===roomId){if(next.stableOrder.length)next.layout.primaryRoomId=next.stableOrder[0];else delete next.layout.primaryRoomId;}
  return next;
}
async function isolated(t:import('node:test').TestContext):Promise<string> {
  const directory=await mkdtemp(join(tmpdir(),'live-union-deletions-'));
  t.after(async()=>{await rm(directory,{recursive:true,force:true});});
  return directory;
}
test('AT22: deleted room cannot return from older valid backup after corrupt primary',async t=>{
  const directory=await isolated(t),repo=new WorkspaceRepository(directory),first=sample(),deleted=first.rooms[1].id;
  await repo.save(first);await repo.save(remove(first,deleted));
  await writeFile(join(directory,'workspace.json'),'{broken');
  const result=await new WorkspaceRepository(directory).load();
  assert.equal(result.source,'backup');const restored=result.snapshot!;
  assert.deepEqual(restored.stableOrder,[first.rooms[0].id,first.rooms[2].id]);
  assert.equal(restored.rooms.length,2);assert.ok(!restored.rooms.some(room=>room.id===deleted));
  assert.ok(!restored.layout.equal.order.includes(deleted));assert.ok(!restored.layout.focus.order.includes(deleted));
  assert.ok(!(deleted in restored.layout.free.rects));
  assert.equal(restored.layout.primaryRoomId,first.rooms[2].id);
  assert.deepEqual((await new WorkspaceRepository(directory).load()).snapshot,restored);
  assert.ok((await readdir(directory)).some(name=>name.startsWith('workspace.corrupt-')));
});
test('all deleted rooms recover as genuinely empty with no dangling primary or geometry',async t=>{
  const directory=await isolated(t),repo=new WorkspaceRepository(directory),first=sample();await repo.save(first);
  let empty=first;for(const room of first.rooms)empty=remove(empty,room.id);
  await repo.save(empty);await rm(join(directory,'workspace.json'));
  const result=await repo.load();assert.equal(result.source,'backup');
  assert.deepEqual(result.snapshot?.rooms,[]);assert.deepEqual(result.snapshot?.stableOrder,[]);
  assert.deepEqual(result.snapshot?.layout.free.rects,{});assert.equal(result.snapshot?.layout.primaryRoomId,undefined);
});
test('direct save with damaged or missing primary derives deletion history from valid backup',async t=>{
  for(const damage of ['corrupt','missing'] as const){
    const directory=await isolated(t),repo=new WorkspaceRepository(directory),first=sample(),deleted=first.rooms[1].id;
    await repo.save(first);await repo.save(first);
    const backupBefore=await readFile(join(directory,'workspace.backup.json'),'utf8');
    if(damage==='corrupt')await writeFile(join(directory,'workspace.json'),'{first corruption');
    else await rm(join(directory,'workspace.json'));
    // Current in-memory state was edited; no load/recovery occurs before save.
    await repo.save(remove(first,deleted));
    assert.equal(await readFile(join(directory,'workspace.backup.json'),'utf8'),backupBefore);
    const journal=JSON.parse(await readFile(join(directory,'workspace.tombstones.json'),'utf8'));
    assert.deepEqual(journal.deletedRoomIds,[deleted]);
    await writeFile(join(directory,'workspace.json'),'{second corruption');
    const recovered=await new WorkspaceRepository(directory).load();
    assert.equal(recovered.source,'backup');assert.equal(recovered.snapshot?.rooms.length,2);
    assert.ok(!recovered.snapshot?.stableOrder.includes(deleted));
    assert.ok(!(deleted in recovered.snapshot!.layout.free.rects));
    assert.equal(recovered.snapshot?.layout.primaryRoomId,first.rooms[2].id);
  }
});
test('deleted UUID cannot be reused, but adding same platform room with a fresh UUID works',async t=>{
  const directory=await isolated(t),repo=new WorkspaceRepository(directory),first=sample(),deleted=first.rooms[1].id;
  await repo.save(first);const next=remove(first,deleted);await repo.save(next);
  await assert.rejects(repo.save(first),/cannot be reused/);
  const fresh=randomUUID(),replacement=structuredClone(first);
  replacement.rooms[1].id=fresh;replacement.stableOrder[1]=fresh;replacement.layout.primaryRoomId=fresh;
  replacement.layout.equal.order[1]=fresh;replacement.layout.focus.order[1]=fresh;
  replacement.layout.free.rects[fresh]=replacement.layout.free.rects[deleted];delete replacement.layout.free.rects[deleted];
  await repo.save(replacement);assert.deepEqual((await repo.load()).snapshot,replacement);
});
test('interruption after deletion journal commit filters still-old primary; failed save does not undo deletion',async t=>{
  const directory=await isolated(t),repo=new WorkspaceRepository(directory),first=sample(),deleted=first.rooms[1].id;await repo.save(first);
  // Fault at the primary commit boundary, after real journal and backup writes.
  const internal=repo as any,atomic=internal.atomic.bind(repo);
  internal.atomic=async(name:string,data:string|Buffer)=>{if(name==='workspace.json')throw new Error('Injected interrupted primary commit.');await atomic(name,data);};
  await assert.rejects(repo.save(remove(first,deleted)),/Injected/);
  const raw=JSON.parse(await readFile(join(directory,'workspace.json'),'utf8'));
  assert.equal(raw.rooms.length,3);
  const reopened=new WorkspaceRepository(directory),result=await reopened.load();
  assert.equal(result.source,'primary');assert.equal(result.snapshot?.rooms.length,2);
  assert.ok(!result.snapshot?.stableOrder.includes(deleted));
  await assert.rejects(reopened.save(first),/cannot be reused/);
  await reopened.save(result.snapshot!);
});
test('failed deletion journal write leaves original valid snapshot and never commits requested primary',async t=>{
  const directory=await isolated(t),repo=new WorkspaceRepository(directory),first=sample();await repo.save(first);
  const original=await readFile(join(directory,'workspace.json'),'utf8');
  // Create a real rename obstruction only after the journal has been read.
  const internal=repo as any,atomic=internal.atomic.bind(repo);
  internal.atomic=async(name:string,data:string|Buffer)=>{
    if(name==='workspace.tombstones.json')await mkdir(join(directory,name));
    await atomic(name,data);
  };
  await assert.rejects(repo.save(remove(first,first.rooms[1].id)),/Workspace write failed/);
  assert.equal(await readFile(join(directory,'workspace.json'),'utf8'),original);
  assert.ok(!(await readdir(directory)).includes('workspace.backup.json'));
  assert.ok(!(await readdir(directory)).some(name=>name.endsWith('.tmp')));
  await rm(join(directory,'workspace.tombstones.json'),{recursive:true});
  assert.deepEqual((await repo.load()).snapshot,first);
});
test('corrupt, malformed or future deletion history fails closed and remains untouched',async t=>{
  const directory=await isolated(t),repo=new WorkspaceRepository(directory),first=sample();await repo.save(first);await repo.save(first);
  const workspace=await readFile(join(directory,'workspace.json'),'utf8');
  for(const raw of ['{broken','null',JSON.stringify({schemaVersion:1,deletedRoomIds:['SECRET_INVALID']}),JSON.stringify({schemaVersion:2,deletedRoomIds:[]})]){
    await writeFile(join(directory,'workspace.tombstones.json'),raw);
    await assert.rejects(repo.load(),error=>error instanceof Error&&/deletion history/.test(error.message)&&!error.message.includes('SECRET_INVALID'));
    await assert.rejects(repo.save(remove(first,first.rooms[1].id)));
    assert.equal(await readFile(join(directory,'workspace.tombstones.json'),'utf8'),raw);
    assert.equal(await readFile(join(directory,'workspace.json'),'utf8'),workspace);
  }
});
test('future workspace primary or backup prevents even an earlier deletion journal commit',async t=>{
  const directory=await isolated(t),repo=new WorkspaceRepository(directory),first=sample();await repo.save(first);await repo.save(first);
  for(const filename of ['workspace.json','workspace.backup.json']){
    const path=join(directory,filename),original=await readFile(path,'utf8'),future=JSON.stringify({...first,schemaVersion:2});await writeFile(path,future);
    await assert.rejects(repo.save(remove(first,first.rooms[1].id)),/Unsupported/);
    assert.ok(!(await readdir(directory)).includes('workspace.tombstones.json'));
    assert.equal(await readFile(path,'utf8'),future);await writeFile(path,original);
  }
});
test('successive deletions accumulate across restart and do not touch independent session files',async t=>{
  const directory=await isolated(t),sessions=join(directory,'Partitions');await mkdir(sessions);await writeFile(join(sessions,'opaque.fixture'),'SESSION_SENTINEL');
  const first=sample(),repo=new WorkspaceRepository(directory);await repo.save(first);
  const next=remove(first,first.rooms[0].id);await repo.save(next);
  const last=remove(next,first.rooms[1].id);await new WorkspaceRepository(directory).save(last);
  const journal=JSON.parse(await readFile(join(directory,'workspace.tombstones.json'),'utf8'));
  assert.deepEqual(new Set(journal.deletedRoomIds),new Set(first.rooms.slice(0,2).map(room=>room.id)));
  await writeFile(join(directory,'workspace.json'),'broken');assert.equal((await repo.load()).snapshot?.rooms.length,1);
  assert.equal(await readFile(join(sessions,'opaque.fixture'),'utf8'),'SESSION_SENTINEL');assert.deepEqual(await readdir(sessions),['opaque.fixture']);
});
