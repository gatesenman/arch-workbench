const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('awWin', {
  minimize: () => ipcRenderer.send('win', 'min'), toggleMax: () => ipcRenderer.send('win', 'max'), close: () => ipcRenderer.send('win', 'close'),
  onMax: cb => ipcRenderer.on('win-max', (_e, v) => cb(v))
});
