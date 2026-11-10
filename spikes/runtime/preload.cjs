const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('g0', {
  command: (command) => ipcRenderer.invoke('g0:command', command),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('g0:state', listener);
    return () => ipcRenderer.removeListener('g0:state', listener);
  }
});
