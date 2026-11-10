import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeRoomUrl } from '../../platforms/shared/urls.ts';
import { historyKey } from '../../shared/history-contracts.ts';
import type { HistoryAddress, RoomHistoryEntry, RoomHistoryLoadResult, RoomHistorySnapshot, RoomHistoryStore } from '../../shared/history-contracts.ts';

// Limits reject the operation; history and deletion identities are never evicted.
const MAX_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIMARY = 'history.json', BACKUP = 'history.backup.json', PROTECTION = 'history.tombstones.json';
class HistoryError extends Error {}
class UnsupportedSchema extends HistoryError { constructor() { super('Unsupported history schema.'); } }
function invalid(): never { throw new HistoryError('Invalid history configuration.'); }
function safeError(error:unknown):HistoryError { return error instanceof HistoryError ? error : new HistoryError('History operation failed.'); }
function object(input:unknown):Record<string,unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  return input as Record<string,unknown>;
}
function entryId(input:unknown):string {
  if (typeof input !== 'string' || !UUID.test(input)) return invalid();
  return input.toLowerCase();
}
function nickname(input:unknown):string {
  if (typeof input !== 'string' || !input.trim() || input.length > 256 || /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(input)) return invalid();
  return input.trim();
}
/** Only a normalized identity is accepted, never an arbitrary navigable URL. */
export function validateHistoryAddress(input:unknown):HistoryAddress {
  try {
    const value = object(input);
    if (typeof value.canonicalUrl !== 'string' || value.canonicalUrl.length > 256) return invalid();
    const address = normalizeRoomUrl(value.canonicalUrl);
    if (value.platform !== address.platform || value.platformRoomId !== address.platformRoomId || value.canonicalUrl !== address.canonicalUrl) return invalid();
    return address;
  } catch { return invalid(); }
}
/** Deep, whitelist-only copy; unknown fields cannot enter snapshots or writes. */
export function validateHistorySnapshot(input:unknown):RoomHistorySnapshot {
  try {
    const value = object(input);
    if (value.schemaVersion !== 1) throw new UnsupportedSchema();
    if (typeof value.bootstrapComplete !== 'boolean' || !Array.isArray(value.entries)) return invalid();
    const ids = new Set<string>(), keys = new Set<string>();
    const entries = value.entries.map((raw):RoomHistoryEntry => {
      const item = object(raw), address = validateHistoryAddress(item), id = entryId(item.id);
      const lastAddedAt = item.lastAddedAt;
      if (lastAddedAt !== null && (typeof lastAddedAt !== 'number' || !Number.isSafeInteger(lastAddedAt) || lastAddedAt < 0)) return invalid();
      const key = historyKey(address);
      if (ids.has(id) || keys.has(key)) return invalid();
      ids.add(id); keys.add(key);
      const entry:RoomHistoryEntry = {id,...address,lastAddedAt};
      if (item.nickname !== undefined) entry.nickname = nickname(item.nickname);
      return entry;
    });
    const result:RoomHistorySnapshot={schemaVersion:1,bootstrapComplete:value.bootstrapComplete,entries};
    if(value.pendingBackfill!==undefined){if(!Array.isArray(value.pendingBackfill))return invalid();const pending=value.pendingBackfill.map(validateHistoryAddress);if(new Set(pending.map(historyKey)).size!==pending.length)return invalid();if(pending.length&&!value.bootstrapComplete)result.pendingBackfill=pending;}
    return result;
  } catch (error) {
    if (error instanceof UnsupportedSchema) throw error;
    return invalid();
  }
}
function empty():RoomHistorySnapshot { return {schemaVersion:1,bootstrapComplete:false,entries:[]}; }
function encode(value:unknown):string {
  const data = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(data) > MAX_BYTES) throw new HistoryError('History configuration is too large.');
  return data;
}
type Protection = {schemaVersion:1;bootstrapComplete:boolean;deletedEntryIds:string[];deletedBackfillAddresses?:HistoryAddress[]};
type Candidate = {kind:'missing'} | {kind:'invalid'} | {kind:'valid';snapshot:RoomHistorySnapshot};
function blankProtection():Protection { return {schemaVersion:1,bootstrapComplete:false,deletedEntryIds:[]}; }
function protectedSnapshot(snapshot:RoomHistorySnapshot, protection:Protection):RoomHistorySnapshot {
  const clean = validateHistorySnapshot(snapshot), deleted = new Set(protection.deletedEntryIds);
  clean.entries = clean.entries.filter(entry => !deleted.has(entry.id));
  clean.bootstrapComplete ||= protection.bootstrapComplete;
  if(clean.bootstrapComplete)delete clean.pendingBackfill;
  return clean;
}

/** One main-process owner per trusted Config/History directory. No multi-process locking. */
export class HistoryRepository implements RoomHistoryStore {
  private current = empty();
  private protection = blankProtection();
  private loaded = false;
  private queue:Promise<void> = Promise.resolve();
  private lastFailure:HistoryError | undefined;
  private readonly directory:string;
  constructor(directory:string) { this.directory = directory; }
  get snapshot():RoomHistorySnapshot { return validateHistorySnapshot(this.current); }
  private serialized<T>(operation:()=>Promise<T>):Promise<T> {
    const next = this.queue.then(operation).then(value => { this.lastFailure = undefined; return value; }, error => {
      const safe = safeError(error); this.lastFailure = safe; throw safe;
    });
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }
  private async read(name:string):Promise<Buffer | undefined> {
    let handle;
    try { handle = await open(join(this.directory,name),'r'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined;
      throw new HistoryError('History read failed.');
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new HistoryError('History read failed.');
      if (stat.size > MAX_BYTES) throw new HistoryError('History configuration is too large.');
      // Bound allocation even if a file grows after stat().
      const raw = Buffer.alloc(Math.min(stat.size + 1,MAX_BYTES + 1));
      let bytesRead = 0;
      while (bytesRead < raw.length) {
        const read = await handle.read(raw,bytesRead,raw.length - bytesRead,bytesRead);
        if (!read.bytesRead) break;
        bytesRead += read.bytesRead;
      }
      if (bytesRead > MAX_BYTES || bytesRead > stat.size) throw new HistoryError('History changed while reading.');
      return raw.subarray(0,bytesRead);
    } catch (error) {
      if (error instanceof HistoryError) throw error;
      throw new HistoryError('History read failed.');
    } finally { await handle.close().catch(() => undefined); }
  }
  private async candidate(name:string):Promise<Candidate> {
    const raw = await this.read(name);
    if (raw === undefined) return {kind:'missing'};
    try { return {kind:'valid',snapshot:validateHistorySnapshot(JSON.parse(raw.toString('utf8')))}; }
    catch (error) {
      if (error instanceof UnsupportedSchema) throw error;
      return {kind:'invalid'};
    }
  }
  private async readProtection():Promise<Protection | undefined> {
    const raw = await this.read(PROTECTION);
    if (raw === undefined) return undefined;
    try {
      const value = object(JSON.parse(raw.toString('utf8')));
      if (value.schemaVersion !== 1) throw new HistoryError('Unsupported history deletion protection schema.');
      if (typeof value.bootstrapComplete !== 'boolean' || !Array.isArray(value.deletedEntryIds)) return invalid();
      const ids = value.deletedEntryIds.map(entryId);
      if (new Set(ids).size !== ids.length) return invalid();
      const result:Protection={schemaVersion:1,bootstrapComplete:value.bootstrapComplete,deletedEntryIds:ids.sort()};
      if(value.deletedBackfillAddresses!==undefined){
        if(!Array.isArray(value.deletedBackfillAddresses))return invalid();
        const addresses=value.deletedBackfillAddresses.map(validateHistoryAddress);
        if(new Set(addresses.map(historyKey)).size!==addresses.length)return invalid();
        if(addresses.length)result.deletedBackfillAddresses=addresses;
      }
      return result;
    } catch (error) {
      if (error instanceof HistoryError && error.message === 'Unsupported history deletion protection schema.') throw error;
      throw new HistoryError('History deletion protection is invalid.');
    }
  }
  private async atomic(name:string,data:string):Promise<void> {
    const temporary = join(this.directory,`.history-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary,'wx',0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary,join(this.directory,name));
    } catch { throw new HistoryError('History write failed.'); }
    finally { await rm(temporary,{force:true}).catch(() => undefined); }
  }
  private async files():Promise<{primary:Candidate;backup:Candidate;protection:Protection | undefined}> {
    // Inspect both schema versions before any mutation, even with a valid primary.
    const primary = await this.candidate(PRIMARY), backup = await this.candidate(BACKUP), protection = await this.readProtection();
    // All history writers create protection first. Missing protection alongside
    // snapshots is data loss, not an invitation to revive an older backup.
    if (!protection && (primary.kind !== 'missing' || backup.kind !== 'missing')) throw new HistoryError('History deletion protection is unavailable.');
    return {primary,backup,protection};
  }
  private async loadInternal():Promise<RoomHistoryLoadResult> {
    const {primary,backup,protection} = await this.files(), guard = protection ?? blankProtection(), warnings:string[] = [];
    let source = primary;
    // Bootstrap stages its complete snapshot in backup before committing the
    // once-only marker. Recover that staged snapshot if interrupted afterward.
    if (primary.kind === 'valid' && !primary.snapshot.bootstrapComplete && guard.bootstrapComplete && backup.kind === 'valid' && backup.snapshot.bootstrapComplete) source = backup;
    else if (primary.kind !== 'valid') source = backup;
    if(source.kind!=='valid'&&(primary.kind==='invalid'||backup.kind==='invalid'||guard.bootstrapComplete))throw new HistoryError('History is unavailable; no valid snapshot exists.');
    if (primary.kind === 'invalid') warnings.push('History primary configuration is invalid.');
    if (backup.kind === 'invalid') warnings.push('History backup configuration is invalid.');
    const snapshot = protectedSnapshot(source.kind === 'valid' ? source.snapshot : empty(),guard);
    if (source.kind === 'valid' && source !== primary) {
      await this.atomic(PRIMARY,encode(snapshot));
      warnings.push('History recovered from the last valid backup.');
    }
    this.current = snapshot; this.protection = guard; this.loaded = true;
    return {snapshot:this.snapshot,warnings};
  }
  load():Promise<RoomHistoryLoadResult> { return this.serialized(() => this.loadInternal()); }
  private async ensureLoaded():Promise<void> { if (!this.loaded) await this.loadInternal(); }
  private async commit(snapshot:RoomHistorySnapshot,deletedIds:readonly string[] = [],bootstrap = false,deletedAddresses:readonly HistoryAddress[]=[]):Promise<void> {
    const next = validateHistorySnapshot(snapshot), data = encode(next);
    const {primary,protection} = await this.files();
    const previous = protection ?? this.protection;
    const guard:Protection = {schemaVersion:1,bootstrapComplete:previous.bootstrapComplete || next.bootstrapComplete,
      deletedEntryIds:[...new Set([...previous.deletedEntryIds,...deletedIds])].sort()};
    const excluded=[...new Map([...(previous.deletedBackfillAddresses??[]),...deletedAddresses].map(address=>[historyKey(address),validateHistoryAddress(address)])).values()];
    if(excluded.length)guard.deletedBackfillAddresses=excluded;
    const protectionData = encode(guard);
    const deleted = new Set(guard.deletedEntryIds);
    if (next.entries.some(entry => deleted.has(entry.id))) throw new HistoryError('Deleted history identity cannot be reused.');
    await mkdir(this.directory,{recursive:true});
    if (bootstrap) {
      if (!protection) await this.atomic(PROTECTION,encode(previous));
      // Keep the full backfill durable before its once-only marker. Its clone
      // already contains all earlier real additions in their existing MRU order.
      await this.atomic(BACKUP,data);
    }
    if (!protection || encode(previous) !== protectionData) {
      await this.atomic(PROTECTION,protectionData);
      this.protection = guard;
      this.current = bootstrap ? validateHistorySnapshot(next) : protectedSnapshot(this.current,guard);
    }
    // Deletions commit first and never rotate backward. Even an interrupted
    // primary write cannot make an old backup resurrect a removed UUID.
    if (!bootstrap && primary.kind === 'valid') await this.atomic(BACKUP,encode(protectedSnapshot(primary.snapshot,guard)));
    // Otherwise preserve the only valid backup when primary is broken/missing.
    await this.atomic(PRIMARY,data);
    this.current = next; this.protection = guard;
  }
  bootstrap(addresses:readonly HistoryAddress[],options?:{pending?:readonly HistoryAddress[]}):Promise<void> {
    let captured:HistoryAddress[],pending:HistoryAddress[];
    try { if (!Array.isArray(addresses)||options?.pending!==undefined&&!Array.isArray(options.pending)) return Promise.reject(new HistoryError('Invalid history configuration.')); captured = addresses.map(validateHistoryAddress);pending=(options?.pending??[]).map(validateHistoryAddress); }
    catch (error) { return Promise.reject(safeError(error)); }
    return this.serialized(async () => {
      await this.ensureLoaded();
      if (this.current.bootstrapComplete) return;
      const next = this.snapshot, keys = new Set([...next.entries.map(historyKey),...(this.protection.deletedBackfillAddresses??[]).map(historyKey)]);
      const seeds = new Map<string,HistoryAddress>();
      for (const address of captured) if (!keys.has(historyKey(address))) seeds.set(historyKey(address),address);
      const added = [...seeds.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([,address]):RoomHistoryEntry => ({id:randomUUID(),...address,lastAddedAt:null}));
      next.entries.push(...added); next.bootstrapComplete = pending.length===0;
      if(pending.length)next.pendingBackfill=[...new Map(pending.map(address=>[historyKey(address),address])).values()];else delete next.pendingBackfill;
      await this.commit(next,[],true);
    });
  }
  record(address:HistoryAddress):Promise<RoomHistoryEntry> {
    let captured:HistoryAddress;
    try { captured = validateHistoryAddress(address); } catch (error) { return Promise.reject(safeError(error)); }
    return this.serialized(async () => {
      await this.ensureLoaded();
      const next = this.snapshot, key = historyKey(captured), existing = next.entries.find(entry => historyKey(entry) === key);
      const entry:RoomHistoryEntry = {id:existing?.id ?? randomUUID(),...captured,lastAddedAt:Date.now()};
      if (existing?.nickname !== undefined) entry.nickname = existing.nickname;
      next.entries = [entry,...next.entries.filter(item => historyKey(item) !== key)];
      await this.commit(next);
      return {...entry};
    });
  }
  updateNickname(id:string,value:string):Promise<boolean> {
    let capturedId:string, capturedName:string;
    try { capturedId = entryId(id); capturedName = nickname(value); } catch { return Promise.reject(new HistoryError('Invalid history configuration.')); }
    return this.serialized(async () => {
      await this.ensureLoaded();
      const next = this.snapshot, entry = next.entries.find(item => item.id === capturedId);
      if (!entry) return false;
      if (entry.nickname === capturedName) return true;
      entry.nickname = capturedName; await this.commit(next); return true;
    });
  }
  remove(id:string):Promise<void> {
    let capturedId:string;
    try { capturedId = entryId(id); } catch { return Promise.reject(new HistoryError('Invalid history configuration.')); }
    return this.serialized(async () => {
      await this.ensureLoaded();
      const next = this.snapshot;
      const removed=next.entries.find(entry=>entry.id===capturedId);if(!removed)return;
      next.entries = next.entries.filter(entry => entry.id !== capturedId);
      // Exclude only this canonical room from legacy backfill, including aliases
      // whose identity resolves later. Other pending rooms must still be retried.
      await this.commit(next,[capturedId],false,[removed]);
    });
  }
  clear():Promise<void> {
    return this.serialized(async () => {
      await this.ensureLoaded();
      const next:RoomHistorySnapshot = {schemaVersion:1,bootstrapComplete:true,entries:[]};
      await this.commit(next,this.current.entries.map(entry => entry.id));
    });
  }
  async flush():Promise<void> { await this.queue; if (this.lastFailure) throw this.lastFailure; }
}
