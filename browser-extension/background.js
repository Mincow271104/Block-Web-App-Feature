/* ===== Focus Guard — Background Service Worker ===== */

let focusMode = false;
let wsConnection = null;
let wsReconnectTimer = null;

// Pending AI classification callbacks: videoId -> { tabId, resolve }
const pendingClassifications = new Map();

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
        // AI classification result from Desktop App
        if (data.type === 'CLASSIFY_RESULT' && data.videoId) {
          console.log('[FocusGuard] AI result:', data.videoId, data.result);
          const pending = pendingClassifications.get(data.videoId);
          if (pending) {
            // Send result to the content script tab
            chrome.tabs.sendMessage(pending.tabId, {
              type: 'CLASSIFY_RESULT',
              videoId: data.videoId,
              result: data.result,
              reason: data.reason || ''
            }, () => { void chrome.runtime.lastError; });
            pendingClassifications.delete(data.videoId);
          }
        }
        // Settings update from Desktop App
        if (data.type === 'SETTINGS_UPDATED' && data.allowedCategories) {
          console.log('[FocusGuard] Settings updated:', data.allowedCategories);
          chrome.storage.local.set({ allowedCategories: data.allowedCategories });
          broadcastSettings(data.allowedCategories);
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
      console.log(`[FocusGuard] Blocked: (${message.category})`);
      return true;

    case 'GET_CONNECTION_STATUS':
      sendResponse({ connected: !!(wsConnection && wsConnection.readyState === WebSocket.OPEN) });
      return true;

    // Tier 2: Forward classification request to Desktop App via WebSocket
    case 'CLASSIFY_VIDEO':
      if (wsConnection && wsConnection.readyState === WebSocket.OPEN && message.metadata) {
        const videoId = message.metadata.videoId;
        // Track which tab requested this
        pendingClassifications.set(videoId, { tabId: sender.tab.id });
        wsConnection.send(JSON.stringify({
          type: 'CLASSIFY_VIDEO',
          metadata: message.metadata
        }));
        console.log('[FocusGuard] Sent classification request for:', message.metadata.title);
      } else {
        // No WebSocket → default BLOCK
        if (sender.tab) {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'CLASSIFY_RESULT',
            videoId: message.metadata?.videoId || '',
            result: 'BLOCK',
            reason: 'No AI connection'
          }, () => { void chrome.runtime.lastError; });
        }
      }
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

function broadcastSettings(categories) {
  chrome.tabs.query({ url: ['*://www.youtube.com/*', '*://youtube.com/*'] }, (tabs) => {
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_UPDATED', allowedCategories: categories }, () => {
        void chrome.runtime.lastError;
      });
    });
  });
}
