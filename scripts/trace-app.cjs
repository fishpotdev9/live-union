'use strict';
const {spawn}=require('node:child_process');
const root=require('node:path').resolve(__dirname,'..');
const child=spawn(require('electron'),['.','--lu-startup-stages'],{cwd:root,windowsHide:false,stdio:['ignore','pipe','ignore']});
console.log(`Live Union startup trace PID ${child.pid}`);
let pending='';child.stdout.on('data',data=>{
  pending+=data.toString('utf8');const lines=pending.split(/\r?\n/);pending=lines.pop().slice(-200);
  for(const line of lines)if(/^LIVE_UNION_STARTUP [a-z-]+$/.test(line))console.log(line);
});
child.on('exit',code=>{console.log(`Live Union exited ${code}`);process.exitCode=code??1;});
