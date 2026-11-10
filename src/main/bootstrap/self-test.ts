import assert from 'node:assert/strict';
import type { BaseWindow, BrowserWindow, Session, WebContents, session as ElectronSession } from 'electron';
import type { AppCommand } from '../../shared/app-contracts.ts';
import { PLATFORM_IDS, platformPartition } from '../../shared/platforms.ts';
import type { RoomRuntimeManager } from '../runtime-contracts.ts';
import type { Controller } from './controller.ts';
import { app,webContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const fixture=`<!doctype html><html><head><meta charset="utf-8"><title>本地整合 fixture</title><style>body{margin:0;background:#132334;color:white;font:18px sans-serif}video{width:100%;height:calc(100vh - 64px);object-fit:contain}input{width:60%}</style></head><body><video autoplay muted playsinline></video><input aria-label="本地测试输入" placeholder="本地fixture，不发送"><button>本地按钮</button><script>
const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d');let frame=0;window.fixture={get frame(){return frame},boot:performance.now()};
function draw(){frame++;ctx.fillStyle='#132334';ctx.fillRect(0,0,960,540);ctx.strokeStyle='#fbd277';ctx.lineWidth=12;ctx.strokeRect(6,6,948,528);ctx.fillStyle='white';ctx.font='28px sans-serif';ctx.fillText('LOCAL FIXTURE '+frame,24,60);ctx.fillRect(frame*5%880,260,70,40);requestAnimationFrame(draw)}draw();document.querySelector('video').srcObject=canvas.captureStream(30);
localStorage.setItem('live-union-fixture','same-platform-session');
</script></body></html>`;
export async function installFixture(sessions:typeof ElectronSession):Promise<void>{
  for(const platform of PLATFORM_IDS){
    const client:Session=sessions.fromPartition(platformPartition(platform));
    await client.protocol.handle('https',request=>{
      const url=new URL(request.url);
      if(url.hostname==='api.live.bilibili.com')return new Response(JSON.stringify({code:0,data:{room_id:Number(url.searchParams.get('id')),live_status:1}}),{headers:{'Content-Type':'application/json'}});
      return new Response(fixture,{headers:{'Content-Type':'text/html; charset=utf-8'}});
    });
  }
}
async function until(predicate:()=>boolean,limit=12000):Promise<void>{
  const end=Date.now()+limit;while(!predicate()){if(Date.now()>end)throw new Error('Timed out');await new Promise(resolve=>setTimeout(resolve,50));}
}
export async function runSelfTest(options:{controller:Controller;runtime:RoomRuntimeManager;toolbar:WebContents;window:BaseWindow;hidden?:boolean;visual?:BrowserWindow;makeRoomVisual?:(id:string)=>Promise<BrowserWindow>;publicNickname?:boolean;nicknameAttempts?:()=>number;toolbarBounds?:()=>{height:number};toolbarTop?:()=>boolean;historyUpgrade?:boolean;restart?:boolean;cycles?:boolean;quit:()=>void}):Promise<void>{
  const {controller,runtime,toolbar}=options,checks:string[]=[];
  const historyUi:unknown[]=[];
  let resourceCycles:{rounds:number;warmupRounds:number;contentsAfterClose:number[];workingSetKiB:number[];memoryGate?:boolean;firstMeasuredMeanKiB?:number;lastMeasuredMeanKiB?:number}|undefined;
  const command=async(value:AppCommand)=>{
    const result=await toolbar.executeJavaScript(`window.liveUnion.command(${JSON.stringify(value)})`);
    assert.equal(result.ok,true);return result;
  };
  try{
    if(options.hidden){assert.equal(options.window.isVisible(),false);checks.push('hidden-test-never-shows-window');}
    await until(()=>controller.state.history?.status==='ready');checks.push('history-ready-with-isolated-storage');
    if(options.publicNickname){
      for(const id of ['5566','74960','5556'])await command({type:'addRoom',url:`https://www.douyu.com/${id}`});
      await until(()=>controller.state.history?.entries.length===3&&controller.state.history.entries.every(entry=>!!entry.nickname)&&Object.values(controller.state.runtime).every(state=>!!state.anchorNickname),35000);
      const names=controller.state.history!.entries.map(entry=>({id:entry.platformRoomId,nickname:entry.nickname!}));
      assert.ok(names.every(entry=>entry.nickname!==entry.id&&!entry.nickname.startsWith('测试主播')));
      await command({type:'setHistoryOpen',open:true});
      let historyLabels:string[]=[];
      for(let i=0;i<100;i++){historyLabels=await toolbar.executeJavaScript('[...document.querySelectorAll(".history-label")].map(node=>node.textContent)');if(names.every(entry=>historyLabels.includes(`斗鱼－${entry.nickname}`)))break;await new Promise(resolve=>setTimeout(resolve,30));}
      assert.deepEqual(historyLabels,names.map(entry=>`斗鱼－${entry.nickname}`));await command({type:'setHistoryOpen',open:false});checks.push('anonymous-official-names-reach-persisted-history-list-and-room-runtime');
      for(const room of controller.state.workspace.rooms){
        const chrome=webContents.getAllWebContents().find(contents=>contents.getURL().includes(`room.html?roomId=${room.id}`))!;
        const ui=await chrome.executeJavaScript('({name:document.querySelector(".room-label").textContent,platform:document.querySelector(".platform-label").textContent,hint:document.querySelector(".room-identity").title})');
        assert.equal(ui.name,names.find(entry=>entry.id===room.platformRoomId)!.nickname);assert.equal(ui.platform,'斗鱼');assert.ok(ui.hint.includes(room.platformRoomId)&&ui.hint.includes(room.canonicalUrl));
      }
      checks.push('actual-room-chrome-shows-public-anchor-name-and-retains-room-id-url-hint');
      const current=controller.state.workspace.rooms.find(room=>room.platformRoomId==='74960')!,view=await options.makeRoomVisual!(current.id);
      for(const width of [220,700]){
        view.setContentSize(width,180);await until(()=>!view.isDestroyed());
        for(let i=0;i<100;i++){if(await view.webContents.executeJavaScript(`Math.abs(innerWidth-${width})<=2&&document.querySelector('.room-label').textContent===${JSON.stringify(controller.state.runtime[current.id].anchorNickname)}`))break;await new Promise(resolve=>setTimeout(resolve,30));}
        const ui=await view.webContents.executeJavaScript('(()=>{const n=document.querySelector(".room-label"),a=document.querySelector(".room-audio"),c=document.querySelector(".room-close"),r=n.getBoundingClientRect();return{width:innerWidth,height:innerHeight,name:n.textContent,nameWidth:r.width,nameRight:r.right,audioLeft:a.getBoundingClientRect().left,closeRight:c.getBoundingClientRect().right,ellipsis:getComputedStyle(n).textOverflow}})()');
        assert.ok(Math.abs(ui.width-width)<=2);assert.ok(ui.nameWidth>0&&ui.nameRight<=ui.audioLeft+1&&ui.closeRight<=ui.width+1);assert.equal(ui.ellipsis,'ellipsis');
        const shot=await new Promise<Electron.NativeImage>((resolve,reject)=>{let full=0;const stop=()=>{clearInterval(tick);clearTimeout(timer);view.webContents.removeListener('paint',paint);};const paint=(_e:unknown,_r:unknown,image:Electron.NativeImage)=>{const size=image.getSize();if(Math.abs(size.width-ui.width)<=2&&Math.abs(size.height-ui.height)<=2&&++full>=2){stop();resolve(image);}};const timer=setTimeout(()=>{stop();reject(Error('Title paint timed out.'));},5000);const tick=setInterval(()=>view.webContents.invalidate(),100);view.webContents.on('paint',paint);view.webContents.invalidate();});
        await writeFile(join(app.getPath('userData'),`nickname-header-${width}.png`),shot.toPNG());assert.equal(view.isVisible(),false);
      }
      checks.push('offscreen-narrow-and-wide-room-title-preserves-audio-and-close-controls');view.close();
      const before=controller.state.workspace,identity=runtime.getRuntimeIdentity(current.id);await command({type:'clearHistory'});assert.deepEqual(controller.state.workspace,before);assert.deepEqual(runtime.getRuntimeIdentity(current.id),identity);assert.ok(Object.values(controller.state.runtime).every(state=>!!state.anchorNickname));checks.push('clearing-history-keeps-current-public-names-and-running-instances');
      console.log('LIVE_UNION_SELF_TEST '+JSON.stringify({kind:'isolated-public-nickname-integration',passed:true,checks,names,publicMetadata:true,platformCompatibility:false,realPlayback:false,performance:false}));return;
    }
    if(options.historyUpgrade){
      const workspace=controller.state.workspace,geometry=controller.state.geometry;
      assert.equal(workspace.rooms.length,8);assert.equal(workspace.name,'本地整合测试组合');checks.push('legacy-workspaces-restore-without-history-database');
      await until(()=>controller.state.history?.entries.length===9&&controller.state.history.entries.every(entry=>!!entry.nickname));
      assert.ok(controller.state.history!.entries.every(entry=>entry.lastAddedAt===null));assert.equal(new Set(controller.state.history!.entries.map(entry=>`${entry.platform}:${entry.platformRoomId}`)).size,9);checks.push('legacy-history-backfills-all-registered-workspaces-once-without-invented-times');
      assert.deepEqual(controller.state.workspace,workspace);assert.deepEqual(controller.state.geometry,geometry);checks.push('history-backfill-keeps-active-workspace-and-audio');
      const legacy=controller.state.history!.entries.find(entry=>entry.platformRoomId==='300009')!;assert.ok(legacy);assert.ok(!workspace.rooms.some(room=>room.platformRoomId==='300009'));
      await command({type:'removeHistoryRoom',historyId:legacy.id});assert.deepEqual(controller.state.workspace,workspace);checks.push('legacy-history-delete-preserves-saved-and-active-rooms');
      console.log('LIVE_UNION_SELF_TEST '+JSON.stringify({kind:'isolated-history-upgrade-fixture',passed:true,checks,platformCompatibility:false,realPlayback:false,performance:false}));return;
    }
    if(options.restart){
      assert.equal(controller.state.workspace.rooms.length,8);assert.equal(controller.state.workspace.name,'本地整合测试组合');
      assert.ok(controller.state.workspace.rooms.every(room=>!room.audio.allowed&&room.canonicalUrl!=='https://live.bilibili.com/300009'));
      await until(()=>Object.values(controller.state.runtime).length===8&&Object.values(controller.state.runtime).every(state=>state.navigation==='ready'));
      checks.push('restart-restores-eight-saved-rooms-without-deleted-room');
      assert.equal(controller.state.history?.entries.length,0);checks.push('history-clear-survives-process-restart-with-saved-workspaces');
      for(const room of controller.state.workspace.rooms)await command({type:'removeRoom',roomId:room.id});
    }
    if(options.cycles){
      resourceCycles={rounds:60,warmupRounds:30,contentsAfterClose:[],workingSetKiB:[]};
      const initialContents=webContents.getAllWebContents().length;
      for(let round=0;round<60;round++){
        for(let index=0;index<9;index++)await command({type:'addRoom',url:[`https://www.huya.com/${400001+index}`,`https://www.douyu.com/${500001+index}`,`https://live.bilibili.com/${600001+index}`][index%3]});
        await until(()=>Object.values(controller.state.runtime).length===9&&Object.values(controller.state.runtime).every(state=>state.navigation==='ready'));
        await new Promise(resolve=>setTimeout(resolve,100));
        for(const room of controller.state.workspace.rooms){assert.ok(await runtime.getContents(room.id)!.executeJavaScript('window.fixture.frame>0'));await command({type:'removeRoom',roomId:room.id});}
        await until(()=>webContents.getAllWebContents().length===initialContents);
        resourceCycles.contentsAfterClose.push(webContents.getAllWebContents().length);
        resourceCycles.workingSetKiB.push(app.getAppMetrics().reduce((sum,metric)=>sum+metric.memory.workingSetSize,0));
        if(round%10===9)console.log('LIVE_UNION_SELF_TEST_CYCLE '+JSON.stringify({completed:round+1,contents:webContents.getAllWebContents().length,workingSetKiB:resourceCycles.workingSetKiB.at(-1)}));
      }
      const mean=(values:number[])=>values.reduce((sum,value)=>sum+value,0)/values.length;
      resourceCycles.firstMeasuredMeanKiB=mean(resourceCycles.workingSetKiB.slice(30,40));
      resourceCycles.lastMeasuredMeanKiB=mean(resourceCycles.workingSetKiB.slice(50,60));
      resourceCycles.memoryGate=resourceCycles.lastMeasuredMeanKiB<=resourceCycles.firstMeasuredMeanKiB*1.3&&resourceCycles.lastMeasuredMeanKiB-resourceCycles.firstMeasuredMeanKiB<=1024*1024;
      assert.ok(resourceCycles.memoryGate);
      checks.push('thirty-warmup-and-thirty-measured-native-cycles-release-contents-and-stabilize-memory');
    }
    await until(()=>controller.state.workspace.rooms.length===0);checks.push('empty-start');
    await command({type:'clearHistory'});
    for(let index=0;index<9;index++){
      const urls=[`https://www.huya.com/${100001+index}`,`https://www.douyu.com/${200001+index}`,`https://live.bilibili.com/${300001+index}`];
      await command({type:'addRoom',url:urls[index%3]});
      const count=index+1;assert.equal(controller.state.workspace.rooms.length,count);
      assert.equal(Object.keys(controller.state.geometry.rooms).length,count);checks.push(`native-room-count-${count}`);
    }
    await until(()=>Object.values(controller.state.runtime).length===9&&Object.values(controller.state.runtime).every(state=>state.navigation==='ready'));
    await until(()=>controller.state.history?.entries.length===9&&controller.state.history.entries.every(entry=>!!entry.nickname));
    checks.push('history-captures-additions-and-enriches-safe-fixture-nicknames');
    assert.equal(options.nicknameAttempts?.(),2);await until(()=>Object.values(controller.state.runtime).every(state=>!!state.anchorNickname));checks.push('shared-nickname-lookup-automatically-recovers-initial-unknown-in-history-and-room-titles');
    const historyTarget=controller.state.history!.entries.find(entry=>entry.canonicalUrl==='https://live.bilibili.com/300009')!;
    const originalRoom=controller.state.workspace.rooms.find(room=>room.canonicalUrl===historyTarget.canonicalUrl)!;
    const historyWorkspace=controller.state.workspace,historyGeometry=controller.state.geometry;
    const historyIdentities=historyWorkspace.stableOrder.map(id=>runtime.getRuntimeIdentity(id));
    await toolbar.executeJavaScript('document.querySelector(".history-toggle").click();void 0');await until(()=>controller.state.historyOpen===true);
    assert.ok((options.toolbarBounds?.().height??0)>128);assert.equal(options.toolbarTop?.(),true);assert.deepEqual(controller.state.workspace,historyWorkspace);assert.deepEqual(controller.state.geometry,historyGeometry);
    assert.deepEqual(historyWorkspace.stableOrder.map(id=>runtime.getRuntimeIdentity(id)),historyIdentities);checks.push('history-native-overlay-retains-room-geometry-identities-and-audio');
    const originalBounds=options.window.getContentBounds();
    const visualContents=options.visual?.webContents??toolbar;
    for(const width of [980,1920]){
      if(options.visual)options.visual.setContentSize(width,548);else options.window.setContentSize(width,Math.min(1000,originalBounds.height));
      for(let attempt=0;attempt<100;attempt++){if(await visualContents.executeJavaScript(`Math.abs(innerWidth-${width})<=2&&!document.querySelector('#room-history').hidden`))break;await new Promise(resolve=>setTimeout(resolve,50));}
      const ui=await visualContents.executeJavaScript('(()=>{const panel=document.querySelector("#room-history"),search=document.querySelector(".history-search"),r=panel.getBoundingClientRect(),s=search.getBoundingClientRect();return{open:!panel.hidden,width:innerWidth,top:r.top,bottom:r.bottom,height:innerHeight,searchWidth:s.width,rows:document.querySelectorAll(".history-room").length}})()');
      historyUi.push({requestedWidth:width,...ui});
      // Windows fractional display scaling rounds native sizes to pixels.
      assert.equal(ui.open,true);assert.ok(Math.abs(ui.width-width)<=2);assert.equal(ui.top,128);assert.ok(ui.bottom<=ui.height+1);assert.ok(ui.searchWidth>100);assert.equal(ui.rows,9);
      const shot=options.visual?await new Promise<Electron.NativeImage>((resolve,reject)=>{
        const stop=()=>{clearTimeout(timer);clearInterval(repaint);visualContents.removeListener('paint',painted);};
        const painted=(_event:unknown,_dirty:unknown,image:Electron.NativeImage)=>{
          const size=image.getSize();if(size.width<ui.width-2||size.height<ui.height-2)return;
          // Discard queued pre-open/partial damage frames; inspect the panel's
          // actual background below its top edge, then save the whole frame.
          const pixel=image.crop({x:10,y:130,width:1,height:1}).toBitmap();
          if(pixel[0]!==35||pixel[1]!==25||pixel[2]!==17)return;
          stop();resolve(image);
        };
        const timer=setTimeout(()=>{stop();reject(new Error('Complete offscreen history paint timed out.'));},5000);
        const repaint=setInterval(()=>visualContents.invalidate(),100);
        visualContents.on('paint',painted);visualContents.invalidate();
      }):await visualContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
      assert.equal(shot.isEmpty(),false);await writeFile(join(app.getPath('userData'),`history-${width}.png`),shot.toPNG());
      if(options.hidden){assert.equal(options.window.isVisible(),false);assert.equal(options.visual?.isVisible(),false);}
    }
    if(!options.visual)options.window.setContentSize(originalBounds.width,originalBounds.height);checks.push('history-offscreen-ui-fits-980-and-1920-logical-widths');
    await toolbar.executeJavaScript(`document.querySelector('.history-room[data-history-id="${historyTarget.id}"]').click();void 0`);await until(()=>controller.state.historyOpen===false);
    assert.equal(controller.state.workspace.rooms.length,9);assert.equal(controller.state.selectedId,originalRoom.id);assert.equal(controller.state.history!.entries.find(entry=>entry.id===historyTarget.id)!.lastAddedAt,historyTarget.lastAddedAt);checks.push('history-selects-open-instance-without-new-addition');
    await command({type:'removeRoom',roomId:originalRoom.id});assert.equal(controller.state.history?.entries.length,9);
    await toolbar.executeJavaScript('document.querySelector(".history-toggle").click();void 0');await until(()=>controller.state.historyOpen===true);
    await toolbar.executeJavaScript(`(()=>{const s=document.querySelector('.history-search');s.value='300009';s.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.history-room[data-history-id="${historyTarget.id}"]').click()})()`);
    await until(()=>controller.state.workspace.rooms.length===9&&controller.state.historyOpen===false&&Object.values(controller.state.runtime).every(state=>state.navigation==='ready'));
    const recreated=controller.state.workspace.rooms.find(room=>room.canonicalUrl===historyTarget.canonicalUrl)!;assert.notEqual(recreated.id,originalRoom.id);assert.equal(recreated.audio.allowed,false);assert.equal(runtime.getContents(recreated.id)!.isAudioMuted(),true);checks.push('history-readds-closed-room-muted-with-new-runtime');
    await toolbar.executeJavaScript('document.querySelector(".history-toggle").click();void 0');await until(()=>controller.state.historyOpen===true);
    await toolbar.executeJavaScript(`document.querySelector('.history-remove[data-history-id="${historyTarget.id}"]').click();void 0`);await until(()=>controller.state.history?.entries.length===8);assert.equal(controller.state.workspace.rooms.length,9);checks.push('history-single-delete-keeps-live-room');
    await toolbar.executeJavaScript('document.querySelector(".history-tools > button").click();void 0');assert.equal(await toolbar.executeJavaScript('document.querySelector(".history-confirmation").hidden'),false);
    await toolbar.executeJavaScript('document.querySelector(".history-danger").click();void 0');await until(()=>controller.state.history?.entries.length===0);assert.equal(controller.state.workspace.rooms.length,9);
    await command({type:'setHistoryOpen',open:false});checks.push('history-clear-confirmation-keeps-rooms-layout-and-preferences');
    assert.ok(Object.values(controller.state.runtime).every(state=>!!state.anchorNickname));checks.push('history-clear-keeps-current-room-nicknames');
    const ids=controller.state.workspace.stableOrder;
    const identities=ids.map(id=>runtime.getRuntimeIdentity(id));
    const boots=await Promise.all(ids.map(id=>runtime.getContents(id)!.executeJavaScript('window.fixture.boot')));
    assert.ok(ids.every(id=>runtime.getContents(id)!.isAudioMuted()));checks.push('all-new-rooms-muted');
    const security=await runtime.getContents(ids[0])!.executeJavaScript('({require:typeof require,process:typeof process,bridge:typeof window.liveUnion})');
    assert.deepEqual(security,{require:'undefined',process:'undefined',bridge:'undefined'});checks.push('remote-no-node-or-ipc');
    await command({type:'setAudio',roomId:ids[0],allowed:true});await command({type:'setAudio',roomId:ids[1],allowed:true});
    assert.deepEqual(controller.state.workspace.rooms.filter(room=>room.audio.allowed).map(room=>room.id),ids.slice(0,2));
    const allowed=controller.state.workspace.rooms.map(room=>room.audio.allowed);
    for(const template of ['focus','equal'] as const)await command({type:'setTemplate',template});
    await command({type:'setPrimary',roomId:ids[4]});await command({type:'setFree',fromCurrent:true});
    await command({type:'raiseRoom',roomId:ids[0]});
    const gestureId=crypto.randomUUID();await command({type:'geometryBegin',roomId:ids[0],gestureId,kind:'move'});
    for(let index=0;index<20;index++)await command({type:'geometryDelta',roomId:ids[0],gestureId,dx:20+index,dy:30+index});
    await command({type:'geometryEnd',roomId:ids[0],gestureId});
    await command({type:'setZoom',roomId:ids[2],enabled:true});await command({type:'setZoom',roomId:ids[2],enabled:false});
    await command({type:'setNative',roomId:ids[2],enabled:true});await command({type:'setNative',roomId:ids[2],enabled:false});
    await command({type:'undoGeometry'});
    assert.deepEqual(ids.map(id=>runtime.getRuntimeIdentity(id)),identities);
    assert.deepEqual(await Promise.all(ids.map(id=>runtime.getContents(id)!.executeJavaScript('window.fixture.boot'))),boots);
    assert.deepEqual(controller.state.workspace.rooms.map(room=>room.audio.allowed),allowed);checks.push('layout-keeps-documents-and-audio');
    await command({type:'soloAudio',roomId:ids[3]});assert.deepEqual(controller.state.workspace.rooms.filter(room=>room.audio.allowed).map(room=>room.id),[ids[3]]);
    assert.ok(ids.every(id=>runtime.getContents(id)!.isAudioMuted()===(id!==ids[3])));checks.push('solo-native-container-muting');
    await command({type:'muteAll'});assert.ok(ids.every(id=>runtime.getContents(id)!.isAudioMuted()));checks.push('mute-all');
    const navs=ids.map(id=>controller.state.runtime[id].documentNavigations);
    await command({type:'reloadRoom',roomId:ids[4]});
    await until(()=>controller.state.runtime[ids[4]].navigation==='ready'&&controller.state.runtime[ids[4]].documentNavigations>navs[4]);
    assert.deepEqual(ids.map(id=>runtime.getRuntimeIdentity(id)),identities);
    assert.ok(ids.every((id,index)=>index===4||controller.state.runtime[id].documentNavigations===navs[index]));checks.push('local-reload-only-target');
    const sessions=ids.filter(id=>controller.state.workspace.rooms.find(room=>room.id===id)!.platform==='huya').map(id=>runtime.getContents(id)!.session);
    assert.ok(sessions.every(value=>value===sessions[0]));assert.notEqual(runtime.getContents(ids[0])!.session,runtime.getContents(ids[1])!.session);checks.push('platform-session-sharing-and-isolation');
    const oldId=controller.state.workspace.id;
    await command({type:'saveWorkspaceAs',name:'本地整合测试组合'});assert.notEqual(controller.state.workspace.id,oldId);
    assert.deepEqual(ids.map(id=>runtime.getRuntimeIdentity(id)),identities);checks.push('save-as-keeps-instances');
    await command({type:'removeRoom',roomId:ids[8]});assert.equal(runtime.getContents(ids[8]),undefined);assert.equal(controller.state.workspace.rooms.length,8);
    await command({type:'undoGeometry'});assert.equal(controller.state.workspace.rooms.length,8);checks.push('close-does-not-resurrect');
    await controller.flushSave();assert.equal(controller.state.saveStatus,'saved');checks.push('atomic-workspace-save');
    console.log('LIVE_UNION_SELF_TEST '+JSON.stringify({kind:'isolated-native-fixture',passed:true,checks,historyUi,resourceCycles,platformCompatibility:false,realPlayback:false,performance:false}));
  }catch(error){
    // This entry point uses only generated pages and a temporary profile.
    const failure=error instanceof Error?{name:error.name,message:error.message.slice(0,1000)}:{name:'Unknown fixture failure'};
    console.log('LIVE_UNION_SELF_TEST '+JSON.stringify({kind:'isolated-native-fixture',passed:false,checks,historyUi,failure,resourceCycles,platformCompatibility:false,realPlayback:false,performance:false}));process.exitCode=1;
  }finally{options.quit();}
}
