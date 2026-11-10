import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,readdir,mkdir,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WorkspaceCatalog } from '../../../src/main/storage/catalog.ts';
import { emptyWorkspace } from '../../../src/main/bootstrap/controller.ts';

test('history sources do not activate workspaces, rewrite preferences, or include deleted/orphan/old backup rooms',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'live-union-history-sources-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const catalog=new WorkspaceCatalog(directory),one=emptyWorkspace(),two=emptyWorkspace();
  const room=(id:string)=>({id:randomUUID(),platform:'huya' as const,platformRoomId:id,canonicalUrl:`https://www.huya.com/${id}`,chat:{visible:true,preferredWidthDip:280},audio:{allowed:true,preferredVolume:.6}});
  one.rooms=[room('123'),room('456')];one.stableOrder=one.rooms.map(r=>r.id);one.layout.equal.order=[...one.stableOrder];one.layout.focus.order=[...one.stableOrder];
  two.rooms=[room('789')];two.stableOrder=two.rooms.map(r=>r.id);two.layout.equal.order=[...two.stableOrder];two.layout.focus.order=[...two.stableOrder];
  await catalog.save(one);await catalog.save(two);
  one.rooms.splice(1);one.stableOrder=one.rooms.map(r=>r.id);one.layout.equal.order=[...one.stableOrder];one.layout.focus.order=[...one.stableOrder];await catalog.save(one);
  const orphan=emptyWorkspace();await mkdir(join(directory,'workspaces',orphan.id));await writeFile(join(directory,'workspaces',orphan.id,'workspace.json'),JSON.stringify({...two,id:orphan.id}));
  const beforeManifest=await readFile(join(directory,'catalog.json'),'utf8'),beforeOne=await readFile(join(directory,'workspaces',one.id,'workspace.json'),'utf8'),beforeTwo=await readFile(join(directory,'workspaces',two.id,'workspace.json'),'utf8');
  const result=await catalog.historySources();assert.deepEqual(result.rooms.map(r=>r.platformRoomId),['123','789']);
  assert.equal(await readFile(join(directory,'catalog.json'),'utf8'),beforeManifest);assert.equal(await readFile(join(directory,'workspaces',one.id,'workspace.json'),'utf8'),beforeOne);assert.equal(await readFile(join(directory,'workspaces',two.id,'workspace.json'),'utf8'),beforeTwo);
  assert.equal((await catalog.loadActive()).snapshot?.id,one.id);
});

test('recoverable history source reads a backup without repairing corrupt primary or muting saved audio',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'live-union-history-sources-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const catalog=new WorkspaceCatalog(directory),w=emptyWorkspace();const id=randomUUID();w.rooms=[{id,platform:'douyu',platformRoomId:'9999',canonicalUrl:'https://www.douyu.com/9999',chat:{visible:false,preferredWidthDip:300},audio:{allowed:true}}];w.stableOrder=[id];w.layout.equal.order=[id];w.layout.focus.order=[id];await catalog.save(w);await catalog.save(w);
  const primary=join(directory,'workspaces',w.id,'workspace.json');await writeFile(primary,'broken');const before=await readdir(join(directory,'workspaces',w.id));
  const result=await catalog.historySources();assert.equal(result.rooms[0].platformRoomId,'9999');assert.ok(result.warnings.length);assert.equal(await readFile(primary,'utf8'),'broken');assert.deepEqual(await readdir(join(directory,'workspaces',w.id)),before);
  const backup=JSON.parse(await readFile(join(directory,'workspaces',w.id,'workspace.backup.json'),'utf8'));assert.equal(backup.rooms[0].audio.allowed,true);
});
