console.log('[app.js] Script starting...');

const api = window.focusAPI;
console.log('[app.js] focusAPI available:', !!api);

if (!api) {
  document.body.innerHTML = '<h1 style="color:red;padding:40px;">ERROR: focusAPI not found. Preload script failed.</h1>';
  throw new Error('focusAPI not available');
}

// --- Elements ---
const screenCheck = document.getElementById('screen-check');
const screenAi = document.getElementById('screen-ai');
const screenMain = document.getElementById('screen-main');
const screenSettings = document.getElementById('screen-settings');

// Check screen
const btnOpenFolder = document.getElementById('btn-open-folder');
const btnRecheck = document.getElementById('btn-recheck');
const checkStatus = document.getElementById('check-status');

// AI screen
const ollamaBadge = document.getElementById('ollama-badge');
const groqBadge = document.getElementById('groq-badge');
const groqKeyInput = document.getElementById('groq-key');
const btnSaveGroq = document.getElementById('btn-save-groq');
const btnAiRecheck = document.getElementById('btn-ai-recheck');
const aiStatusMsg = document.getElementById('ai-status-msg');
const aiOllamaEl = document.getElementById('ai-ollama');
const aiGroqEl = document.getElementById('ai-groq');

// Main screen
const shield = document.getElementById('shield');
const clientsCount = document.getElementById('clients-count');
const aiProviderText = document.getElementById('ai-provider-text');
const btnMinimize = document.getElementById('btn-minimize');
const btnClose = document.getElementById('btn-close');
const btnSettings = document.getElementById('btn-settings');

// Timer elements
const timerSetup = document.getElementById('timer-setup');
const timerActive = document.getElementById('timer-active');
const timerMinutesInput = document.getElementById('timer-minutes');
const manualFocusToggle = document.getElementById('manual-focus-toggle');
const hardModeToggle = document.getElementById('hard-mode-toggle');
const hardModeHint = document.getElementById('hard-mode-hint');
const btnStartTimer = document.getElementById('btn-start-timer');
const countdownTime = document.getElementById('countdown-time');
const countdownLabel = document.getElementById('countdown-label');
const btnPauseTimer = document.getElementById('btn-pause-timer');
const btnStopTimer = document.getElementById('btn-stop-timer');
const hardModeBadge = document.getElementById('hard-mode-badge');
const webcamVideo = document.getElementById('webcam-video');
const webcamStatus = document.getElementById('webcam-status');

// Settings screen
const btnBack = document.getElementById('btn-back');
const btnSaveSettings = document.getElementById('btn-save-settings');
const categoryGrid = document.getElementById('category-grid');

let focusMode = false;
let currentScreen = 'check'; // 'check' | 'ai' | 'main' | 'settings'
let countdownInterval = null;

// ==========================================
// SCREEN NAVIGATION
// ==========================================
function showScreen(name) {
  currentScreen = name;
  screenCheck.classList.toggle('hidden', name !== 'check');
  screenAi.classList.toggle('hidden', name !== 'ai');
  screenMain.classList.toggle('hidden', name !== 'main');
  screenSettings.classList.toggle('hidden', name !== 'settings');
  console.log('[app.js] Screen →', name);
}

// ==========================================
// SCREEN 1: EXTENSION GATE
// ==========================================
api.onGateStatusChanged((status) => {
  // console.log('[app.js] gate-status:', status);
  if (!status.blocked) {
    // Extension gate passed → go to AI gate
    if (currentScreen === 'check') {
      showScreen('ai');
      checkAiAndProceed();
    }
  } else {
    showScreen('check');
    if (status.missing && status.missing.length > 0) {
      const names = status.missing.map(n => n.toUpperCase()).join(', ');
      checkStatus.innerHTML = `⚠️ Phát hiện <strong>${names}</strong> đang mở nhưng chưa cài Focus Guard.`;
      checkStatus.style.color = '#ff6b6b';
    } else {
      checkStatus.textContent = 'Đang chờ kết nối extension từ trình duyệt...';
      checkStatus.style.color = '';
    }
  }
});

btnOpenFolder.addEventListener('click', () => api.openExtensionFolder());
btnRecheck.addEventListener('click', async () => {
  checkStatus.textContent = '🔄 Đang kiểm tra...';
  const connected = await api.getExtensionStatus();
  if (connected) {
    showScreen('ai');
    checkAiAndProceed();
  } else {
    checkStatus.textContent = '❌ Chưa phát hiện extension.';
  }
});

// ==========================================
// SCREEN 2: AI GATE
// ==========================================
async function checkAiAndProceed() {
  ollamaBadge.textContent = 'Đang kiểm tra...';
  ollamaBadge.className = 'ai-status-badge';
  groqBadge.textContent = 'Đang kiểm tra...';
  groqBadge.className = 'ai-status-badge';
  aiStatusMsg.textContent = '⏳ Đang kiểm tra kết nối AI...';

  try {
    const status = await api.checkAiStatus();
    console.log('[app.js] AI status:', status);
    updateAiBadges(status);

    if (status.ready) {
      aiStatusMsg.textContent = '✅ AI sẵn sàng!';
      // Auto-proceed to main after a short delay
      setTimeout(() => {
        if (currentScreen === 'ai') {
          showScreen('main');
          initMainScreen(status);
        }
      }, 800);
    } else {
      aiStatusMsg.textContent = '⚠️ Cần ít nhất 1 AI provider để tiếp tục.';
    }
  } catch (err) {
    console.error('[app.js] AI check error:', err);
    aiStatusMsg.textContent = '❌ Lỗi kiểm tra AI: ' + err.message;
  }
}

function updateAiBadges(status) {
  // Ollama
  if (status.ollama.available && status.ollama.hasModel) {
    ollamaBadge.textContent = '✓ Sẵn sàng';
    ollamaBadge.className = 'ai-status-badge ok';
    aiOllamaEl.className = 'ai-provider connected';
  } else if (status.ollama.available) {
    ollamaBadge.textContent = 'Thiếu model';
    ollamaBadge.className = 'ai-status-badge warn';
    aiOllamaEl.className = 'ai-provider error';
  } else {
    ollamaBadge.textContent = 'Không chạy';
    ollamaBadge.className = 'ai-status-badge err';
    aiOllamaEl.className = 'ai-provider error';
  }

  // Groq
  if (status.groq.available) {
    groqBadge.textContent = '✓ Sẵn sàng';
    groqBadge.className = 'ai-status-badge ok';
    aiGroqEl.className = 'ai-provider connected';
  } else if (status.groq.reason === 'invalid_key') {
    groqBadge.textContent = 'Key không hợp lệ';
    groqBadge.className = 'ai-status-badge err';
    aiGroqEl.className = 'ai-provider error';
  } else {
    groqBadge.textContent = 'Chưa có key';
    groqBadge.className = 'ai-status-badge warn';
    aiGroqEl.className = 'ai-provider';
  }
}

btnSaveGroq.addEventListener('click', async () => {
  const key = groqKeyInput.value.trim();
  if (!key) return;
  btnSaveGroq.textContent = '...';
  try {
    const status = await api.saveGroqKey(key);
    updateAiBadges(status);
    if (status.ready) {
      aiStatusMsg.textContent = '✅ AI sẵn sàng!';
      setTimeout(() => {
        if (currentScreen === 'ai') {
          showScreen('main');
          initMainScreen(status);
        }
      }, 800);
    }
  } catch (err) {
    aiStatusMsg.textContent = '❌ Lỗi: ' + err.message;
  }
  btnSaveGroq.textContent = 'Lưu';
});

btnAiRecheck.addEventListener('click', () => checkAiAndProceed());

// ==========================================
// SCREEN 3: MAIN APP (Timer-based)
// ==========================================
async function initMainScreen(aiStatus) {
  try {
    refreshClients();
    // Show AI provider info
    if (aiStatus) {
      const provider = aiStatus.activeProvider === 'ollama' ? '🦙 Ollama (Local)'
        : aiStatus.activeProvider === 'groq' ? '⚡ Groq (Cloud)' : '❌ Không có';
      aiProviderText.textContent = `AI: ${provider}`;
    }
    // Check if timer is already running (e.g. window was hidden and reshown)
    const ts = await api.getTimerStatus();
    if (ts.active) {
      showTimerActive(ts);
    } else {
      showTimerSetup();
    }
  } catch (err) {
    console.error('[app.js] initMainScreen error:', err);
  }
}

// Hard mode toggle hint
hardModeToggle.addEventListener('change', () => {
  if (hardModeToggle.checked) {
    hardModeHint.textContent = '🔒 Hard Mode bật: Không thể tạm dừng hoặc tắt cho đến khi hết giờ!';
    hardModeHint.style.color = '#ef4444';
  } else {
    hardModeHint.textContent = 'Hard Mode tắt: Bạn có thể tạm dừng hoặc tắt bất cứ lúc nào.';
    hardModeHint.style.color = '';
  }
});

// Manual focus mode toggle
manualFocusToggle.addEventListener('change', async () => {
  focusMode = manualFocusToggle.checked;
  await api.toggleFocusMode(focusMode);
  shield.className = focusMode ? 'shield active' : 'shield';
});

// Start timer
btnStartTimer.addEventListener('click', async () => {
  const minutes = parseInt(timerMinutesInput.value, 10);
  if (!minutes || minutes < 1) return;
  const hardMode = hardModeToggle.checked;
  const ts = await api.startTimer({ minutes, hardMode });
  showTimerActive(ts);
  startFaceTracking();
});

// Pause/Resume timer
btnPauseTimer.addEventListener('click', async () => {
  const ts = await api.pauseTimer();
  updateTimerUI(ts);
  if (ts.paused) {
    stopFaceTracking();
  } else {
    startFaceTracking();
  }
});

// Stop timer
btnStopTimer.addEventListener('click', async () => {
  const ts = await api.stopTimer();
  if (!ts.active) {
    showTimerSetup();
  }
});

// Timer expired event from main process
api.onTimerExpired(() => {
  stopFaceTracking();
  showTimerSetup();
  shield.className = 'shield';
});

// AFK cancelled event from main process
api.onTimerAfkCancelled(() => {
  stopFaceTracking();
  showTimerSetup();
  shield.className = 'shield';
});

// AI lost during timer session
api.onAiStatusLost(() => {
  stopFaceTracking();
  showScreen('ai');
  checkAiAndProceed();
});

api.onFocusModeChanged((val) => {
  focusMode = val;
  shield.className = val ? 'shield active' : 'shield';
  if (manualFocusToggle) manualFocusToggle.checked = val;
});

function showTimerSetup() {
  timerSetup.classList.remove('hidden');
  timerActive.classList.add('hidden');
  shield.className = 'shield';
  clearInterval(countdownInterval);
  stopFaceTracking();
}

function showTimerActive(ts) {
  timerSetup.classList.add('hidden');
  timerActive.classList.remove('hidden');
  shield.className = 'shield active';

  if (ts.hardMode) {
    hardModeBadge.classList.remove('hidden');
    btnPauseTimer.classList.add('hidden');
    btnStopTimer.classList.add('hidden');
  } else {
    hardModeBadge.classList.add('hidden');
    btnPauseTimer.classList.remove('hidden');
    btnStopTimer.classList.remove('hidden');
  }

  updateTimerUI(ts);
  startCountdownUI();
}

function startCountdownUI() {
  clearInterval(countdownInterval);
  countdownInterval = setInterval(async () => {
    const ts = await api.getTimerStatus();
    if (!ts.active) {
      showTimerSetup();
      return;
    }
    updateTimerUI(ts);
  }, 1000);
}

function updateTimerUI(ts) {
  if (!ts.active) return;
  const totalSec = Math.ceil(ts.remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const timeStr = h > 0 
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${m}:${String(s).padStart(2,'0')}`;
  countdownTime.textContent = timeStr;

  if (ts.paused) {
    countdownTime.className = 'countdown-time paused';
    countdownLabel.textContent = '⏸ tạm dừng';
    btnPauseTimer.textContent = '▶ Tiếp Tục';
  } else if (ts.hardMode) {
    countdownTime.className = 'countdown-time hard';
    countdownLabel.textContent = '🔒 hard mode — không thể dừng';
  } else {
    countdownTime.className = 'countdown-time';
    countdownLabel.textContent = 'đang tập trung...';
    btnPauseTimer.textContent = '⏸ Tạm Dừng';
  }
}

async function refreshClients() {
  const count = await api.getClientsCount();
  clientsCount.textContent = `Extension: ${count} kết nối`;
}

// ===== Window controls =====
btnMinimize.addEventListener('click', () => api.hideWindow());
btnClose.addEventListener('click', () => api.hideWindow());

// ==========================================
// SCREEN 4: SETTINGS
// ==========================================
const YOUTUBE_CATEGORIES = [
  'Education', 'Science & Technology', 'Music', 'Gaming', 
  'Entertainment', 'Comedy', 'Film & Animation', 'Sports',
  'Movies', 'Shows', 'Trailers', 'Howto & Style', 
  'News & Politics', 'Nonprofits & Activism', 'Travel & Events'
];

let selectedCategories = [];

btnSettings.addEventListener('click', async () => {
  try {
    selectedCategories = await api.getAllowedCategories();
  } catch(e) {
    selectedCategories = ['Education', 'Science & Technology'];
  }
  renderSettings();
  showScreen('settings');
});

btnBack.addEventListener('click', () => {
  showScreen('main');
});

btnSaveSettings.addEventListener('click', async () => {
  btnSaveSettings.textContent = 'Đang lưu...';
  try {
    await api.saveAllowedCategories(selectedCategories);
    setTimeout(() => {
      btnSaveSettings.textContent = 'Lưu Cài Đặt';
      showScreen('main');
    }, 400);
  } catch (err) {
    btnSaveSettings.textContent = 'Lỗi!';
    console.error(err);
  }
});

function renderSettings() {
  categoryGrid.innerHTML = '';
  YOUTUBE_CATEGORIES.forEach(cat => {
    const isSelected = selectedCategories.includes(cat);
    const item = document.createElement('div');
    item.className = `cat-item ${isSelected ? 'selected' : ''}`;
    
    // Checkbox input
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = isSelected;
    
    // Label span
    const span = document.createElement('span');
    span.textContent = cat;
    
    item.appendChild(input);
    item.appendChild(span);
    
    item.addEventListener('click', () => {
      input.checked = !input.checked;
      if (input.checked) {
        item.classList.add('selected');
        if (!selectedCategories.includes(cat)) selectedCategories.push(cat);
      } else {
        item.classList.remove('selected');
        selectedCategories = selectedCategories.filter(c => c !== cat);
      }
    });
    
    categoryGrid.appendChild(item);
  });
}

console.log('[app.js] Script fully loaded. All listeners registered.');

// ==========================================
// FACE TRACKING INTEGRATION
// ==========================================
function startFaceTracking() {
  if (!window.FaceTracker) {
    console.warn('[app.js] FaceTracker not available.');
    webcamStatus.textContent = '⚠️ Không tìm thấy module FaceTracker';
    webcamStatus.className = 'webcam-status error';
    return;
  }

  webcamStatus.textContent = '📷 Đang khởi động cam...';
  webcamStatus.className = 'webcam-status';

  window.FaceTracker.startTracking(webcamVideo, {
    onStatusUpdate: (status, afkElapsed) => {
      if (status === 'tracking') {
        webcamStatus.textContent = '👤 Đang theo dõi';
        webcamStatus.className = 'webcam-status tracking';
        webcamVideo.className = '';
      } else if (status === 'warning') {
        const secsAway = Math.floor(afkElapsed / 1000);
        const minsAway = Math.floor(secsAway / 60);
        const secsRem = secsAway % 60;
        const remaining = 5 * 60 - secsAway;
        const remMins = Math.floor(remaining / 60);
        const remSecs = remaining % 60;
        webcamStatus.textContent = `⚠️ Không phát hiện (hủy sau ${remMins}:${String(remSecs).padStart(2,'0')})`;
        webcamStatus.className = 'webcam-status warning';
        webcamVideo.className = 'warning';
      } else if (status === 'error') {
        const errMsg = afkElapsed ? (afkElapsed.message || afkElapsed.name || String(afkElapsed)) : 'Cam không hoạt động';
        webcamStatus.textContent = '⚠️ Lỗi: ' + errMsg;
        webcamStatus.className = 'webcam-status error';
      }
    },
    onAfkTimeout: async () => {
      console.log('[app.js] AFK timeout detected! Cancelling timer...');
      await api.cancelTimerAfk();
    }
  });
}

function stopFaceTracking() {
  if (window.FaceTracker && window.FaceTracker.getIsTracking()) {
    window.FaceTracker.stopTracking();
  }
  webcamStatus.textContent = '';
  webcamStatus.className = 'webcam-status';
  webcamVideo.className = '';
}
