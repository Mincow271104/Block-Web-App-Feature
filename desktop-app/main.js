const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } = require('electron');
const { WebSocketServer } = require('ws');
const path = require('path');

let mainWindow = null;
let tray = null;
let focusMode = false;
let extensionConnected = false;
const WS_PORT = 8765;

const clients = new Set();
const connectedBrowsers = new Map(); // ws -> browser name
let isAppBlocked = true;
let missingBrowsersList = [];

// ===== OS Browser Detection =====
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
      resolve(running);
    });
  });
}

async function checkGateStatus() {
  const running = await getRunningBrowsers();
  const connected = new Set(Array.from(connectedBrowsers.values()));
  
  const missing = [];
  for (const b of running) {
    if (!connected.has(b)) missing.push(b);
  }

  // App is blocked if ANY running browser is missing the extension, 
  // or if NO browsers are running BUT there are also no connections (to force them to install it first)
  let valid = missing.length === 0 && connectedBrowsers.size > 0;
  
  missingBrowsersList = missing;
  isAppBlocked = !valid;
  extensionConnected = valid; // keep backwards compatibility

  // Tự động tắt Focus Mode nếu phát hiện trình duyệt lạ chưa cài Extension
  if (isAppBlocked && focusMode) {
    console.log('[FocusGuard] Detected unguarded browser. Auto-disabling focus mode.');
    focusMode = false;
    broadcastToClients(null);
    updateTray();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('gate-status', {
      blocked: isAppBlocked,
      missing: missing,
      connected: Array.from(connected)
    });
  }
}
setInterval(checkGateStatus, 3000);

// ===== WebSocket Server =====
const wss = new WebSocketServer({ port: WS_PORT }, () => {
  console.log(`[FocusGuard] WebSocket server on ws://localhost:${WS_PORT}`);
});

wss.on('connection', (ws) => {
  console.log('[FocusGuard] Extension connected');
  clients.add(ws);

  ws.send(JSON.stringify({ type: 'FOCUS_MODE_CHANGED', enabled: focusMode }));

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === 'EXTENSION_CONNECTED') {
        if (data.browser) connectedBrowsers.set(ws, data.browser);
        checkGateStatus();
      }
      if (data.type === 'FOCUS_MODE_CHANGED') {
        focusMode = data.enabled;
        broadcastToClients(ws);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
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

// ===== IPC from Renderer =====
ipcMain.handle('get-focus-mode', () => focusMode);
ipcMain.handle('get-extension-status', async () => {
  await checkGateStatus();
  return !isAppBlocked;
});
ipcMain.handle('get-clients-count', () => clients.size);

ipcMain.handle('toggle-focus-mode', (_, enabled) => {
  focusMode = enabled;
  broadcastToClients(null);
  updateTray();
  return focusMode;
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

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`Focus Guard — ${focusMode ? 'ĐANG BẬT' : 'Đang tắt'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Chế độ tập trung: ${focusMode ? 'BẬT ✓' : 'TẮT'}`, enabled: false },
    { type: 'separator' },
    { label: focusMode ? 'Tắt Focus Mode' : 'Bật Focus Mode', click: () => {
      if (!extensionConnected) return;
      focusMode = !focusMode;
      broadcastToClients(null);
      updateTray();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('focus-mode-changed', focusMode);
    }},
    { label: 'Hiện cửa sổ', click: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    }},
    { type: 'separator' },
    { label: 'Thoát', click: () => { 
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); 
      mainWindow = null; 
      app.quit(); 
    } }
  ]));
}

// ===== App Lifecycle =====
app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('window-all-closed', (e) => e.preventDefault());
