const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {prepareArchive,checkedUrl,NAME}=require('../../../scripts/prepare-electron-archive.cjs');
const bytes=Buffer.from('local synthetic archive fixture'),expected=crypto.createHash('sha256').update(bytes).digest('hex');
async function directory(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'live-union-archive-test-'));t.after(async()=>{if(path.dirname(root)!==path.resolve(os.tmpdir())||!/^live-union-archive-test-[a-z0-9]+$/i.test(path.basename(root)))throw Error('Unexpected cleanup target');await fs.rm(root,{recursive:true,force:true});});return root;}
test('runtime preparation verifies a provided file, reuses good cache, and never requests network',async t=>{
 const root=await directory(t),source=path.join(root,'provided.zip');await fs.writeFile(source,bytes);const fetchImpl=async()=>{throw Error('must not fetch');};
 assert.equal((await prepareArchive({root,source,expected,fetchImpl})).kind,'provided');assert.deepEqual(await fs.readFile(path.join(root,'.local',NAME)),bytes);
 assert.equal((await prepareArchive({root,expected,fetchImpl})).kind,'cached');
});
test('bad provided or cached archives are preserved and never replaced silently',async t=>{
 const root=await directory(t),source=path.join(root,'provided.zip');await fs.writeFile(source,'wrong');await assert.rejects(prepareArchive({root,source,expected}),/Provided archive checksum mismatch/);await fs.writeFile(path.join(root,'.local',NAME),'broken cached file');
 await assert.rejects(prepareArchive({root,expected}),/Existing archive checksum mismatch/);assert.equal(await fs.readFile(path.join(root,'.local',NAME),'utf8'),'broken cached file');
});
test('official HTTPS redirects stream into a verified archive without credentials',async t=>{
 const root=await directory(t);let calls=0;const fetchImpl=async(url,options)=>{calls++;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');if(calls===1)return new Response('',{status:302,headers:{location:'https://release-assets.githubusercontent.com/fixture.zip?temporary=not-logged'}});assert.match(url,/^https:\/\/release-assets\.githubusercontent\.com\//);return new Response(bytes);};
 assert.equal((await prepareArchive({root,expected,fetchImpl})).kind,'downloaded');assert.equal(calls,2);assert.deepEqual(await fs.readFile(path.join(root,'.local',NAME)),bytes);
});
test('untrusted redirects, wrong hashes and oversized declarations leave no archive or temporary file',async t=>{
 for(const mode of ['redirect','hash','size']){const root=await directory(t);const fetchImpl=async()=>mode==='redirect'?new Response('',{status:302,headers:{location:'https://untrusted.test/file'}}):mode==='hash'?new Response('wrong'):new Response(bytes,{headers:{'content-length':String(256*1024*1024+1)}});
 await assert.rejects(prepareArchive({root,expected,fetchImpl}));assert.deepEqual(await fs.readdir(path.join(root,'.local')),[]);}
});
test('archive URLs reject HTTP, credentials, other hosts and nonstandard ports',()=>{
 for(const url of ['http://github.com/file','https://user:secret@github.com/file','https://github.com.evil.test/file','https://github.com:444/file'])assert.throws(()=>checkedUrl(url));
 assert.equal(checkedUrl('https://github.com/file'),'https://github.com/file');
});
