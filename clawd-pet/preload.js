const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  onCommand: (cb) => ipcRenderer.on('cmd', (_e, c) => cb(c)),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  hiddenDone: () => ipcRenderer.send('hidden-done'),
});
