'use strict';
// Keep native Chromium messages out of ordinary logs; G0 writes bounded evidence itself.
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root=path.resolve(__dirname,'..');
const args=process.argv.slice(2);
if(args.some(a=>!['--platforms','--fixture','--control','--login-douyu'].includes(a)))throw Error('Unsupported G0 launch flag');
const child=spawn(require('electron'),['spikes/runtime/main.cjs',...args],{cwd:root,detached:true,windowsHide:false,stdio:'ignore'});
child.once('error',()=>{console.error('G0 process launch failed');process.exitCode=1;});
child.once('spawn',()=>{
  fs.mkdirSync(path.join(root,'.local'),{recursive:true});
  fs.writeFileSync(path.join(root,'.local/g0-process.json'),JSON.stringify({pid:child.pid,at:new Date().toISOString()}));
  console.log(`G0 process started: ${child.pid}`);
  child.unref();
});
