import { app,screen } from 'electron';
import type { BaseWindow,WebContents } from 'electron';
import { readFile,writeFile,appendFile,mkdir,unlink,rename } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { validateCommand } from '../ipc/validation.ts';
import type { Controller } from './controller.ts';
import type { RoomRuntimeManager } from '../runtime-contracts.ts';
import { inspectionScript,safeInspection } from './inspection.ts';

/** Explicit source-build validation only. No remote bridge, user text, cookie or URL export. */
export async function startValidation(options:{controller:Controller;runtime:RoomRuntimeManager;window:BaseWindow;toolbar:WebContents;quit:()=>void;readOnly?:boolean}):Promise<()=>void>{
  if(app.isPackaged&&!options.readOnly)throw new Error('Development validation is unavailable in packaged builds');
  const root=resolve(__dirname,'..'),local=options.readOnly?join(app.getPath('userData'),'Diagnostics'):join(root,'.local'),request=join(local,'app-command.json');
  const runId=new Date().toISOString().replace(/[:.]/g,'-'),directory=join(local,'validation',runId);
  await mkdir(directory,{recursive:true});
  const sourceSha256=createHash('sha256').update(await readFile(join(__dirname,'main.cjs'))).digest('hex');
  let busy=false,closed=false;
  let sampleQueue:Promise<void>=Promise.resolve();
  function sample():Promise<void>{const next=sampleQueue.then(collect);sampleQueue=next.catch(()=>undefined);return next;}
  async function collect(){
    if(closed||options.window.isDestroyed())return;
    const state=options.controller.state,display=screen.getDisplayMatching(options.window.getBounds());
    const result={runId,sourceSha256,at:new Date().toISOString(),kind:app.isPackaged?'real-platform-packaged':'real-platform-development',versions:{app:app.getVersion(),electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node},workspace:{id:state.workspace.id,catalogIds:state.workspaces.map(entry=>entry.id)},
      display:{bounds:display.bounds,scaleFactor:display.scaleFactor},window:{visible:options.window.isVisible(),minimized:options.window.isMinimized(),focused:options.window.isFocused(),ownedVisibleWindows:options.window.getChildWindows().filter(window=>window.isVisible()).length,bounds:options.window.getContentBounds()},canvas:state.canvas,
      layout:{base:state.workspace.layout.base,editing:state.workspace.layout.editing,zoomed:!!state.zoomedId,native:!!state.nativeRoomId},
      rooms:state.workspace.rooms.map(room=>({id:room.id,platform:room.platform,platformRoomId:room.platformRoomId,chat:room.chat,audioAllowed:room.audio.allowed,geometry:state.geometry.rooms[room.id],presentation:options.controller.presentation(room.id),runtime:state.runtime[room.id]?{generation:state.runtime[room.id].generation,webContentsId:state.runtime[room.id].webContentsId,navigation:state.runtime[room.id].navigation,documentNavigations:state.runtime[room.id].documentNavigations,adaptation:state.runtime[room.id].adaptation,media:state.runtime[room.id].media,containerMuted:state.runtime[room.id].containerMuted,pageAudioActive:state.runtime[room.id].pageAudioActive}:undefined})),
      processes:app.getAppMetrics().map(metric=>({pid:metric.pid,type:metric.type,cpuPercent:metric.cpu.percentCPUUsage,memoryKiB:metric.memory.workingSetSize,privateKiB:metric.memory.privateBytes})),
      acousticVerified:false,qualitySelectionVerified:false,hardwareDecodeVerified:false};
    await appendFile(join(directory,'samples.jsonl'),JSON.stringify(result)+'\n');
    const stage=join(local,`app-evidence-${randomUUID()}.tmp`);
    try{await writeFile(stage,JSON.stringify(result,null,2)+'\n');await rename(stage,join(local,'app-evidence.json'));}
    finally{await unlink(stage).catch(()=>undefined);}
  }
  await writeFile(join(local,'app-process.json'),JSON.stringify({pid:process.pid,runId})+'\n');
  async function poll(){
    if(closed||busy||options.window.isDestroyed())return;busy=true;
    try{
      let text:string;try{text=await readFile(request,'utf8');}catch{return;}
      await unlink(request);if(Buffer.byteLength(text)>16384)return;
      let value:unknown;try{value=JSON.parse(text.replace(/^\uFEFF/,''));}catch{return;}
      if(!value||typeof value!=='object'||Array.isArray(value))return;
      const input=value as Record<string,unknown>;
      if(input.action==='sample')await sample();
      else if(input.action==='inspect'){
        const values=[];
        for(const room of options.controller.state.workspace.rooms){
          const contents=options.runtime.getContents(room.id);if(!contents)continue;
          try{
            const raw=await contents.executeJavaScript(inspectionScript),frames=[];
            if(room.platform==='bilibili')for(const frame of contents.mainFrame.framesInSubtree.slice(0,16)){
              let allowed=false;try{const url=new URL(frame.url);allowed=url.hostname==='live.bilibili.com'&&/^\/blanc\/[0-9]+\/?$/.test(url.pathname);}catch{}
              if(allowed&&frame!==contents.mainFrame&&frames.length<2)try{frames.push(safeInspection(await frame.executeJavaScript(inspectionScript)));}catch{}
            }
            values.push({id:room.id,platform:room.platform,inspection:safeInspection(raw),frames});
          }catch{values.push({id:room.id,platform:room.platform,unavailable:true});}
        }
        await writeFile(join(local,'app-inspection.json'),JSON.stringify({runId,sourceSha256,at:new Date().toISOString(),rooms:values},null,2)+'\n');
      }
      else if(input.action==='command'){
        const command=validateCommand(input.command,{role:'toolbar'});
        const result=await options.controller.command(command);
        // Result errors come from finite application strings, never platform responses.
        await writeFile(join(local,'app-result.json'),JSON.stringify({at:new Date().toISOString(),command:command.type,...result})+'\n');
        await sample();
      }else if(input.action==='benchmark'){
        const layout=input.kind==='layout',samples:number[]=[],paintOpportunities:number[]=[];let expectedTextCount=0;
        for(let index=0;index<100;index++){
          const command=layout?{type:'setTemplate',template:index%2===0?'focus':'equal'}:{type:'muteAll'};
          const expected=layout?(index%2===0?'主视角':'等大排列'):'';
          const value=await options.toolbar.executeJavaScript(`(async()=>{const start=performance.now();const result=await window.liveUnion.command(${JSON.stringify(command)});const ack=performance.now()-start;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {ok:result.ok,ackMs:ack,nextPaintOpportunityMs:performance.now()-start,expectedText:${layout?`document.querySelector('.workspace-summary')?.textContent.includes(${JSON.stringify(expected)})`:'true'}}})()`);
          if(value?.ok===true&&typeof value.ackMs==='number'&&Number.isFinite(value.ackMs)&&value.ackMs>=0)samples.push(value.ackMs);
          if(typeof value?.nextPaintOpportunityMs==='number'&&Number.isFinite(value.nextPaintOpportunityMs)&&value.nextPaintOpportunityMs>=0)paintOpportunities.push(value.nextPaintOpportunityMs);
          if(value?.expectedText===true)expectedTextCount++;
          await new Promise(resolve=>setTimeout(resolve,16));
        }
        samples.sort((a,b)=>a-b);paintOpportunities.sort((a,b)=>a-b);
        await writeFile(join(directory,layout?'layout-benchmark.json':'control-benchmark.json'),JSON.stringify({kind:'local-ui-ipc-command-ack',command:layout?'template-equal-focus':'muteAll',count:samples.length,p95Ms:samples[Math.ceil(samples.length*.95)-1],maxMs:samples.at(-1),nextPaintOpportunityP95Ms:paintOpportunities[Math.ceil(paintOpportunities.length*.95)-1],expectedTextCount,containerMuteApiStateVerified:layout?false:Object.values(options.controller.state.runtime).every(room=>room.containerMuted),acousticLatencyVerified:false,pixelFeedbackLatencyVerified:false},null,2)+'\n');
        await sample();
      }else if(input.action==='quit')options.quit();
    }catch{/* Malformed local validation requests do not affect platform sessions. */}
    finally{busy=false;}
  }
  const timer=options.readOnly?undefined:setInterval(()=>{void poll();},150),sampler=setInterval(()=>{if(!closed&&!options.window.isDestroyed())void sample().catch(()=>undefined);},10000);
  await sample();
  return()=>{closed=true;if(timer)clearInterval(timer);clearInterval(sampler);};
}
