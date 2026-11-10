import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceCatalog } from '../../../src/main/storage/catalog.ts';
import type { WorkspaceSnapshot } from '../../../src/shared/contracts.ts';

function sample(name='原始组合'):WorkspaceSnapshot {
  const id=randomUUID();
  return {schemaVersion:1,id:randomUUID(),name,
    rooms:[{id,platform:'huya',platformRoomId:'123',canonicalUrl:'https://www.huya.com/123',chat:{visible:true,preferredWidthDip:320},audio:{allowed:false,preferredVolume:0.6}}],
    stableOrder:[id],layout:{base:'equal',editing:'free',primaryRoomId:id,equal:{variant:'balanced',order:[id]},focus:{variant:'left',order:[id],primaryShare:0.65},free:{from:'equal',rects:{[id]:{x:0.1,y:0.2,width:0.7,height:0.8,z:3}}}}};
}
async function isolated(t:import('node:test').TestContext):Promise<string> {
  const directory=await mkdtemp(join(tmpdir(),'live-union-catalog-'));
  t.after(async()=>{await rm(directory,{recursive:true,force:true});});
  return directory;
}
async function json(path:string):Promise<any>{return JSON.parse(await readFile(path,'utf8'));}

test('first empty catalog does not invent workspace files or active rooms',async t=>{
  const directory=await isolated(t),catalog=new WorkspaceCatalog(join(directory,'new'));
  assert.deepEqual(await catalog.list(),[]);
  assert.deepEqual(await catalog.loadActive(),{source:'empty',entries:[],warnings:[]});
  assert.deepEqual(await readdir(directory),[]);
});
test('saveAs preserves room identity and preferences, switches active and survives restart',async t=>{
  const directory=await isolated(t),catalog=new WorkspaceCatalog(directory),first=sample();
  await catalog.save(first);
  const copied=await catalog.saveAs(first,'麻将夜场 Ⅱ');
  assert.notEqual(copied.id,first.id);
  assert.deepEqual({...copied,id:first.id,name:first.name},first);
  assert.equal(first.name,'原始组合');
  assert.deepEqual(await catalog.list(),[{id:first.id,name:first.name},{id:copied.id,name:copied.name}]);
  const restarted=new WorkspaceCatalog(directory),result=await restarted.loadActive();
  assert.deepEqual(result.snapshot,copied);assert.equal(result.entries.length,2);
  assert.deepEqual((await restarted.open(first.id)).snapshot,first);
  assert.equal((await new WorkspaceCatalog(directory).loadActive()).snapshot?.id,first.id);
});
test('save updates name and active entry without duplicating entries or altering room IDs',async t=>{
  const directory=await isolated(t),catalog=new WorkspaceCatalog(directory),first=sample();
  await catalog.save(first);const second=await catalog.saveAs(first,'另一组');
  const renamed={...first,name:'重新命名组合'};
  await catalog.save(renamed);
  assert.deepEqual(await catalog.list(),[{id:first.id,name:renamed.name},{id:second.id,name:second.name}]);
  assert.deepEqual((await catalog.loadActive()).snapshot,renamed);
});
test('concurrent saves capture caller data and preserve call order and latest active state',async t=>{
  const directory=await isolated(t),catalog=new WorkspaceCatalog(directory),snapshot=sample();
  const writes=Array.from({length:20},(_,i)=>{snapshot.name=`顺序${i}`;return catalog.save(snapshot);});
  snapshot.name='未保存';await Promise.all(writes);
  assert.equal((await catalog.loadActive()).snapshot?.name,'顺序19');
  assert.equal((await json(join(directory,'catalog.json'))).entries[0].name,'顺序19');
  assert.equal((await json(join(directory,'catalog.backup.json'))).entries[0].name,'顺序18');
  assert.equal((await json(join(directory,'workspaces',snapshot.id,'workspace.backup.json'))).name,'顺序18');
});
test('unregistered IDs and path traversal reject without file lookup or changing active',async t=>{
  const directory=await isolated(t),catalog=new WorkspaceCatalog(directory),first=sample();await catalog.save(first);
  const orphan=sample();await mkdir(join(directory,'workspaces',orphan.id));
  await writeFile(join(directory,'workspaces',orphan.id,'workspace.json'),JSON.stringify(orphan));
  for(const id of [orphan.id,randomUUID(),'../../SECRET_PATH'])await assert.rejects(catalog.open(id),error=>error instanceof Error&&!error.message.includes('SECRET_PATH'));
  assert.equal((await catalog.loadActive()).snapshot?.id,first.id);
  assert.equal((await catalog.list()).length,1);
});
test('registered missing or mismatched snapshots fail explicitly, and open failure preserves active',async t=>{
  const directory=await isolated(t),catalog=new WorkspaceCatalog(directory),first=sample();await catalog.save(first);
  const second=await catalog.saveAs(first,'二');await catalog.open(first.id);
  await rm(join(directory,'workspaces',second.id),{recursive:true});
  await assert.rejects(catalog.open(second.id),/Saved workspace is unavailable/);
  assert.equal((await catalog.loadActive()).snapshot?.id,first.id);
  await mkdir(join(directory,'workspaces',second.id));
  await writeFile(join(directory,'workspaces',second.id,'workspace.json'),JSON.stringify(first));
  await assert.rejects(catalog.open(second.id),/identity does not match/);
});
test('corrupt manifest is preserved byte for byte and recovered from valid backup',async t=>{
  const directory=await isolated(t),catalog=new WorkspaceCatalog(directory),first=sample();
  await catalog.save(first);await catalog.saveAs(first,'新组合');
  const backup=await readFile(join(directory,'catalog.backup.json'),'utf8');
  await writeFile(join(directory,'catalog.json'),'{broken');
  const loaded=await new WorkspaceCatalog(directory).loadActive();
  assert.equal(loaded.snapshot?.id,first.id);assert.ok(loaded.warnings.length>0);
  assert.equal(await readFile(join(directory,'catalog.backup.json'),'utf8'),backup);
  const preserved=(await readdir(directory)).filter(name=>name.startsWith('catalog.corrupt-'));
  assert.equal(preserved.length,1);assert.equal(await readFile(join(directory,preserved[0]),'utf8'),'{broken');
  assert.equal((await json(join(directory,'catalog.json'))).activeId,first.id);
});
test('invalid catalog without a valid backup fails instead of appearing to be a new empty catalog',async t=>{
  const directory=await isolated(t),catalog=new WorkspaceCatalog(directory);
  await writeFile(join(directory,'catalog.json'),'null');
  await assert.rejects(catalog.loadActive(),/unavailable/);
  await assert.rejects(catalog.save(sample()),/unavailable/);
  assert.ok(!(await readdir(directory)).includes('workspaces'));
});
test('future primary and future backup are never overwritten, including before a workspace save',async t=>{
  const directory=await isolated(t),catalog=new WorkspaceCatalog(directory),first=sample();await catalog.save(first);await catalog.save(first);
  const workspacePath=join(directory,'workspaces',first.id,'workspace.json'),originalWorkspace=await readFile(workspacePath,'utf8');
  for(const filename of ['catalog.json','catalog.backup.json']) {
    const original=await readFile(join(directory,filename),'utf8');
    const future=JSON.stringify({...JSON.parse(original),schemaVersion:2});await writeFile(join(directory,filename),future);
    if(filename==='catalog.json')await assert.rejects(catalog.loadActive(),/Unsupported/);
    await assert.rejects(catalog.save({...first,name:'must not write'}),/Unsupported/);
    await assert.rejects(catalog.open(first.id),/Unsupported/);
    assert.equal(await readFile(join(directory,filename),'utf8'),future);
    assert.equal(await readFile(workspacePath,'utf8'),originalWorkspace);
    await writeFile(join(directory,filename),original);
  }
});
test('manifest whitelist strips extras on rewrite; names and IDs have bounded validation',async t=>{
  const directory=await isolated(t),catalog=new WorkspaceCatalog(directory),first=sample();await catalog.save(first);
  const dirty=await json(join(directory,'catalog.json'));dirty.cookie='SECRET_COOKIE';dirty.entries[0].token='SECRET_TOKEN';
  await writeFile(join(directory,'catalog.json'),JSON.stringify(dirty));await catalog.open(first.id);
  for(const filename of ['catalog.json','catalog.backup.json'])assert.ok(!(await readFile(join(directory,filename),'utf8')).includes('SECRET_'));
  for(const name of ['', ' ', 'x'.repeat(257),'bad\nname'])await assert.rejects(catalog.saveAs(first,name));
  dirty.entries.push({id:first.id.toUpperCase(),name:'case duplicate'});await writeFile(join(directory,'catalog.json'),JSON.stringify(dirty));
  assert.equal((await catalog.loadActive()).snapshot?.id,first.id); // invalid duplicate primary recovers backup
});
test('manifest write failure preserves valid manifest and queue recovers after obstruction removal',async t=>{
  const directory=await isolated(t),catalog=new WorkspaceCatalog(directory),first=sample();await catalog.save(first);
  const original=await readFile(join(directory,'catalog.json'),'utf8');await mkdir(join(directory,'catalog.backup.json'));
  await assert.rejects(catalog.save({...first,name:'blocked'}));
  assert.equal(await readFile(join(directory,'catalog.json'),'utf8'),original);
  await rm(join(directory,'catalog.backup.json'),{recursive:true});
  await catalog.save({...first,name:'recovered'});assert.equal((await catalog.loadActive()).snapshot?.name,'recovered');
});
test('session sentinel and unregistered directories remain untouched through save/copy/open/recovery',async t=>{
  const directory=await isolated(t),sessions=join(directory,'sessions');await mkdir(sessions);
  await writeFile(join(sessions,'opaque.fixture'),'SESSION_SENTINEL');
  const catalog=new WorkspaceCatalog(directory),first=sample();await catalog.save(first);
  await catalog.saveAs(first,'新');await catalog.open(first.id);
  await writeFile(join(directory,'catalog.json'),'broken');await catalog.loadActive();
  assert.deepEqual(await readdir(sessions),['opaque.fixture']);assert.equal(await readFile(join(sessions,'opaque.fixture'),'utf8'),'SESSION_SENTINEL');
});
