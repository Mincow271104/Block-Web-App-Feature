console.log('[app.js] Script starting...');

const api = window.focusAPI;
console.log('[app.js] focusAPI available:', !!api);

if (!api) {
  document.body.innerHTML = '<h1 style="color:red;padding:40px;">ERROR: focusAPI not found. Preload script failed.</h1>';
  throw new Error('focusAPI not available');
}

// --- Elements ---
const screenCheck = document.getElementById('screen-check');
const screenMain = document.getElementById('screen-main');
const btnOpenFolder = document.getElementById('btn-open-folder');
const btnRecheck = document.getElementById('btn-recheck');
const checkStatus = document.getElementById('check-status');

const focusBtn = document.getElementById('focus-btn');
const modeLabel = document.getElementById('mode-label');
const shield = document.getElementById('shield');
const clientsCount = document.getElementById('clients-count');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');

let focusMode = false;
let onMainScreen = false;

// ===== Auto-detect from main process =====
api.onGateStatusChanged((status) => {
  console.log('[app.js] gate-status event:', status);
  if (!status.blocked) {
    showMainScreen();
  } else {
    showCheckScreen(status);
  }
});

// ===== Check Screen =====
function showCheckScreen(status) {
  console.log('[app.js] showCheckScreen()');
  onMainScreen = false;
  screenCheck.classList.remove('hidden');
  screenMain.classList.add('hidden');
  
  if (status && status.missing && status.missing.length > 0) {
    const names = status.missing.map(n => n.toUpperCase()).join(', ');
    checkStatus.innerHTML = `⚠️ Phát hiện <strong>${names}</strong> đang mở nhưng chưa cài (hoặc chưa bật) Focus Guard.`;
    checkStatus.style.color = '#ff6b6b';
  } else {
    checkStatus.textContent = 'Đang chờ kết nối extension từ trình duyệt...';
    checkStatus.style.color = '';
  }
}

function showMainScreen() {
  console.log('[app.js] showMainScreen()');
  if (onMainScreen) return;
  onMainScreen = true;
  screenCheck.classList.add('hidden');
  screenMain.classList.remove('hidden');
  initMainScreen();
}

btnOpenFolder.addEventListener('click', () => {
  console.log('[app.js] Open folder clicked');
  api.openExtensionFolder();
});

btnRecheck.addEventListener('click', async () => {
  console.log('[app.js] Recheck clicked');
  checkStatus.textContent = '🔄 Đang kiểm tra...';
  try {
    const connected = await api.getExtensionStatus();
    console.log('[app.js] Recheck result:', connected);
    if (connected) {
      showMainScreen();
    } else {
      checkStatus.textContent = '❌ Chưa phát hiện extension. Hãy tải extension vào Chrome rồi thử lại.';
    }
  } catch (err) {
    console.error('[app.js] Recheck error:', err);
    checkStatus.textContent = '❌ Lỗi: ' + err.message;
  }
});

// ===== Main Screen =====
async function initMainScreen() {
  try {
    focusMode = await api.getFocusMode();
    updateUI();
    refreshClients();
  } catch (err) {
    console.error('[app.js] initMainScreen error:', err);
  }
}

focusBtn.addEventListener('click', async () => {
  focusMode = !focusMode;
  await api.toggleFocusMode(focusMode);
  updateUI();
});

api.onFocusModeChanged((val) => {
  focusMode = val;
  updateUI();
});

function updateUI() {
  if (focusMode) {
    modeLabel.textContent = 'Chế độ tập trung: ĐANG BẬT';
    modeLabel.className = 'toggle-label active';
    focusBtn.querySelector('.btn-text').textContent = 'Tắt Focus Mode';
    focusBtn.className = 'focus-btn active';
    shield.className = 'shield active';
  } else {
    modeLabel.textContent = 'Chế độ tập trung: TẮT';
    modeLabel.className = 'toggle-label';
    focusBtn.querySelector('.btn-text').textContent = 'Bật Focus Mode';
    focusBtn.className = 'focus-btn';
    shield.className = 'shield';
  }
}

async function refreshClients() {
  const count = await api.getClientsCount();
  clientsCount.textContent = `Extension: ${count} kết nối`;
}

// ===== Window controls =====
btnMinimize.addEventListener('click', () => api.hideWindow());
btnClose.addEventListener('click', () => api.hideWindow());

console.log('[app.js] Script fully loaded. All listeners registered.');
