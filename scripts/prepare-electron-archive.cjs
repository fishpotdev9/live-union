'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {createReadStream}=require('node:fs');
const VERSION='45.2.3',NAME=`electron-v${VERSION}-win32-x64.zip`;
const SHA256='489cd061908e697394b004298bf5ffd345c935d10e8ca197ba819f019ab2dec0';
const MAX_BYTES=256*1024*1024;
const URL_VALUE=`https://github.com/electron/electron/releases/download/v${VERSION}/${NAME}`;
const HOSTS=new Set(['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com']);
function checkedUrl(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||!HOSTS.has(url.hostname))throw Error('Untrusted Electron archive endpoint');return url.href;}
async function digest(file){const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function exists(file){try{return await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return undefined;throw error;}}
async function prepareArchive({root,source,fetchImpl=fetch,expected=SHA256,signal=AbortSignal.timeout(120000)}={}){
  root=path.resolve(root??path.join(__dirname,'..'));
  if(path.resolve(await fs.realpath(root)).toLowerCase()!==root.toLowerCase())throw Error('Redirected project directory');
  const cache=path.join(root,'.local'),prior=await exists(cache);if(prior?.isSymbolicLink()||prior&&!prior.isDirectory())throw Error('Unsafe archive cache');
  await fs.mkdir(cache,{recursive:true});if(path.resolve(await fs.realpath(cache)).toLowerCase()!==cache.toLowerCase())throw Error('Redirected archive cache');
  const target=path.join(cache,NAME),cached=await exists(target);
  if(cached?.isSymbolicLink()||cached&&(!cached.isFile()||cached.size>MAX_BYTES))throw Error('Unsafe existing archive');
  if(cached&&await digest(target)!==expected)throw Error('Existing archive checksum mismatch; original file preserved');
  if(source){source=path.resolve(source);const stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES||await digest(source)!==expected)throw Error('Provided archive checksum mismatch');}
  if(cached)return{kind:'cached',archive:NAME,sha256:expected};
  const temporary=path.join(cache,`.electron-archive-${crypto.randomUUID()}.tmp`);
  try{
    if(source)await fs.copyFile(source,temporary,require('node:fs').constants.COPYFILE_EXCL);
    else{
      let url=URL_VALUE,response;
      for(let redirects=0;redirects<=5;redirects++){
        url=checkedUrl(url);response=await fetchImpl(url,{redirect:'manual',credentials:'omit',signal});
        if([301,302,303,307,308].includes(response.status)){
          const location=response.headers.get('location');await response.body?.cancel();if(!location||redirects===5)throw Error('Electron archive redirect limit');url=checkedUrl(new URL(location,url).href);continue;
        }
        break;
      }
      if(!response?.ok||response.redirected||response.url&&response.url!==url||!response.body)throw Error('Electron archive download failed');
      const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES)){await response.body.cancel();throw Error('Electron archive exceeds size limit');}
      const handle=await fs.open(temporary,'wx'),reader=response.body.getReader();let bytes=0;
      try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_BYTES)throw Error('Electron archive exceeds size limit');await handle.writeFile(part.value);}await handle.sync();}
      finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();await handle.close();}
    }
    if(await digest(temporary)!==expected)throw Error('Downloaded archive checksum mismatch');
    if(await exists(target))throw Error('Archive cache changed during preparation');
    await fs.rename(temporary,target);
    return{kind:source?'provided':'downloaded',archive:NAME,sha256:expected};
  }finally{await fs.rm(temporary,{force:true});}
}
async function main(args){
  if(args.length>1||args.some(value=>value.startsWith('--')))throw Error('Usage: npm run runtime:prepare -- [official-archive.zip]');
  const root=path.resolve(__dirname,'..'),electron=JSON.parse(await fs.readFile(path.join(root,'node_modules/electron/package.json'),'utf8')),checksums=JSON.parse(await fs.readFile(path.join(root,'node_modules/electron/checksums.json'),'utf8'));
  if(electron.version!==VERSION||checksums[NAME]!==SHA256)throw Error('Pinned Electron dependency/checksum mismatch; run npm ci');
  const result=await prepareArchive({root,source:args[0]});console.log(`Verified ${result.archive}: ${result.sha256} (${result.kind}).`);
}
module.exports={prepareArchive,checkedUrl,VERSION,NAME,SHA256};
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error('Electron archive preparation failed. Check network access, dependency pins, or supply the official ZIP; existing files were preserved.');process.exitCode=1;});
