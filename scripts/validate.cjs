'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const directory=path.resolve(__dirname,'../.local'),[action,...args]=process.argv.slice(2);
const boolean=value=>{if(!['on','off'].includes(value))throw Error('Expected on/off');return value==='on';};
const commands={
  add:()=>({type:'addRoom',url:args[0]}),remove:()=>({type:'removeRoom',roomId:args[0]}),reload:()=>({type:'reloadRoom',roomId:args[0]}),
  template:()=>({type:'setTemplate',template:args[0]}),free:()=>({type:'setFree',fromCurrent:true}),arrange:()=>({type:'arrange'}),undo:()=>({type:'undoGeometry'}),mute:()=>({type:'muteAll'}),
  chat:()=>({type:'setChat',roomId:args[0],visible:boolean(args[1])}),allChat:()=>({type:'setAllChat',visible:boolean(args[0])}),
  width:()=>({type:'setChatWidth',roomId:args[0],widthDip:Number(args[1])}),
  copy:()=>({type:'saveWorkspaceAs',name:args[0]}),open:()=>({type:'openWorkspace',workspaceId:args[0]}),
  native:()=>({type:'setNative',roomId:args[0],enabled:boolean(args[1])}),zoom:()=>({type:'setZoom',roomId:args[0],enabled:boolean(args[1])}),primary:()=>({type:'setPrimary',roomId:args[0]}),
};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const mtime=async file=>{try{return(await fs.stat(file)).mtimeMs;}catch(error){if(error.code==='ENOENT')return 0;throw error;}};
(async()=>{
  const command=commands[action]?.();
  if(!command&&!['sample','inspect','benchmark','benchmarkLayout','quit'].includes(action))throw Error('Unknown validation operation');
  const run=JSON.parse(await fs.readFile(path.join(directory,'app-process.json'),'utf8'));
  if(!/^[0-9TZ-]+$/.test(run.runId))throw Error('Invalid validation run');
  const request=path.join(directory,'app-command.json'),reply=path.join(directory,command?'app-result.json':action==='inspect'?'app-inspection.json':['benchmark','benchmarkLayout'].includes(action)?`validation/${run.runId}/${action==='benchmarkLayout'?'layout-benchmark.json':'control-benchmark.json'}`:'app-evidence.json');
  if(await mtime(request))throw Error('Another request is pending');
  const before=await mtime(reply),stage=path.join(directory,`command-${randomUUID()}.tmp`);
  await fs.writeFile(stage,JSON.stringify(command?{action:'command',command}:action==='benchmarkLayout'?{action:'benchmark',kind:'layout'}:{action})+'\n',{flag:'wx'});await fs.rename(stage,request);
  if(action==='quit'){console.log('Exit requested');return;}
  const end=Date.now()+25000;
  let result;
  for(;;){
    if(Date.now()>end)throw Error('Validation request timed out');
    if(await mtime(reply)>before&&!await mtime(request))try{result=JSON.parse((await fs.readFile(reply,'utf8')).replace(/^\uFEFF/,''));break;}catch{}
    await sleep(100);
  }
  if(command){if(result.command!==command.type)throw Error('Unexpected validation reply');console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;}
  else console.log(JSON.stringify({action,at:result.at,runId:result.runId,count:result.rooms?.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
