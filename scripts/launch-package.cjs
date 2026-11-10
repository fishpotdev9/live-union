'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2);
if(args.some(value=>!['--baseline','--candidate','--metrics'].includes(value))||(args.includes('--baseline')&&args.includes('--candidate')))throw Error('Unsupported package launch flag');
const baseline=args.includes('--baseline'),candidate=args.includes('--candidate'),directory=path.join(root,baseline?'.local/upgrade-from-0.1.0-dev.1':candidate?'.local/candidate-release/Live Union-win32-x64':'release/Live Union-win32-x64');
const executable=path.join(directory,'Live Union.exe');
if(!fs.statSync(executable).isFile())throw Error('Built application is unavailable');
// Explicit interactive application. Never open a terminal or capture Chromium output.
const child=spawn(executable,args.includes('--metrics')?['--metrics']:[],{cwd:directory,detached:true,windowsHide:false,stdio:'ignore'});
child.once('error',()=>{console.error('Packaged application launch failed');process.exitCode=1;});
child.once('spawn',()=>{
  fs.mkdirSync(path.join(root,'.local'),{recursive:true});
  fs.writeFileSync(path.join(root,'.local','packaged-process.json'),JSON.stringify({pid:child.pid,at:new Date().toISOString(),baseline,candidate,metrics:args.includes('--metrics')})+'\n');
  console.log(`Packaged Live Union process started: ${child.pid}`);child.unref();
});
