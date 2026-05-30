const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const { WebSocketServer } = require('ws');
const path = require('path');
const aiService = require('./ai-service');

let mainWindow = null;
let tray = null;
let focusMode = false;
let extensionConnected = false;
const WS_PORT = 8765;

// ===== Timer & Hard Mode State =====
let timerState = {
  active: false,
  hardMode: false,
  endTime: 0,       // timestamp when timer expires
  remaining: 0,     // ms remaining (used when paused)
  paused: false,
  totalMinutes: 0   // original duration
};
let timerInterval = null;

function updateTrayTooltipText() {
  if (!tray) return;
  const ts = getTimerStatus();
  let tooltipText = 'Focus Guard';
  
  if (ts.active) {
    const totalSec = Math.ceil(ts.remaining / 1000);
    const m = Math.floor(totalSec / 60);
    const s = String(totalSec % 60).padStart(2, '0');
    tooltipText = `Focus Guard — Đang Focus: ${m}:${s}`;
    if (ts.paused) tooltipText += ' (Tạm dừng)';
    if (ts.hardMode) tooltipText += ' [HARD MODE]';
  } else if (focusMode) {
    tooltipText = 'Focus Guard — Block Thủ Công';
  } else {
    tooltipText = 'Focus Guard — TẮT';
  }
  tray.setToolTip(tooltipText);
}

function startTimerTick() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (!timerState.active || timerState.paused) return;
    const now = Date.now();
    
    // Update tooltip live on hover
    if (tray) updateTrayTooltipText();

    if (now >= timerState.endTime) {
      // Timer expired!
      console.log('[Timer] Session complete!');
      timerState.active = false;
      timerState.hardMode = false;
      timerState.paused = false;
      clearInterval(timerInterval);
      focusMode = false;
      broadcastToClients(null);
      updateTray();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('focus-mode-changed', focusMode);
        mainWindow.webContents.send('timer-expired');
      }
    }
  }, 1000);
}

function getTimerStatus() {
  if (!timerState.active) return { active: false };
  let remaining;
  if (timerState.paused) {
    remaining = timerState.remaining;
  } else {
    remaining = Math.max(0, timerState.endTime - Date.now());
  }
  return {
    active: true,
    hardMode: timerState.hardMode,
    paused: timerState.paused,
    remaining,
    totalMinutes: timerState.totalMinutes
  };
}

function stopTimerForcefully() {
  if (!timerState.active) return;
  console.log('[Timer] Forcefully stopping timer due to violation (unguarded browser or AI lost).');
  timerState.active = false;
  timerState.hardMode = false;
  timerState.paused = false;
  clearInterval(timerInterval);
  focusMode = false;
  broadcastToClients(null);
  updateTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('focus-mode-changed', focusMode);
    mainWindow.webContents.send('timer-expired');
  }
}

const clients = new Set();
const connectedBrowsers = new Map(); // ws -> browser name
let isAppBlocked = true;
let isAiReady = false; // Tracks if AI is ready globally
let missingBrowsersList = [];
let missingSince = new Map(); // Tracks when a missing browser was first seen

const BLACKLISTED_APPS = ['facebook.exe', 'twitter.exe', 'x.exe', 'tiktok.exe', 'threads.exe', 'instagram.exe'];

const { exec } = require('child_process');
function getRunningBrowsers() {
  return new Promise(resolve => {
    exec('tasklist /NH /FO CSV', (err, stdout) => {
      if (err) return resolve(new Set());
      const running = new Set();
      const out = stdout.toLowerCase();
      
      if (out.includes('chrome.exe')) running.add('chrome');
      if (out.includes('msedge.exe')) running.add('edge');
      if (out.includes('opera.exe')) running.add('opera');
      if (out.includes('brave.exe')) running.add('brave');
      if (out.includes('firefox.exe')) running.add('firefox');
      if (out.includes('browser.exe')) running.add('coccoc');

      // Native App Killer
      if (timerState.active) {
        for (const app of BLACKLISTED_APPS) {
          if (out.includes(app)) { // Matches "facebook.exe"
            exec(`taskkill /F /IM ${app}`, (kErr) => {
              if (!kErr) console.log(`[FocusGuard] Enforced App Block: Killed ${app}`);
            });
          }
        }
      }

      resolve(running);
    });
  });
}

async function checkGateStatus() {
  const running = await getRunningBrowsers();
  const connected = new Set(Array.from(connectedBrowsers.values()));
  
  const currentlyMissing = [];
  for (const b of running) {
    if (!connected.has(b)) currentlyMissing.push(b);
  }

  // Allow a 10-second grace period for extensions to boot and connect
  const now = Date.now();
  const definitelyMissing = [];
  for (const b of currentlyMissing) {
    if (!missingSince.has(b)) {
      missingSince.set(b, now);
    } else {
      if (now - missingSince.get(b) > 10000) { // 10s grace
        definitelyMissing.push(b);
      }
    }
  }

  // Clean up map for browsers that are no longer missing (either closed or connected)
  for (const b of missingSince.keys()) {
    if (!currentlyMissing.includes(b)) {
      missingSince.delete(b);
    }
  }

  // App is blocked if any running browser is definitely missing the extension
  let valid;
  if (running.size === 0) {
    valid = true; // No browsers running to distract you! You are good.
  } else {
    valid = definitelyMissing.length === 0; 
  }
  
  if (isAppBlocked !== !valid) {
    isAppBlocked = !valid;
    updateTray();
  }
  missingBrowsersList = definitelyMissing;
  extensionConnected = valid; // keep backwards compatibility

  // Tự động tắt Focus Mode và Hủy Timer nếu phát hiện trình duyệt lạ chưa cài Extension
  if (isAppBlocked && focusMode) {
    if (timerState.active) {
      console.log('[FocusGuard] Detected unguarded browser during timer. Force stopping timer.');
      stopTimerForcefully();
    } else {
      console.log('[FocusGuard] Detected unguarded browser. Auto-disabling focus mode.');
      focusMode = false;
      broadcastToClients(null);
      updateTray();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('gate-status', {
      blocked: isAppBlocked,
      missing: missingBrowsersList,
      connected: Array.from(connected)
    });
  }
}
setInterval(checkGateStatus, 3000);

// ===== Background AI Polling (runs only when timer is active) =====
setInterval(async () => {
  if (timerState.active) {
    const status = await aiService.getAiStatus();
    isAiReady = status.ready;
    if (!status.ready) {
      console.log('[AI] AI connection lost during active timer! Force stopping timer.');
      stopTimerForcefully();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai-status-lost');
      }
    }
  }
}, 5000);

// ===== WebSocket Server =====
const wss = new WebSocketServer({ port: WS_PORT }, () => {
  console.log(`[FocusGuard] WebSocket server on ws://localhost:${WS_PORT}`);
});

// Ping interval to keep Chrome MV3 Service Worker alive
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({ type: 'PING' }));
    }
  });
}, 20000); // 20 seconds

wss.on('connection', (ws) => {
  console.log('[FocusGuard] Extension connected');
  clients.add(ws);

  ws.send(JSON.stringify({ type: 'FOCUS_MODE_CHANGED', enabled: focusMode }));

  ws.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === 'EXTENSION_CONNECTED') {
        if (data.browser) connectedBrowsers.set(ws, data.browser);
        checkGateStatus();
        // Send current configs
        ws.send(JSON.stringify({
          type: 'SETTINGS_UPDATED',
          allowedCategories: aiService.getAllowedCategories()
        }));
        // Explicitly send focus mode again just in case
        ws.send(JSON.stringify({ 
          type: 'FOCUS_MODE_CHANGED', 
          enabled: focusMode 
        }));
      }
      if (data.type === 'FOCUS_MODE_CHANGED') {
        focusMode = data.enabled;
        broadcastToClients(ws);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
      }
      // Tier 2: AI classification request from Extension
      if (data.type === 'CLASSIFY_VIDEO' && data.metadata) {
        console.log('[AI] Classification request for:', data.metadata.title);
        try {
          const result = await aiService.classifyVideo(data.metadata);
          console.log('[AI] Result:', result);
          ws.send(JSON.stringify({
            type: 'CLASSIFY_RESULT',
            videoId: data.metadata.videoId,
            result: result.result,
            reason: result.reason,
            provider: result.provider
          }));
        } catch (e) {
          console.error('[AI] Classification error:', e);
          ws.send(JSON.stringify({
            type: 'CLASSIFY_RESULT',
            videoId: data.metadata.videoId,
            result: 'BLOCK',
            reason: 'AI error: ' + e.message,
            provider: 'error'
          }));
        }
      }
    } catch (e) { console.error('[FocusGuard] Parse error:', e); }
  });

  ws.on('close', () => {
    clients.delete(ws);
    connectedBrowsers.delete(ws);
    checkGateStatus();
    console.log('[FocusGuard] Extension disconnected');
  });
});

function broadcastToClients(exclude) {
  const msg = JSON.stringify({ type: 'FOCUS_MODE_CHANGED', enabled: focusMode });
  clients.forEach(c => { if (c !== exclude && c.readyState === 1) c.send(msg); });
}

function broadcastSettings(exclude) {
  const msg = JSON.stringify({
    type: 'SETTINGS_UPDATED',
    allowedCategories: aiService.getAllowedCategories()
  });
  clients.forEach(c => { if (c !== exclude && c.readyState === 1) c.send(msg); });
}

// ===== IPC from Renderer =====
ipcMain.handle('get-focus-mode', () => focusMode);
ipcMain.handle('get-extension-status', async () => {
  await checkGateStatus();
  return !isAppBlocked;
});
ipcMain.handle('get-clients-count', () => clients.size);

// ===== AI Service IPC =====
ipcMain.handle('check-ai-status', async () => {
  const status = await aiService.getAiStatus();
  isAiReady = status.ready;
  updateTray();
  return status;
});

ipcMain.handle('save-groq-key', async (_, key) => {
  aiService.saveGroqKey(key);
  const status = await aiService.getAiStatus();
  isAiReady = status.ready;
  updateTray();
  return status;
});

ipcMain.handle('classify-video', async (_, metadata) => {
  return await aiService.classifyVideo(metadata);
});

// ===== Settings IPC =====
ipcMain.handle('get-allowed-categories', () => {
  return aiService.getAllowedCategories();
});

ipcMain.handle('save-allowed-categories', (_, cats) => {
  aiService.saveAllowedCategories(cats);
  broadcastSettings(null); // Sync to all connected extensions
  return true;
});

ipcMain.handle('toggle-focus-mode', (_, enabled) => {
  // Block turning off focus mode during hard mode
  if (!enabled && timerState.active && timerState.hardMode) {
    return focusMode; // silently refuse
  }
  focusMode = enabled;
  broadcastToClients(null);
  updateTray();
  return focusMode;
});

// ===== Timer IPC =====
ipcMain.handle('start-timer', (_, { minutes, hardMode }) => {
  timerState.active = true;
  timerState.hardMode = !!hardMode;
  timerState.totalMinutes = minutes;
  timerState.endTime = Date.now() + minutes * 60000;
  timerState.remaining = 0;
  timerState.paused = false;
  // Auto-enable focus mode
  focusMode = true;
  broadcastToClients(null);
  updateTray();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
  startTimerTick();
  console.log(`[Timer] Started ${minutes}min, hardMode=${hardMode}`);
  return getTimerStatus();
});

ipcMain.handle('pause-timer', () => {
  if (!timerState.active || timerState.hardMode) return getTimerStatus();
  if (timerState.paused) {
    // Resume
    timerState.endTime = Date.now() + timerState.remaining;
    timerState.paused = false;
    // Re-enable focus mode
    focusMode = true;
    broadcastToClients(null);
    updateTray();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
  } else {
    // Pause
    timerState.remaining = Math.max(0, timerState.endTime - Date.now());
    timerState.paused = true;
    // Pause focus mode too
    focusMode = false;
    broadcastToClients(null);
    updateTray();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
  }
  return getTimerStatus();
});

ipcMain.handle('stop-timer', () => {
  if (!timerState.active) return getTimerStatus();
  if (timerState.hardMode) return getTimerStatus(); // Can't stop in hard mode
  timerState.active = false;
  timerState.paused = false;
  clearInterval(timerInterval);
  focusMode = false;
  broadcastToClients(null);
  updateTray();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
  return getTimerStatus();
});

ipcMain.handle('get-timer-status', () => getTimerStatus());

ipcMain.handle('cancel-timer-afk', () => {
  if (!timerState.active) return getTimerStatus();
  console.log('[Timer] AFK detected by webcam. Force cancelling timer.');
  timerState.active = false;
  timerState.hardMode = false;
  timerState.paused = false;
  clearInterval(timerInterval);
  focusMode = false;
  broadcastToClients(null);
  updateTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('focus-mode-changed', focusMode);
    mainWindow.webContents.send('timer-afk-cancelled');
  }
  return getTimerStatus();
});

ipcMain.handle('open-extensions-page', () => {
  shell.openExternal('https://www.google.com/chrome');
  return true;
});

ipcMain.handle('open-extension-folder', () => {
  const extPath = path.resolve(__dirname, '..', 'browser-extension');
  shell.openPath(extPath);
  return true;
});

ipcMain.handle('hide-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
});

ipcMain.handle('can-close', () => {
  return !(timerState.active && timerState.hardMode);
});

// ===== Electron Window =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 580,
    resizable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open DevTools for debugging (remove in production)
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Send current extension status AFTER renderer is fully loaded
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main] Renderer loaded. Running initial gate check.');
    checkGateStatus();
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

// ===== Tray =====
function createTray() {
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4T2NkoBAwUqifYdQABmI9sOT/f4alDP8ZGIkNJCBfDAYDGEmJRBZGJpABo2EwGAKBmHgAABKeBxHkQxjLAAAAAElFTkSuQmCC'
  );
  tray = new Tray(icon);
  updateTray();
  tray.on('click', () => {
    if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

let trayQuickMinutes = 25;
let trayQuickHardMode = false;

function updateTray() {
  if (!tray) return;

  const ts = getTimerStatus();
  updateTrayTooltipText(); // set hover text based on states

  const menuTemplate = [];

  const isGateBlocked = isAppBlocked || !isAiReady;

  if (isAppBlocked) {
    menuTemplate.push({ label: '⚠️ Đang chờ Extension kết nối...', enabled: false });
    menuTemplate.push({ type: 'separator' });
  } else if (!isAiReady) {
    menuTemplate.push({ label: '⚠️ Chưa kết nối AI (Ollama/Groq)...', enabled: false });
    menuTemplate.push({ type: 'separator' });
  }

  // --- Header Status Info ---
  if (!isGateBlocked) {
    if (ts.active) {
      const m = Math.floor(ts.remaining / 60000);
      const s = String(Math.floor((ts.remaining % 60000) / 1000)).padStart(2, '0');
      let st = `⏱ Thời gian: ${m}:${s}`;
      if (ts.paused) st += ' (Tạm dừng)';
      if (ts.hardMode) st += ' [HARD MODE]';
      menuTemplate.push({ label: st, enabled: false });
    } else if (focusMode) {
      menuTemplate.push({ label: '🛡 Chặn Tự Do (Manual): BẬT', enabled: false });
    } else {
      menuTemplate.push({ label: '🛡 Focus Guard: TẮT', enabled: false });
    }
    menuTemplate.push({ type: 'separator' });
  }

  // --- Dynamic Buttons ---
  if (isGateBlocked) {
    menuTemplate.push({ label: '🚫 Tính năng khóa tạm thời', enabled: false });
  } else if (ts.active) {
    // 1. Timer Active
    if (ts.hardMode) {
      menuTemplate.push({ label: '🔒 Đang trong Hard Mode - Không thể thao tác', enabled: false });
    } else {
      menuTemplate.push({
        label: ts.paused ? '▶ Tiếp Tục Timer' : '⏸ Tạm Dừng Timer',
        click: () => {
          if (ts.paused) {
            timerState.endTime = Date.now() + timerState.remaining;
            timerState.paused = false;
            focusMode = true;
          } else {
            timerState.remaining = Math.max(0, timerState.endTime - Date.now());
            timerState.paused = true;
            focusMode = false;
          }
          broadcastToClients(null);
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
          updateTray();
        }
      });
      menuTemplate.push({
        label: '⏹ Dừng & Hủy Timer',
        click: () => {
          stopTimerForcefully();
        }
      });
    }
  } else if (focusMode) {
    // 2. Manual Active
    menuTemplate.push({
      label: '⏹ Tắt Block Thủ Công',
      click: () => {
        focusMode = false;
        broadcastToClients(null);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
        updateTray();
      }
    });
  } else {
    // 3. No Mode Active
    menuTemplate.push({
      label: '▶ Bật Block Thủ Công',
      click: () => {
        focusMode = true;
        broadcastToClients(null);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
        updateTray();
      }
    });

    // Quick Timer Start Options (using Submenu since native tray cannot embed text inputs)
    menuTemplate.push({
      label: '⏱ Khởi động Timer Nhanh',
      submenu: [
        { label: 'Chọn mức thời gian:', enabled: false },
        { label: '   15 Phút', type: 'radio', checked: trayQuickMinutes === 15, click: () => { trayQuickMinutes = 15; updateTray(); } },
        { label: '   25 Phút', type: 'radio', checked: trayQuickMinutes === 25, click: () => { trayQuickMinutes = 25; updateTray(); } },
        { label: '   45 Phút', type: 'radio', checked: trayQuickMinutes === 45, click: () => { trayQuickMinutes = 45; updateTray(); } },
        { label: '   60 Phút', type: 'radio', checked: trayQuickMinutes === 60, click: () => { trayQuickMinutes = 60; updateTray(); } },
        { type: 'separator' },
        { label: '🔒 Bật Hard Mode', type: 'checkbox', checked: trayQuickHardMode, click: (item) => { trayQuickHardMode = item.checked; updateTray(); } },
        { type: 'separator' },
        { label: '🚀 GÉT GÔ!', click: () => {
          timerState.active = true;
          timerState.hardMode = trayQuickHardMode;
          timerState.totalMinutes = trayQuickMinutes;
          timerState.endTime = Date.now() + trayQuickMinutes * 60000;
          timerState.remaining = 0;
          timerState.paused = false;
          focusMode = true;
          broadcastToClients(null);
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
          startTimerTick();
          updateTray();
        }}
      ]
    });
  }

  menuTemplate.push({ type: 'separator' });
  menuTemplate.push({ label: 'Hiện cửa sổ App', click: () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  }});
  menuTemplate.push({ label: 'Thoát App', click: () => { 
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); 
    mainWindow = null; 
    app.quit(); 
  }});

  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

// ===== App Lifecycle =====
app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', (e) => e.preventDefault());
