/* ===== Focus Guard — Background Service Worker ===== */

let focusMode = false;
let wsConnection = null;
let wsReconnectTimer = null;

// --- Initialize state from storage ---
chrome.storage.local.get(['focusMode'], (result) => {
  focusMode = result.focusMode || false;
});

function getAgent() {
  const ua = navigator.userAgent;
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('OPR/') || ua.includes('Opera/')) return 'opera';
  if (ua.includes('Brave/')) return 'brave';
  if (ua.includes('coc_coc_browser')) return 'coccoc';
  if (ua.includes('Chrome/')) return 'chrome';
  if (ua.includes('Firefox/')) return 'firefox';
  return 'unknown';
}

// --- WebSocket connection to Desktop App ---
function connectToDesktopApp() {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }

  // Don't create a new connection if one is already open/connecting
  if (wsConnection && (wsConnection.readyState === WebSocket.OPEN || wsConnection.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    wsConnection = new WebSocket('ws://localhost:8765');

    wsConnection.onopen = () => {
      console.log('[FocusGuard] Connected to Desktop App');
      wsConnection.send(JSON.stringify({ type: 'EXTENSION_CONNECTED', focusMode, browser: getAgent() }));
    };

    wsConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'FOCUS_MODE_CHANGED') {
          focusMode = data.enabled;
          chrome.storage.local.set({ focusMode });
          broadcastFocusMode();
        }
      } catch (e) { /* ignore parse errors */ }
    };

    wsConnection.onclose = () => {
      wsConnection = null;
      console.log('[FocusGuard] Desktop App disconnected. Disabling focus mode.');
      
      // Auto-disable focus mode when app closes
      if (focusMode) {
        focusMode = false;
        chrome.storage.local.set({ focusMode });
        broadcastFocusMode();
      }

      // Reconnect after 10 seconds (longer interval to reduce spam)
      wsReconnectTimer = setTimeout(connectToDesktopApp, 10000);
    };

    wsConnection.onerror = () => {
      // Close will fire after error, which handles reconnection
    };
  } catch (e) {
    wsReconnectTimer = setTimeout(connectToDesktopApp, 10000);
  }
}

connectToDesktopApp();

// Keep service worker alive & reconnect periodically
chrome.alarms.create('keepAlive', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      connectToDesktopApp();
    }
  }
});

// --- Message handling (popup + content scripts) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_FOCUS_MODE':
      sendResponse({ focusMode });
      return true;

    case 'TOGGLE_FOCUS_MODE':
      focusMode = message.enabled;
      chrome.storage.local.set({ focusMode });
      broadcastFocusMode();
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send(JSON.stringify({ type: 'FOCUS_MODE_CHANGED', enabled: focusMode }));
      }
      sendResponse({ focusMode });
      return true;

    case 'VIDEO_BLOCKED':
      console.log(`[FocusGuard] Blocked: "${message.title}" (${message.category})`);
      return true;

    case 'GET_CONNECTION_STATUS':
      sendResponse({ connected: !!(wsConnection && wsConnection.readyState === WebSocket.OPEN) });
      return true;
  }
});

function broadcastFocusMode() {
  chrome.tabs.query({ url: ['*://www.youtube.com/*', '*://youtube.com/*'] }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'FOCUS_MODE_CHANGED', enabled: focusMode }, () => {
        void chrome.runtime.lastError;
      });
    });
  });
}
