const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  onCommand: (cb) => ipcRenderer.on('cmd', (_e, c) => cb(c)),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  hiddenDone: () => ipcRenderer.send('hidden-done'),
  onUsage: (cb) => ipcRenderer.on('usage', (_e, u) => cb(u)),
  onClaude: (cb) => ipcRenderer.on('cc', (_e, ev) => cb(ev)),   // Claude Code hooks 事件
  focusSession: (s) => ipcRenderer.send('focus-session', s),   // 点小螃蟹:跳到会话所在的窗口
  onPerm: (cb) => ipcRenderer.on('perm', (_e, p) => cb(p)),   // Claude 要你批准:在 Clawd 上弹按钮
  permDecision: (id, behavior) => ipcRenderer.send('perm-decision', id, behavior),
  requestUsage: () => ipcRenderer.send('request-usage'),
  setClinging: (v) => ipcRenderer.send('clinging', v),
});
