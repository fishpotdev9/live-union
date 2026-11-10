import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import type { AppState, AppCommand, CommandResult } from '../../shared/app-contracts.ts';
import { validateCommand } from './validation.ts';

export function createUiRegistry(dispatch:(command:AppCommand)=>Promise<CommandResult>,getState:()=>AppState|undefined){
  const stateFor=(state:AppState,role:'toolbar'|'room'):AppState=>role==='toolbar'?state:{...state,history:undefined,historyOpen:undefined};
  const trusted=new Map<number,{contents:WebContents;url:string;role:'toolbar'|'room';roomId?:string}>();
  ipcMain.handle('live-union:command',async(event,raw:unknown):Promise<CommandResult>=>{
    try{
      const sender=event.sender,frame=event.senderFrame,entry=trusted.get(sender.id);
      if(!entry||entry.contents!==sender||sender.isDestroyed()||!frame||frame!==sender.mainFrame||frame.url!==entry.url||sender.getURL()!==entry.url)return{ok:false,error:'无效的操作来源'};
      return await dispatch(validateCommand(raw,entry));
    }catch{return{ok:false,error:'无效的工作台命令'};}
  });
  function register(contents:WebContents,url:string,role:'toolbar'|'room',roomId?:string):()=>void{
    if(new URL(url).protocol!=='file:')throw new Error('UI must be local');
    const entry={contents,url,role,roomId};trusted.set(contents.id,entry);
    const ready=()=>{try{const state=getState();if(state&&!contents.isDestroyed()&&contents.getURL()===url)contents.send('live-union:state',stateFor(state,role));}catch{/* A local UI frame can close during delivery. */}};
    contents.on('did-finish-load',ready);
    return()=>{trusted.delete(contents.id);contents.removeListener('did-finish-load',ready);};
  }
  return {register,publish(state:AppState){const roomState=stateFor(state,'room');for(const {contents,url,role} of trusted.values())try{if(!contents.isDestroyed()&&contents.getURL()===url)contents.send('live-union:state',role==='toolbar'?state:roomState);}catch{/* Closing a local frame must not crash other rooms. */}},dispose(){ipcMain.removeHandler('live-union:command');trusted.clear();}};
}
