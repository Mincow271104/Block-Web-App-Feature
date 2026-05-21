const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusAPI', {
  getFocusMode: () => ipcRenderer.invoke('get-focus-mode'),
  toggleFocusMode: (enabled) => ipcRenderer.invoke('toggle-focus-mode', enabled),
  getClientsCount: () => ipcRenderer.invoke('get-clients-count'),
  getExtensionStatus: () => ipcRenderer.invoke('get-extension-status'),
  openExtensionsPage: () => ipcRenderer.invoke('open-extensions-page'),
  openExtensionFolder: () => ipcRenderer.invoke('open-extension-folder'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  onFocusModeChanged: (cb) => ipcRenderer.on('focus-mode-changed', (_, val) => cb(val)),
  onExtensionStatusChanged: (cb) => ipcRenderer.on('extension-status-changed', (_, val) => cb(val)),
  onGateStatusChanged: (cb) => ipcRenderer.on('gate-status', (_, val) => cb(val))
});
