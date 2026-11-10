import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { HistoryRepository, validateHistoryAddress, validateHistorySnapshot } from '../../../src/main/history/repository.ts';
import type { HistoryAddress, RoomHistorySnapshot } from '../../../src/shared/history-contracts.ts';

const PRIMARY = 'history.json', BACKUP = 'history.backup.json', PROTECTION = 'history.tombstones.json';
function address(platform:HistoryAddress['platform'] = 'huya',id = '100'):HistoryAddress {
  return {platform,platformRoomId:id,canonicalUrl:`https://${{huya:'www.huya.com',douyu:'www.douyu.com',bilibili:'live.bilibili.com'}[platform]}/${id}`};
}
function sample():RoomHistorySnapshot {
  return {schemaVersion:1,bootstrapComplete:true,entries:[{id:randomUUID(),...address(),lastAddedAt:100,nickname:'主播'}]};
}
async function isolated(t:import('node:test').TestContext):Promise<string> {
  const directory = await mkdtemp(join(tmpdir(),'live-union-history-'));
  t.after(async () => { await rm(directory,{recursive:true,force:true}); });
  return directory;
}
async function raw(directory:string,name = PRIMARY):Promise<any> { return JSON.parse(await readFile(join(directory,name),'utf8')); }
function messagesSafe(error:unknown):boolean { return error instanceof Error && !/SECRET|Cookie|token|C:\\/.test(error.message); }

test('empty history load is read-only and snapshot is a detached whitelist clone',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(join(directory,'not-created'));
  assert.deepEqual(await repo.load(),{snapshot:{schemaVersion:1,bootstrapComplete:false,entries:[]},warnings:[]});
  assert.deepEqual(await readdir(directory),[]);
  repo.snapshot.entries.push(sample().entries[0]);
  assert.deepEqual(repo.snapshot.entries,[]);
  await repo.flush();
});

test('FR01: canonical identities require exact platform, room and URL spelling',() => {
  for (const entry of [address(),address('huya','valid_alias-1'),address('douyu','9999'),address('bilibili','7734200')]) assert.deepEqual(validateHistoryAddress(entry),entry);
  for (const entry of [
    {...address(),platform:'douyu'}, {...address(),platformRoomId:'101'},
    address('douyu','alias'),address('bilibili','0'),address('huya','g'),address('huya','0001'),
    ...['http://www.huya.com/100','https://huya.com/100','https://www.huya.com:443/100','https://www.huya.com/100/',
      'https://www.huya.com/100?token=SECRET','https://www.huya.com/100#SECRET','https://SECRET@www.huya.com/100',
      'https://www.huya.com/%31%30%30','https://www.huya.com/a/../100','https://www.huya.com/100\n'].map(canonicalUrl => ({...address(),canonicalUrl})),
  ]) assert.throws(() => validateHistoryAddress(entry),messagesSafe);
});

test('AT28: snapshot validation strips unknown private fields, titles and caller prototypes',() => {
  const value:any = sample(); value.Cookie = 'SECRET'; value.entries[0].token = 'SECRET'; value.entries[0].title = 'SECRET_TITLE'; value.entries[0].chat = {text:'SECRET'};
  const clean = validateHistorySnapshot(value);
  assert.deepEqual(Object.keys(clean),['schemaVersion','bootstrapComplete','entries']);
  assert.deepEqual(Object.keys(clean.entries[0]),['id','platform','platformRoomId','canonicalUrl','lastAddedAt','nickname']);
  assert.ok(!JSON.stringify(clean).includes('SECRET'));
  delete value.entries[0].nickname;
  assert.equal(validateHistorySnapshot(value).entries[0].nickname,undefined);
  value.entries[0].nickname = 'Changed'; assert.equal(clean.entries[0].nickname,'主播');
  assert.throws(() => validateHistorySnapshot(Object.assign(Object.create({}),value)),messagesSafe);
  const injected = new Proxy(value,{get(){throw new Error('SECRET Cookie token');}});
  assert.throws(() => validateHistorySnapshot(injected),messagesSafe);
});

test('malformed identities, timestamps, duplicates and unbounded nicknames are rejected safely',() => {
  for (const mutate of [
    (s:any) => s.entries[0].id = '../SECRET', (s:any) => s.entries[0].lastAddedAt = -1,
    (s:any) => s.entries[0].lastAddedAt = 1.5,(s:any) => s.entries[0].lastAddedAt = Infinity,
    (s:any) => s.entries[0].nickname = '',(s:any) => s.entries[0].nickname = 'a'.repeat(257),
    (s:any) => s.entries[0].nickname = 'SECRET\n',(s:any) => s.entries[0].nickname = '\u202eSECRET',
    (s:any) => s.entries.push({...s.entries[0],id:randomUUID()}),
    (s:any) => s.entries.push({...s.entries[0],...address('huya','101')}),
  ]) { const value = sample(); mutate(value); assert.throws(() => validateHistorySnapshot(value),messagesSafe); }
  const good = sample(); good.entries[0].nickname = 'a'.repeat(256); assert.equal(validateHistorySnapshot(good).entries[0].nickname?.length,256);
});

test('record persists cross-instance, captures input and records genuine addition times',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory), input:any = {...address(),Cookie:'SECRET',nickname:'Not trusted'};
  const before = Date.now(), pending = repo.record(input); input.platformRoomId = 'SECRET';
  const entry = await pending, after = Date.now();
  assert.ok(entry.lastAddedAt! >= before && entry.lastAddedAt! <= after);
  assert.equal(entry.platformRoomId,'100'); assert.equal(entry.nickname,undefined);
  entry.platformRoomId = 'SECRET'; repo.snapshot.entries[0].platformRoomId = 'SECRET';
  const loaded = await new HistoryRepository(directory).load(); assert.equal(loaded.snapshot.entries[0].platformRoomId,'100');
  loaded.snapshot.entries[0].nickname = 'SECRET'; assert.equal(repo.snapshot.entries[0].nickname,undefined);
  assert.ok(!(await readFile(join(directory,PRIMARY),'utf8')).includes('SECRET'));
});

test('platform plus normalized room deduplicates globally; repeated additions move only that entry to MRU',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory);
  const first = await repo.record(address()), other = await repo.record(address('douyu'));
  await repo.updateNickname(first.id,'真实主播');
  const again = await repo.record(address());
  assert.equal(again.id,first.id); assert.equal(again.nickname,'真实主播');
  assert.deepEqual(repo.snapshot.entries.map(entry => entry.id),[first.id,other.id]);
  assert.equal(repo.snapshot.entries.length,2);
  assert.deepEqual((await new HistoryRepository(directory).load()).snapshot,repo.snapshot);
});

test('one-time backfill preserves real MRU additions, removes duplicates, sorts legacy seeds and invents no time',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory);
  const real = await repo.record(address('douyu','9999'));
  const input = [address('huya','zAlias'),address('huya','100'),address('bilibili','7734200'),address('huya','100'),address('douyu','9999')];
  await repo.bootstrap(input);
  assert.equal(repo.snapshot.bootstrapComplete,true);
  assert.equal(repo.snapshot.entries[0].id,real.id); assert.equal(repo.snapshot.entries[0].lastAddedAt,real.lastAddedAt);
  assert.deepEqual(repo.snapshot.entries.slice(1).map(entry => `${entry.platform}:${entry.platformRoomId}`),['bilibili:7734200','huya:100','huya:zAlias']);
  assert.ok(repo.snapshot.entries.slice(1).every(entry => entry.lastAddedAt === null));
  const expected = repo.snapshot;
  await repo.bootstrap([address('huya','200')]); assert.deepEqual(repo.snapshot,expected);
  const reopened = new HistoryRepository(directory); await reopened.bootstrap([address('huya','201')]); assert.deepEqual(reopened.snapshot,expected);
  const now = await reopened.record(address('huya','100')); assert.notEqual(now.lastAddedAt,null); assert.equal(now.id,expected.entries[2].id);
});

test('queued bootstrap cannot overwrite an already queued real addition or caller mutation',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory), seeds = [address('huya','101')];
  const recording = repo.record(address()), bootstrapping = repo.bootstrap(seeds); seeds[0].platformRoomId = 'SECRET';
  await Promise.all([recording,bootstrapping]);
  assert.deepEqual(repo.snapshot.entries.map(entry => entry.platformRoomId),['100','101']);
  assert.equal(repo.snapshot.entries[1].lastAddedAt,null);
});

test('nickname update is bounded, changes no MRU order or timestamp and unknown nickname stays absent',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory), first = await repo.record(address());
  await repo.record(address('douyu'));
  const before = repo.snapshot;
  assert.equal(await repo.updateNickname(first.id,'  主播昵称  '),true);
  assert.deepEqual(repo.snapshot.entries.map(({id,lastAddedAt}) => ({id,lastAddedAt})),before.entries.map(({id,lastAddedAt}) => ({id,lastAddedAt})));
  assert.equal(repo.snapshot.entries[1].nickname,'主播昵称'); assert.equal(repo.snapshot.entries[0].nickname,undefined);
  assert.equal(await repo.updateNickname(randomUUID(),'未知'),false);
  await assert.rejects(repo.updateNickname(first.id,'SECRET\n'),messagesSafe);
  await assert.rejects(repo.updateNickname(first.id,'x'.repeat(257)),messagesSafe);
  assert.equal(repo.snapshot.entries[1].nickname,'主播昵称');
});

test('remove and delayed nickname update never revive UUID; same room re-add receives a new UUID',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory), first = await repo.record(address());
  const remove = repo.remove(first.id), late = repo.updateNickname(first.id,'迟到昵称');
  await remove; assert.equal(await late,false); assert.equal(repo.snapshot.entries.length,0);
  const again = await repo.record(address()); assert.notEqual(again.id,first.id); assert.equal(again.nickname,undefined);
  assert.equal(await repo.updateNickname(first.id,'更迟昵称'),false);
  await repo.remove(randomUUID()); assert.equal(repo.snapshot.entries[0].id,again.id);
  assert.deepEqual((await new HistoryRepository(directory).load()).snapshot,repo.snapshot);
});

test('delete before initial backfill excludes only that canonical room across backup recovery',async t=>{
  const directory=await isolated(t),repo=new HistoryRepository(directory),entry=await repo.record(address());
  await repo.remove(entry.id);await writeFile(join(directory,PRIMARY),'{broken');
  const reopened=new HistoryRepository(directory);await reopened.load();assert.equal(reopened.snapshot.bootstrapComplete,false);
  await reopened.bootstrap([address(),address('douyu')]);assert.deepEqual(reopened.snapshot.entries.map(e=>e.platform),['douyu']);
  const fresh=await reopened.record(address());assert.notEqual(fresh.id,entry.id);
});

for (const damage of ['corrupt','missing'] as const) test(`AT22: ${damage} primary recovers without deleted entries or renewed bootstrap`,async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory);
  await repo.bootstrap([address(),address('douyu')]);
  const deleted = repo.snapshot.entries[0]; await repo.remove(deleted.id);
  if (damage === 'corrupt') await writeFile(join(directory,PRIMARY),'{SECRET broken'); else await rm(join(directory,PRIMARY));
  const reopened = new HistoryRepository(directory), result = await reopened.load();
  assert.equal(result.snapshot.entries.length,1); assert.ok(!result.snapshot.entries.some(entry => entry.id === deleted.id));
  assert.ok(result.warnings.some(value => value.includes('recovered'))); assert.ok(result.warnings.every(value => !value.includes('SECRET')));
  await reopened.bootstrap([deleted]); assert.equal(reopened.snapshot.entries.length,1);
  assert.equal(await reopened.updateNickname(deleted.id,'迟到'),false);
  assert.deepEqual((await new HistoryRepository(directory).load()).snapshot,reopened.snapshot);
});

test('clear keeps once-only marker across restart, broken main and stale old backup; touches only history files',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory);
  await writeFile(join(directory,'workspace.fixture'),'SAVED_WORKSPACE');
  await mkdir(join(directory,'Partitions')); await writeFile(join(directory,'Partitions','session.fixture'),'SESSION');
  await repo.bootstrap([address(),address('douyu')]);
  const stale = await readFile(join(directory,PRIMARY),'utf8'), ids = repo.snapshot.entries.map(entry => entry.id);
  await repo.clear(); assert.deepEqual(repo.snapshot,{schemaVersion:1,bootstrapComplete:true,entries:[]});
  await writeFile(join(directory,BACKUP),stale); await writeFile(join(directory,PRIMARY),'{broken');
  const reopened = new HistoryRepository(directory); await reopened.load(); await reopened.bootstrap([address()]);
  assert.deepEqual(reopened.snapshot.entries,[]); assert.equal(reopened.snapshot.bootstrapComplete,true);
  for (const id of ids) assert.equal(await reopened.updateNickname(id,'迟到'),false);
  assert.equal(await readFile(join(directory,'workspace.fixture'),'utf8'),'SAVED_WORKSPACE');
  assert.equal(await readFile(join(directory,'Partitions','session.fixture'),'utf8'),'SESSION');
  const fresh = await reopened.record(address()); assert.ok(!ids.includes(fresh.id));
});

test('damaged primary and backup fail explicitly without reviving history or rerunning backfill',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory); await repo.clear();
  await writeFile(join(directory,PRIMARY),'{broken'); await writeFile(join(directory,BACKUP),'null');
  const reopened = new HistoryRepository(directory);
  await assert.rejects(reopened.load(),/unavailable/);
  await assert.rejects(reopened.bootstrap([address()]),/unavailable/);
  assert.equal(await readFile(join(directory,PRIMARY),'utf8'),'{broken');
  assert.equal(await readFile(join(directory,BACKUP),'utf8'),'null');
});

test('interrupted deletion after durable protection filters old primary in memory and after restart',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory), entry = await repo.record(address());
  const internal = repo as any, atomic = internal.atomic.bind(repo);
  internal.atomic = async (name:string,data:string) => { if (name === PRIMARY) throw new Error('SECRET path Cookie token'); await atomic(name,data); };
  await assert.rejects(repo.remove(entry.id),messagesSafe);
  assert.equal((await raw(directory)).entries.length,1);
  assert.deepEqual(repo.snapshot.entries,[]); await assert.rejects(repo.flush(),messagesSafe);
  const reopened = new HistoryRepository(directory); assert.deepEqual((await reopened.load()).snapshot.entries,[]);
  assert.equal(await reopened.updateNickname(entry.id,'迟到'),false);
  internal.atomic = atomic; const fresh = await repo.record(address()); assert.notEqual(fresh.id,entry.id); await repo.flush();
});

test('interrupted clear cannot revive entries from stale primary or backup',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory); await repo.bootstrap([address(),address('douyu')]);
  const internal = repo as any, atomic = internal.atomic.bind(repo);
  internal.atomic = async (name:string,data:string) => { if (name === BACKUP) throw new Error('SECRET'); await atomic(name,data); };
  await assert.rejects(repo.clear(),messagesSafe);
  const reopened = new HistoryRepository(directory); await reopened.load(); await reopened.bootstrap([address()]);
  assert.deepEqual(reopened.snapshot.entries,[]); assert.equal(reopened.snapshot.bootstrapComplete,true);
});

test('interrupted bootstrap after marker commit recovers staged complete seeds and keeps earlier MRU',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory), real = await repo.record(address('douyu'));
  const internal = repo as any, atomic = internal.atomic.bind(repo);
  internal.atomic = async (name:string,data:string) => { if (name === PRIMARY) throw new Error('SECRET'); await atomic(name,data); };
  await assert.rejects(repo.bootstrap([address()]),messagesSafe);
  assert.equal(repo.snapshot.entries.length,2);
  const reopened = new HistoryRepository(directory), result = await reopened.load();
  assert.equal(result.snapshot.entries.length,2); assert.equal(result.snapshot.entries[0].id,real.id); assert.equal(result.snapshot.entries[1].lastAddedAt,null);
  await reopened.bootstrap([address('huya','102')]); assert.equal(reopened.snapshot.entries.length,2);
  internal.atomic = atomic; await repo.record(address('huya','103')); assert.equal(repo.snapshot.entries.length,3);
});

test('first bootstrap interruption before marker can recover staged valid data without losing protection',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory), internal = repo as any, atomic = internal.atomic.bind(repo);
  let protections = 0;
  internal.atomic = async (name:string,data:string) => { if (name === PROTECTION && ++protections === 2) throw new Error('SECRET'); await atomic(name,data); };
  await assert.rejects(repo.bootstrap([address()]),messagesSafe);
  const reopened = new HistoryRepository(directory); await reopened.load();
  assert.equal(reopened.snapshot.entries.length,1); assert.equal(reopened.snapshot.bootstrapComplete,true);
  await reopened.bootstrap([address('douyu')]); assert.equal(reopened.snapshot.entries.length,1);
});

test('failed protection write never commits the requested deletion and queue can recover',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory), entry = await repo.record(address());
  const original = await readFile(join(directory,PRIMARY),'utf8'), internal = repo as any, atomic = internal.atomic.bind(repo);
  internal.atomic = async (name:string,data:string) => { if (name === PROTECTION) throw new Error('SECRET'); await atomic(name,data); };
  await assert.rejects(repo.remove(entry.id),messagesSafe);
  assert.equal(await readFile(join(directory,PRIMARY),'utf8'),original); assert.equal(repo.snapshot.entries[0].id,entry.id);
  internal.atomic = atomic; await repo.remove(entry.id); await repo.flush(); assert.deepEqual(repo.snapshot.entries,[]);
});

test('future main, backup or deletion schemas block all writes and remain byte-for-byte intact',async t => {
  for (const name of [PRIMARY,BACKUP,PROTECTION]) {
    const directory = await isolated(t), repo = new HistoryRepository(directory); await repo.bootstrap([address()]);
    const before = await readFile(join(directory,PRIMARY),'utf8');
    const future = JSON.stringify({...await raw(directory,name),schemaVersion:2,token:'SECRET'}); await writeFile(join(directory,name),future);
    await assert.rejects(new HistoryRepository(directory).load(),messagesSafe);
    await assert.rejects(repo.clear(),messagesSafe);
    await assert.rejects(repo.record(address('douyu')),messagesSafe);
    assert.equal(await readFile(join(directory,name),'utf8'),future);
    if (name !== PRIMARY) assert.equal(await readFile(join(directory,PRIMARY),'utf8'),before);
  }
});

test('missing, corrupt or malformed deletion protection fails closed without rewriting snapshots',async t => {
  for (const broken of [undefined,'{SECRET','null',JSON.stringify({schemaVersion:1,bootstrapComplete:true,deletedEntryIds:['SECRET']})]) {
    const directory = await isolated(t), repo = new HistoryRepository(directory); await repo.bootstrap([address()]);
    const original = await readFile(join(directory,PRIMARY),'utf8');
    if (broken === undefined) await rm(join(directory,PROTECTION)); else await writeFile(join(directory,PROTECTION),broken);
    await assert.rejects(new HistoryRepository(directory).load(),messagesSafe); await assert.rejects(repo.clear(),messagesSafe);
    assert.equal(await readFile(join(directory,PRIMARY),'utf8'),original);
  }
});

test('invalid primary fields recover a clean backup and injected fields never enter public state',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory); await repo.bootstrap([address()]);
  const dirty = await raw(directory); dirty.Cookie = 'SECRET'; dirty.entries[0].token = 'SECRET'; dirty.entries[0].title = 'SECRET';
  await writeFile(join(directory,PRIMARY),JSON.stringify(dirty));
  const reopened = new HistoryRepository(directory), result = await reopened.load(); assert.ok(!JSON.stringify(result).includes('SECRET'));
  dirty.entries[0].platformRoomId = '../SECRET'; await writeFile(join(directory,PRIMARY),JSON.stringify(dirty));
  const restored = await new HistoryRepository(directory).load(); assert.equal(restored.snapshot.entries[0].platformRoomId,'100');
  assert.ok(!JSON.stringify(restored).includes('SECRET')); assert.ok(!(await readFile(join(directory,PRIMARY),'utf8')).includes('SECRET'));
});

test('oversized persisted files fail explicitly without truncation, deletion or fallback',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory); await repo.bootstrap([address()]);
  const oversized = ' '.repeat(8 * 1024 * 1024 + 1); await writeFile(join(directory,PRIMARY),oversized);
  await assert.rejects(new HistoryRepository(directory).load(),/too large/); await assert.rejects(repo.clear(),/too large/);
  assert.equal((await readFile(join(directory,PRIMARY))).length,oversized.length);
});

test('oversized backfill is rejected atomically with no automatic eviction; a later valid mutation succeeds',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory), entry = await repo.record(address());
  const original = await readFile(join(directory,PRIMARY),'utf8');
  const seeds = Array.from({length:40000},(_,i) => address('huya',`room_${i}_${'a'.repeat(100)}`));
  await assert.rejects(repo.bootstrap(seeds),/too large/);
  assert.equal(await readFile(join(directory,PRIMARY),'utf8'),original); assert.deepEqual(repo.snapshot.entries.map(item => item.id),[entry.id]);
  assert.equal(repo.snapshot.bootstrapComplete,false); await repo.bootstrap([]); await repo.flush();
  assert.equal(repo.snapshot.entries[0].id,entry.id);
});

test('real atomic rename failure removes temporary files and reports no native paths',async t => {
  const directory = await isolated(t), repo = new HistoryRepository(directory); await repo.load();
  await mkdir(join(directory,PROTECTION));
  // Bypass the earlier read error solely to reach the actual rename boundary.
  const internal = repo as any, readProtection = internal.readProtection.bind(repo); internal.readProtection = async () => undefined;
  await assert.rejects(repo.record(address()),messagesSafe);
  assert.ok(!(await readdir(directory)).some(name => name.endsWith('.tmp')));
  assert.ok(!(await readdir(directory)).includes(PRIMARY));
  internal.readProtection = readProtection; await rm(join(directory,PROTECTION),{recursive:true});
  await repo.record(address()); await repo.flush(); assert.equal(repo.snapshot.entries.length,1);
});
