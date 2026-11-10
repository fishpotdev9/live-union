'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2);
if(args.some(arg=>!['--import-g0','--validation'].includes(arg)))throw Error('Unsupported app launch flag');
// This is the user's interactive GUI, not a background helper.
const child=spawn(require('electron'),['.',...args],{cwd:root,detached:true,windowsHide:false,stdio:'ignore'});
child.once('error',()=>{console.error('Live Union process launch failed');process.exitCode=1;});
child.once('spawn',()=>{
  fs.mkdirSync(path.join(root,'.local'),{recursive:true});
  fs.writeFileSync(path.join(root,'.local/app-process.json'),JSON.stringify({pid:child.pid,at:new Date().toISOString()}));
  console.log(`Live Union process started: ${child.pid}`);child.unref();
});
