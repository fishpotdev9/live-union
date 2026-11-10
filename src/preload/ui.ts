import { contextBridge,ipcRenderer } from 'electron';
import type { AppCommand, AppState, LiveUnionBridge } from '../shared/app-contracts.ts';
const bridge:LiveUnionBridge={
  command:(command:AppCommand)=>ipcRenderer.invoke('live-union:command',command),
  onState:(listener:(state:AppState)=>void)=>{
    const handler=(_event:Electron.IpcRendererEvent,state:AppState)=>listener(state);
    ipcRenderer.on('live-union:state',handler);
    return()=>ipcRenderer.removeListener('live-union:state',handler);
  }
};
contextBridge.exposeInMainWorld('liveUnion',bridge);
