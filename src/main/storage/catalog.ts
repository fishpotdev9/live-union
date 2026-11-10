import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { WorkspaceRepository, validateWorkspace } from './index.ts';
import type { WorkspaceSnapshot, WorkspaceLoadResult } from '../../shared/contracts.ts';
import type { WorkspaceEntry } from '../../shared/app-contracts.ts';
import type { HistoryAddress } from '../../shared/history-contracts.ts';

interface Manifest { schemaVersion:1; activeId?:string; entries:WorkspaceEntry[] }
type Candidate = {kind:'missing'} | {kind:'invalid';raw:Buffer} | {kind:'valid';manifest:Manifest};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class CatalogError extends Error {}
function fail(message='Invalid workspace catalog.'):never { throw new CatalogError(message); }
function validId(value:unknown):string { if(typeof value!=='string'||!UUID.test(value))return fail(); return value; }
function validName(value:unknown):string {
  if(typeof value!=='string'||!value.trim()||value.length>256||/[\x00-\x1f\x7f]/.test(value))return fail('Invalid workspace name.');
  return value;
}
function record(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))return fail();
  return value as Record<string,unknown>;
}
function validateManifest(input:unknown):Manifest {
  const value=record(input);
  if(value.schemaVersion!==1)return fail('Unsupported workspace catalog schema.');
  if(!Array.isArray(value.entries)||value.entries.length>1024)return fail();
  const entries=value.entries.map(input=>{const entry=record(input);return {id:validId(entry.id),name:validName(entry.name)};});
  // UUID case variants must not name two entries in the same Windows directory.
  if(new Set(entries.map(entry=>entry.id.toLowerCase())).size!==entries.length)return fail();
  const result:Manifest={schemaVersion:1,entries};
  if(value.activeId!==undefined) {
    result.activeId=validId(value.activeId);
    if(!entries.some(entry=>entry.id===result.activeId))return fail();
  } else if(entries.length)return fail();
  return result;
}

/** One catalog instance owns a trusted app-data directory; no session discovery or deletion. */
export class WorkspaceCatalog {
  private readonly baseDirectory:string;
  private queue:Promise<unknown>=Promise.resolve();
  private readonly repositories=new Map<string,WorkspaceRepository>();
  constructor(baseDirectory:string){this.baseDirectory=baseDirectory;}
  private serialized<T>(operation:()=>Promise<T>):Promise<T> {
    const next=this.queue.then(operation).catch(error=>{
      if(error instanceof CatalogError)throw error;
      throw new CatalogError('Workspace catalog operation failed.');
    });
    this.queue=next.catch(()=>undefined);
    return next;
  }
  private repository(id:string):WorkspaceRepository {
    let repository=this.repositories.get(id);
    if(!repository){repository=new WorkspaceRepository(join(this.baseDirectory,'workspaces',id));this.repositories.set(id,repository);}
    return repository;
  }
  private async candidate(filename:string):Promise<Candidate> {
    let raw:Buffer;
    try{raw=await readFile(join(this.baseDirectory,filename));}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {kind:'missing'}; throw error;}
    if(raw.length>1024*1024)return {kind:'invalid',raw};
    let input:unknown;
    try{input=JSON.parse(raw.toString('utf8'));}catch{return {kind:'invalid',raw};}
    // Unknown versions are incompatible, not corrupt; never recover over them.
    const object=typeof input==='object'&&input!==null&&!Array.isArray(input)?input as Record<string,unknown>:undefined;
    if(object&&object.schemaVersion!==undefined&&object.schemaVersion!==1)fail('Unsupported workspace catalog schema.');
    try{return {kind:'valid',manifest:validateManifest(input)};}catch{return {kind:'invalid',raw};}
  }
  private async atomic(filename:string,data:string|Buffer):Promise<void> {
    const temporary=join(this.baseDirectory,`.catalog-${randomUUID()}.tmp`);
    try{
      const handle=await open(temporary,'wx',0o600);
      try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}
      await rename(temporary,join(this.baseDirectory,filename));
    }finally{await rm(temporary,{force:true}).catch(()=>undefined);}
  }
  private encode(manifest:Manifest):string {return JSON.stringify(manifest,null,2)+'\n';}
  private async preserve(raw:Buffer):Promise<void> {
    await this.atomic(`catalog.corrupt-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.json`,raw);
  }
  private async readManifest():Promise<{manifest:Manifest;warnings:string[]}> {
    const primary=await this.candidate('catalog.json');
    if(primary.kind==='valid')return {manifest:primary.manifest,warnings:[]};
    const backup=await this.candidate('catalog.backup.json');
    if(primary.kind==='invalid')await this.preserve(primary.raw);
    if(backup.kind==='valid') {
      await this.atomic('catalog.json',this.encode(backup.manifest));
      return {manifest:backup.manifest,warnings:['Workspace catalog recovered from the last valid backup.']};
    }
    if(primary.kind==='missing'&&backup.kind==='missing')return {manifest:{schemaVersion:1,entries:[]},warnings:[]};
    return fail('Workspace catalog is unavailable; no valid backup exists.');
  }
  private async writeManifest(manifest:Manifest):Promise<void> {
    // Validate both before replacing anything: a future backup may be the sole newer snapshot.
    const primary=await this.candidate('catalog.json');
    await this.candidate('catalog.backup.json');
    await mkdir(this.baseDirectory,{recursive:true});
    if(primary.kind==='valid')await this.atomic('catalog.backup.json',this.encode(primary.manifest));
    else if(primary.kind==='invalid')await this.preserve(primary.raw);
    await this.atomic('catalog.json',this.encode(validateManifest(manifest)));
  }
  private async registeredLoad(manifest:Manifest,id:string):Promise<WorkspaceLoadResult> {
    if(!manifest.entries.some(entry=>entry.id===id))return fail('Workspace is not registered.');
    const result=await this.repository(id).load();
    if(!result.snapshot||result.source==='empty')return fail('Saved workspace is unavailable.');
    if(result.snapshot.id!==id)return fail('Saved workspace identity does not match its catalog entry.');
    return result;
  }
  list():Promise<WorkspaceEntry[]> {
    return this.serialized(async()=> (await this.readManifest()).manifest.entries);
  }
  /** Enumerate registered current/recoverable snapshots without opening or repairing them. */
  historySources():Promise<{rooms:HistoryAddress[];warnings:string[]}> {
    return this.serialized(async()=>{
      const primary=await this.candidate('catalog.json');
      const selected=primary.kind==='valid'?primary:await this.candidate('catalog.backup.json');
      if(selected.kind==='missing'&&primary.kind==='missing')return{rooms:[],warnings:[]};
      if(selected.kind!=='valid')return fail('History source catalog is unavailable.');
      const rooms:HistoryAddress[]=[],warnings:string[]=primary.kind==='valid'?[]:['部分历史来源使用了组合目录备份。'];
      for(const entry of selected.manifest.entries){
        try{
          const result=await this.repository(entry.id).inspectForHistory();
          if(!result.snapshot||result.snapshot.id!==entry.id){warnings.push('部分旧组合无法读取，未补入历史。');continue;}
          if(result.warnings.length)warnings.push('部分旧组合使用有效备份补入历史。');
          for(const room of result.snapshot.rooms)rooms.push({platform:room.platform,platformRoomId:room.platformRoomId,canonicalUrl:room.canonicalUrl});
        }catch{warnings.push('部分旧组合无法读取，未补入历史。');}
      }
      return{rooms,warnings:[...new Set(warnings)]};
    });
  }
  loadActive():Promise<WorkspaceLoadResult&{entries:WorkspaceEntry[]}> {
    return this.serialized(async()=>{
      const {manifest,warnings}=await this.readManifest();
      if(!manifest.activeId)return {source:'empty',entries:manifest.entries,warnings};
      const result=await this.registeredLoad(manifest,manifest.activeId);
      return {...result,entries:manifest.entries,warnings:[...warnings,...result.warnings]};
    });
  }
  open(id:string):Promise<WorkspaceLoadResult> {
    return this.serialized(async()=>{
      validId(id);
      const {manifest,warnings}=await this.readManifest();
      const result=await this.registeredLoad(manifest,id);
      await this.writeManifest({...manifest,activeId:id});
      return {...result,warnings:[...warnings,...result.warnings]};
    });
  }
  private async saveSnapshot(snapshot:WorkspaceSnapshot):Promise<void> {
    const {manifest}=await this.readManifest();
    // Refuse incompatible backup before committing even the workspace file.
    await this.candidate('catalog.backup.json');
    const entry=manifest.entries.find(entry=>entry.id.toLowerCase()===snapshot.id.toLowerCase());
    if(entry&&entry.id!==snapshot.id)return fail('Workspace identity case conflicts with its catalog entry.');
    const entries=manifest.entries.map(entry=>({...entry}));
    if(entry)entries[entries.findIndex(entry=>entry.id===snapshot.id)]={id:snapshot.id,name:snapshot.name};
    else entries.push({id:snapshot.id,name:snapshot.name});
    const next=validateManifest({schemaVersion:1,activeId:snapshot.id,entries});
    await this.repository(snapshot.id).save(snapshot);
    await this.writeManifest(next);
  }
  save(snapshot:WorkspaceSnapshot):Promise<void> {
    let clean:WorkspaceSnapshot;
    try{clean=validateWorkspace(snapshot);}catch{return Promise.reject(new CatalogError('Invalid workspace configuration.'));}
    return this.serialized(()=>this.saveSnapshot(clean));
  }
  saveAs(snapshot:WorkspaceSnapshot,name:string):Promise<WorkspaceSnapshot> {
    let clean:WorkspaceSnapshot;
    try{clean=validateWorkspace(snapshot);clean.name=validName(name);clean.id=randomUUID();}
    catch{return Promise.reject(new CatalogError('Invalid workspace configuration or name.'));}
    return this.serialized(async()=>{await this.saveSnapshot(clean);return clean;});
  }
}
