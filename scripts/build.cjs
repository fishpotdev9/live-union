'use strict';
const path=require('node:path');
const fs=require('node:fs/promises');
const esbuild=require('esbuild');
(async()=>{
  const root=path.resolve(__dirname,'..'),out=path.resolve(root,'dist');
  if(out!==path.join(root,'dist')||path.dirname(out)!==root)throw Error('Invalid build output');
  try{const stat=await fs.lstat(out);if(stat.isSymbolicLink()||await fs.realpath(out)!==out)throw Error('Build output must not be a link');}catch(error){if(error.code!=='ENOENT')throw error;}
  await fs.rm(out,{recursive:true,force:true});
  await fs.mkdir(path.join(out,'assets'),{recursive:true});
  const options={bundle:true,sourcemap:false,logLevel:'warning',absWorkingDir:root};
  await esbuild.build({...options,entryPoints:['src/main/bootstrap/index.ts'],outfile:'dist/main.cjs',platform:'node',format:'cjs',target:'node24',external:['electron']});
  await esbuild.build({...options,entryPoints:['src/preload/ui.ts'],outfile:'dist/preload.cjs',platform:'node',format:'cjs',target:'node24',external:['electron']});
  await esbuild.build({...options,entryPoints:{toolbar:'src/renderer/workspace/toolbar.ts',room:'src/renderer/workspace/room.ts'},outdir:'dist/assets',platform:'browser',format:'iife',target:'chrome156'});
  for(const file of ['toolbar.html','room.html'])await fs.copyFile(path.join(root,'src/renderer/app',file),path.join(out,'assets',file));
  await fs.copyFile(path.join(root,'src/renderer/workspace/style.css'),path.join(out,'assets/style.css'));
  console.log('Built main, sandbox preload and local workbench assets.');
})().catch(error=>{console.error(error);process.exitCode=1;});
