const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  chooseDir: () => ipcRenderer.invoke('dialog:dir'),
  installAll: (cfg) => ipcRenderer.invoke('install:all', cfg),
  applyConfig: (cfg, tool) => ipcRenderer.invoke('config:apply', cfg, tool),
  generateEnvConfig: (cfg) => ipcRenderer.invoke('config:env', cfg),
  checkVersions: (cfg) => ipcRenderer.invoke('check:versions', cfg),
  scanTools: (cfg) => ipcRenderer.invoke('tools:scan', cfg),
  readLog: () => ipcRenderer.invoke('log:read'),
  onLog: (cb) => ipcRenderer.on('log', (_, msg) => cb(msg))
});
