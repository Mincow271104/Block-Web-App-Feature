const toggle = document.getElementById('focus-toggle');
const statusText = document.getElementById('status-text');
const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');

// Load current state
chrome.runtime.sendMessage({ type: 'GET_FOCUS_MODE' }, (res) => {
  if (res) updateUI(res.focusMode);
});

// Check Desktop App connection
chrome.runtime.sendMessage({ type: 'GET_CONNECTION_STATUS' }, (res) => {
  if (res) {
    connDot.className = 'conn-dot ' + (res.connected ? 'connected' : 'disconnected');
    connText.textContent = 'Desktop App: ' + (res.connected ? 'Đã kết nối ✓' : 'Chưa kết nối');
  }
});

// Toggle handler
toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  chrome.runtime.sendMessage({ type: 'TOGGLE_FOCUS_MODE', enabled }, (res) => {
    if (res) updateUI(res.focusMode);
  });
});

function updateUI(enabled) {
  toggle.checked = enabled;
  statusText.textContent = enabled ? 'Đang BẬT — Chặn video giải trí' : 'Đang tắt — Xem tự do';
  statusText.className = 'status-text' + (enabled ? ' active' : '');
}
