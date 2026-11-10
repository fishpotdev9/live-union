import { cp, lstat, mkdir, readdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { PLATFORM_DETAILS, PLATFORM_IDS } from '../../shared/platforms.ts';

/** Opt-in migration only from this app's G0 partitions, while G0 is stopped. No browser discovery. */
export async function importG0Sessions(userData:string):Promise<number>{
  const source=join(tmpdir(),'live-union-g0-profile','Partitions'),target=join(userData,'Partitions');
  let imported=0;
  async function absent(path:string):Promise<boolean>{try{await lstat(path);return false;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw error;}}
  async function regularTree(path:string):Promise<void>{
    const stat=await lstat(path);if(stat.isSymbolicLink())throw new Error('Session link refused');
    if(stat.isDirectory())for(const entry of await readdir(path))await regularTree(join(path,entry));
    else if(!stat.isFile())throw new Error('Session entry refused');
  }
  await mkdir(target,{recursive:true});
  if((await lstat(target)).isSymbolicLink())throw new Error('Session target link refused');
  for(const platform of PLATFORM_IDS){
    const name=PLATFORM_DETAILS[platform].partition.replace(/^persist:/,''),from=resolve(source,name),to=resolve(target,name);
    if(from!==join(source,name)||to!==join(target,name))throw new Error('Invalid session path');
    if(!await absent(to)||await absent(from))continue;
    await regularTree(from);
    const stage=join(target,`.import-${platform}-${randomUUID()}`);
    await cp(from,stage,{recursive:true,errorOnExist:true,force:false});
    await rename(stage,to);imported++;
  }
  return imported;
}
