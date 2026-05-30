const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusAPI', {
  getFocusMode: () => ipcRenderer.invoke('get-focus-mode'),
  toggleFocusMode: (enabled) => ipcRenderer.invoke('toggle-focus-mode', enabled),
  getClientsCount: () => ipcRenderer.invoke('get-clients-count'),
  getExtensionStatus: () => ipcRenderer.invoke('get-extension-status'),
  openExtensionsPage: () => ipcRenderer.invoke('open-extensions-page'),
  openExtensionFolder: () => ipcRenderer.invoke('open-extension-folder'),
  hideWindow: () => ipcRenderer.invoke('hide-window'),

  // Settings
  getAllowedCategories: () => ipcRenderer.invoke('get-allowed-categories'),
  saveAllowedCategories: (cats) => ipcRenderer.invoke('save-allowed-categories', cats),

  // AI Service
  checkAiStatus: () => ipcRenderer.invoke('check-ai-status'),
  saveGroqKey: (key) => ipcRenderer.invoke('save-groq-key', key),
  classifyVideo: (metadata) => ipcRenderer.invoke('classify-video', metadata),

  // Timer & Hard Mode
  startTimer: (opts) => ipcRenderer.invoke('start-timer', opts),
  pauseTimer: () => ipcRenderer.invoke('pause-timer'),
  stopTimer: () => ipcRenderer.invoke('stop-timer'),
  getTimerStatus: () => ipcRenderer.invoke('get-timer-status'),
  canClose: () => ipcRenderer.invoke('can-close'),
  cancelTimerAfk: () => ipcRenderer.invoke('cancel-timer-afk'),

  // Events
  onFocusModeChanged: (cb) => ipcRenderer.on('focus-mode-changed', (_, val) => cb(val)),
  onExtensionStatusChanged: (cb) => ipcRenderer.on('extension-status-changed', (_, val) => cb(val)),
  onGateStatusChanged: (cb) => ipcRenderer.on('gate-status', (_, val) => cb(val)),
  onTimerExpired: (cb) => ipcRenderer.on('timer-expired', () => cb()),
  onAiStatusLost: (cb) => ipcRenderer.on('ai-status-lost', () => cb()),
  onTimerAfkCancelled: (cb) => ipcRenderer.on('timer-afk-cancelled', () => cb())
});
