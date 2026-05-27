const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  chooseDir: () => ipcRenderer.invoke('dialog:dir'),
  installAll: (cfg) => ipcRenderer.invoke('install:all', cfg),
  applyConfig: (cfg) => ipcRenderer.invoke('config:apply', cfg),
  checkVersions: (cfg) => ipcRenderer.invoke('check:versions', cfg),
  scanTools: (cfg) => ipcRenderer.invoke('tools:scan', cfg),
  saveProxyProfile: (cfg, profile) => ipcRenderer.invoke('proxy:save-profile', cfg, profile),
  deleteProxyProfile: (cfg, name) => ipcRenderer.invoke('proxy:delete-profile', cfg, name),
  applyProxyProfile: (cfg, name) => ipcRenderer.invoke('proxy:apply-profile', cfg, name),
  readLog: () => ipcRenderer.invoke('log:read'),
  onLog: (cb) => ipcRenderer.on('log', (_, msg) => cb(msg))
});
