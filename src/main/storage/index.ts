import { open, readFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkspaceSnapshot, WorkspaceLoadResult, RoomConfig, NormalizedRect } from '../../shared/contracts.ts';

const MAX_BYTES = 2 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class UnsupportedSchema extends Error { constructor() { super('Unsupported workspace schema.'); } }
function invalid(): never { throw new Error('Invalid workspace configuration.'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return invalid();
  return value;
}
function id(value: unknown): string { const result = text(value, 36); if (!uuid.test(result)) return invalid(); return result; }
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return invalid();
  return value;
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function base(value: unknown): 'equal' | 'focus' { if (value !== 'equal' && value !== 'focus') return invalid(); return value; }
function rect(value: unknown): NormalizedRect {
  const r = object(value);
  const z = number(r.z, 0, Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(z)) return invalid();
  return { x:number(r.x, 0, 1), y:number(r.y, 0, 1), width:number(r.width, Number.MIN_VALUE, 1), height:number(r.height, Number.MIN_VALUE, 1), z };
}
function room(value: unknown): RoomConfig {
  const r = object(value), chat = object(r.chat), audio = object(r.audio);
  if (r.platform !== 'huya' && r.platform !== 'douyu' && r.platform !== 'bilibili') return invalid();
  const platformRoomId = text(r.platformRoomId, 128);
  const pattern = r.platform === 'huya' ? /^[A-Za-z0-9_-]+$/ : /^[1-9][0-9]*$/;
  if (!pattern.test(platformRoomId)) return invalid();
  const host = {huya:'www.huya.com',douyu:'www.douyu.com',bilibili:'live.bilibili.com'}[r.platform];
  // Exact canonical spelling also rejects encoded paths, explicit :443, query,
  // fragments, userinfo, path traversal and URL-parser normalization surprises.
  const canonicalUrl = `https://${host}/${platformRoomId}`;
  if (r.canonicalUrl !== canonicalUrl) return invalid();
  const result: RoomConfig = {
    id:id(r.id), platform:r.platform, platformRoomId, canonicalUrl,
    chat:{visible:boolean(chat.visible),preferredWidthDip:number(chat.preferredWidthDip, 0, 16384)},
    audio:{allowed:boolean(audio.allowed)},
  };
  if (r.label !== undefined) result.label = text(r.label);
  if (r.preferredQuality !== undefined) result.preferredQuality = text(r.preferredQuality, 128);
  if (audio.preferredVolume !== undefined) result.audio.preferredVolume = number(audio.preferredVolume, 0, 1);
  return result;
}

/** Construct a fresh whitelist-only snapshot. No page state or credentials survive. */
export function validateWorkspace(input: unknown): WorkspaceSnapshot {
  try {
    const w = object(input);
    if (w.schemaVersion !== 1) throw new UnsupportedSchema();
    if (!Array.isArray(w.rooms) || w.rooms.length > 1024) return invalid();
    const rooms = w.rooms.map(room), ids = new Set(rooms.map(r => r.id));
    if (ids.size !== rooms.length || new Set(rooms.map(r => r.canonicalUrl)).size !== rooms.length) return invalid();
    function order(value: unknown): string[] {
      if (!Array.isArray(value) || value.length !== ids.size) return invalid();
      const result = value.map(v => id(v));
      if (new Set(result).size !== ids.size || result.some(v => !ids.has(v))) return invalid();
      return result;
    }
    const l = object(w.layout), equal = object(l.equal), focus = object(l.focus), free = object(l.free);
    const rawRects = object(free.rects), rects:Record<string, NormalizedRect> = {};
    for (const [key, value] of Object.entries(rawRects)) {
      if (!ids.has(key)) return invalid();
      rects[key] = rect(value);
    }
    if (l.editing !== 'auto' && l.editing !== 'free') return invalid();
    if (l.editing === 'free' && Object.keys(rects).length !== ids.size) return invalid();
    const snapshot:WorkspaceSnapshot = {
      schemaVersion:1, id:id(w.id), name:text(w.name), rooms, stableOrder:order(w.stableOrder),
      layout:{base:base(l.base),editing:l.editing,
        equal:{variant:text(equal.variant, 64),order:order(equal.order)},
        focus:{variant:text(focus.variant, 64),order:order(focus.order)},
        free:{rects,from:base(free.from)}},
    };
    if (l.primaryRoomId !== undefined) {
      const primary = id(l.primaryRoomId);
      if (!ids.has(primary)) return invalid();
      snapshot.layout.primaryRoomId = primary;
    }
    if (focus.primaryShare !== undefined) snapshot.layout.focus.primaryShare = number(focus.primaryShare, 0.05, 0.95);
    return snapshot;
  } catch (error) {
    if (error instanceof UnsupportedSchema) throw error;
    // Getters/proxies and native exceptions must not echo input data either.
    return invalid();
  }
}

type Candidate = {kind:'missing'} | {kind:'invalid';raw:Buffer} | {kind:'valid';snapshot:WorkspaceSnapshot};
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }

function withoutDeleted(snapshot:WorkspaceSnapshot, deleted:Set<string>):WorkspaceSnapshot {
  const keep = (roomId:string) => !deleted.has(roomId.toLowerCase());
  const originalOrder = snapshot.stableOrder;
  const primary = snapshot.layout.primaryRoomId;
  snapshot.rooms = snapshot.rooms.filter(room => keep(room.id));
  snapshot.stableOrder = originalOrder.filter(keep);
  snapshot.layout.equal.order = snapshot.layout.equal.order.filter(keep);
  snapshot.layout.focus.order = snapshot.layout.focus.order.filter(keep);
  snapshot.layout.free.rects = Object.fromEntries(Object.entries(snapshot.layout.free.rects).filter(([roomId]) => keep(roomId)));
  if (primary && !keep(primary)) {
    const index = originalOrder.indexOf(primary);
    const next = [...originalOrder.slice(index + 1),...originalOrder.slice(0,index)].find(keep);
    if (next) snapshot.layout.primaryRoomId = next;
    else delete snapshot.layout.primaryRoomId;
  }
  return validateWorkspace(snapshot);
}

/** directory is a trusted application-selected workspace directory, never a page-supplied path.
 * One repository owns a directory. Multi-process/multiple-instance locking is not provided.
 */
export class WorkspaceRepository {
  private readonly directory: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(directory: string) { this.directory = directory; }
  private serialized<T>(operation:()=>Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async candidate(name:string): Promise<Candidate> {
    let raw:Buffer;
    try { raw = await readFile(join(this.directory, name)); }
    catch (error) { if (missing(error)) return {kind:'missing'}; throw new Error('Workspace read failed.'); }
    try {
      if (raw.length > MAX_BYTES) return {kind:'invalid',raw};
      return {kind:'valid',snapshot:validateWorkspace(JSON.parse(raw.toString('utf8')))};
    } catch (error) {
      if (error instanceof UnsupportedSchema) throw error;
      return {kind:'invalid',raw};
    }
  }
  private async atomic(name:string, data:string | Buffer): Promise<void> {
    const temporary = join(this.directory, `.workspace-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      // Same-directory rename replaces the destination without first deleting it.
      await rename(temporary, join(this.directory, name));
    } catch { throw new Error('Workspace write failed.'); }
    finally { await rm(temporary, {force:true}).catch(() => undefined); }
  }
  private async preserve(raw:Buffer): Promise<void> {
    await this.atomic(`workspace.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`,raw);
  }
  private async tombstones():Promise<Set<string>> {
    let raw:Buffer;
    try { raw = await readFile(join(this.directory,'workspace.tombstones.json')); }
    catch (error) {
      if (missing(error)) return new Set(); // Compatibility with pre-tombstone directories.
      throw new Error('Workspace deletion history is unavailable.');
    }
    try {
      if (raw.length > MAX_BYTES) throw new Error();
      const value = object(JSON.parse(raw.toString('utf8')));
      if (value.schemaVersion !== 1) throw new UnsupportedSchema();
      if (!Array.isArray(value.deletedRoomIds)) throw new Error();
      const ids = value.deletedRoomIds.map(value => id(value).toLowerCase());
      if (new Set(ids).size !== ids.length) throw new Error();
      return new Set(ids);
    } catch (error) {
      if (error instanceof UnsupportedSchema) throw new Error('Unsupported workspace deletion history schema.');
      throw new Error('Workspace deletion history is invalid.');
    }
  }
  private async saveTombstones(deleted:Set<string>):Promise<void> {
    const data = JSON.stringify({schemaVersion:1,deletedRoomIds:[...deleted].sort()},null,2) + '\n';
    if (Buffer.byteLength(data) > MAX_BYTES) throw new Error('Workspace deletion history is too large.');
    // Never rotate deletion history back to an earlier set: corruption fails closed.
    await this.atomic('workspace.tombstones.json',data);
  }
  save(snapshot:WorkspaceSnapshot): Promise<void> {
    // Capture now, before queued writes: caller mutation cannot change a pending save.
    let clean:WorkspaceSnapshot;
    try { clean = validateWorkspace(snapshot); } catch(error) { return Promise.reject(error); }
    const serialized = JSON.stringify(clean, null, 2) + '\n';
    if (Buffer.byteLength(serialized) > MAX_BYTES) return Promise.reject(new Error('Workspace configuration is too large.'));
    return this.serialized(async () => {
      await mkdir(this.directory, {recursive:true});
      const primary = await this.candidate('workspace.json');
      // A newer backup may be the only surviving newer-version workspace.
      // Refuse to replace it even when the primary still uses our older schema.
      const backup = await this.candidate('workspace.backup.json');
      const deleted = await this.tombstones();
      if (clean.rooms.some(room => deleted.has(room.id.toLowerCase()))) throw new Error('Deleted room identity cannot be reused.');
      const remaining = new Set(clean.rooms.map(room => room.id.toLowerCase()));
      const previousSize = deleted.size;
      const previous = primary.kind === 'valid' ? primary : backup;
      if (previous.kind === 'valid') {
        for (const room of previous.snapshot.rooms) if (!remaining.has(room.id.toLowerCase())) deleted.add(room.id.toLowerCase());
      }
      // Deletion commits first. If later backup/primary writing fails, load still
      // filters the old snapshot; an interrupted save cannot resurrect this UUID.
      if (deleted.size !== previousSize) await this.saveTombstones(deleted);
      if (primary.kind === 'valid') {
        await this.atomic('workspace.backup.json', JSON.stringify(primary.snapshot, null, 2) + '\n');
      } else {
        // Do not replace an existing valid backup with broken/missing primary data.
        if (primary.kind === 'invalid') await this.preserve(primary.raw);
      }
      await this.atomic('workspace.json',serialized);
    });
  }
  load(): Promise<WorkspaceLoadResult> {
    return this.serialized(async () => {
      const deleted = await this.tombstones();
      const primary = await this.candidate('workspace.json');
      if (primary.kind === 'valid') return {snapshot:withoutDeleted(primary.snapshot,deleted),source:'primary',warnings:[]};
      const backup = await this.candidate('workspace.backup.json');
      const warnings:string[] = [];
      if (primary.kind === 'invalid') { await this.preserve(primary.raw); warnings.push('Invalid primary workspace preserved locally.'); }
      if (backup.kind === 'valid') {
        const snapshot = withoutDeleted(backup.snapshot,deleted);
        // A backup can contain stale audio intent. Persist safe recovery before
        // returning, so an exit without a later save cannot re-enable it.
        for (const room of snapshot.rooms) room.audio.allowed = false;
        await this.atomic('workspace.json',JSON.stringify(snapshot, null, 2) + '\n');
        warnings.push('Workspace recovered from the last valid backup.');
        return {snapshot,source:'backup',warnings};
      }
      if (backup.kind === 'invalid') warnings.push('Workspace backup is invalid.');
      return {source:'empty',warnings};
    });
  }
  /** History backfill only: no active-workspace change, repair write, or audio mutation. */
  inspectForHistory():Promise<WorkspaceLoadResult> {
    return this.serialized(async()=>{
      const deleted=await this.tombstones(),primary=await this.candidate('workspace.json');
      if(primary.kind==='valid')return{snapshot:withoutDeleted(primary.snapshot,deleted),source:'primary',warnings:[]};
      const backup=await this.candidate('workspace.backup.json');
      if(backup.kind==='valid')return{snapshot:withoutDeleted(backup.snapshot,deleted),source:'backup',warnings:['History source uses a valid workspace backup.']};
      return{source:'empty',warnings:['History source workspace is unavailable.']};
    });
  }
}
