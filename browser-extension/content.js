(function () {
  'use strict';

  /* ===== STATE ===== */
  let focusMode = false;
  let currentVideoId = null;
  let overlayEl = null;
  let pauseInterval = null;

  /* ===== CLASSIFICATION CONFIG ===== */
  const BLOCKED_CATEGORIES = [
    'Gaming', 'Music', 'Entertainment', 'Comedy',
    'Film & Animation', 'Sports', 'Movies', 'Shows', 'Trailers'
  ];
  const ALLOWED_CATEGORIES = [
    'Education', 'Science & Technology', 'Howto & Style',
    'News & Politics', 'Nonprofits & Activism', 'Travel & Events'
  ];

  let channelWhitelist = [];
  let channelBlacklist = [];

  // Cache: videoId -> { result: 'ALLOW'|'BLOCK', data: {...} }
  const cache = {};

  /* ===== INIT ===== */
  fetch(chrome.runtime.getURL('data/channels.json'))
    .then(r => r.json())
    .then(d => { channelWhitelist = d.whitelist || []; channelBlacklist = d.blacklist || []; })
    .catch(() => {});

  chrome.runtime.sendMessage({ type: 'GET_FOCUS_MODE' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res) { focusMode = res.focusMode; checkPage(); }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'FOCUS_MODE_CHANGED') {
      focusMode = msg.enabled;
      focusMode ? checkPage() : cleanup();
    }
  });

  // YouTube SPA navigation
  document.addEventListener('yt-navigate-finish', () => {
    cleanup();
    currentVideoId = null;
    setTimeout(checkPage, 1000);
  });

  // Fallback URL observer
  let lastUrl = location.href;
  const obs = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      cleanup();
      currentVideoId = null;
      setTimeout(checkPage, 1000);
    }
  });
  if (document.body) obs.observe(document.body, { subtree: true, childList: true });

  /* ===== CORE ===== */
  function getVideoIdFromUrl() {
    return new URLSearchParams(location.search).get('v');
  }

  function checkPage() {
    if (!focusMode) { cleanup(); return; }
    if (location.pathname !== '/watch') { cleanup(); currentVideoId = null; return; }

    const vid = getVideoIdFromUrl();
    if (!vid) return;

    currentVideoId = vid;

    // If already cached, apply immediately
    if (cache[vid]) {
      apply(cache[vid].result, cache[vid].data);
      return;
    }

    // Request data from extractor.js (MAIN world)
    window.dispatchEvent(new CustomEvent('__fg_extract__'));
  }

  // Listen for data from extractor.js (MAIN world)
  window.addEventListener('__fg_data__', (e) => {
    try {
      const d = JSON.parse(e.detail);
      if (!d.videoId || !d.title) return;

      // Only process if this video ID matches what's currently in the URL
      const urlVid = getVideoIdFromUrl();
      if (d.videoId !== urlVid) return;

      // If already cached with valid data, DON'T overwrite
      if (cache[d.videoId] && cache[d.videoId].data && cache[d.videoId].data.title) return;

      console.log('[FocusGuard] Video:', d.title, '| Category:', d.category, '| Channel:', d.author);
      const r = classify(d);
      console.log('[FocusGuard] Result:', r);

      // Cache it
      cache[d.videoId] = { result: r, data: d };

      // Apply only if this is still the current video
      if (d.videoId === currentVideoId) {
        apply(r, d);
      }
    } catch (err) { console.error('[FocusGuard]', err); }
  });

  function classify(d) {
    if (d.channelId && channelWhitelist.some(c => c.id === d.channelId)) return 'ALLOW';
    if (d.author) {
      const a = d.author.toLowerCase();
      if (channelWhitelist.some(c => c.name.toLowerCase() === a)) return 'ALLOW';
    }
    if (d.channelId && channelBlacklist.some(c => c.id === d.channelId)) return 'BLOCK';
    if (d.author) {
      const a = d.author.toLowerCase();
      if (channelBlacklist.some(c => c.name.toLowerCase() === a)) return 'BLOCK';
    }
    if (d.category) {
      if (ALLOWED_CATEGORIES.includes(d.category)) return 'ALLOW';
      if (BLOCKED_CATEGORIES.includes(d.category)) return 'BLOCK';
    }
    return 'ALLOW';
  }

  function apply(result, data) {
    if (!focusMode) { cleanup(); return; }
    if (result === 'BLOCK') {
      showOverlay(data);
      keepPaused();
      chrome.runtime.sendMessage({
        type: 'VIDEO_BLOCKED', videoId: currentVideoId,
        category: data?.category || ''
      }, () => { void chrome.runtime.lastError; });
    } else {
      cleanup();
    }
  }

  /* ===== OVERLAY ===== */
  function showOverlay(data) {
    removeOverlay();
    const container = document.querySelector('#movie_player')
      || document.querySelector('.html5-video-player')
      || document.querySelector('#player-container-inner');
    if (!container) return;

    const cat = esc(data?.category || 'Giải trí');

    overlayEl = document.createElement('div');
    overlayEl.id = 'focusguard-overlay';
    overlayEl.innerHTML = `
      <div class="fg-backdrop"></div>
      <div class="fg-card">
        <div class="fg-icon">🛡️</div>
        <h2 class="fg-heading">Video Bị Chặn</h2>
        <div class="fg-divider"></div>
        <div class="fg-meta">
          <span class="fg-tag">${cat}</span>
        </div>
        <p class="fg-msg">Video này thuộc danh mục giải trí và bị chặn trong giờ học tập.<br/>Hãy tập trung vào việc học! 📚</p>
      </div>`;
    container.style.position = 'relative';
    container.appendChild(overlayEl);
  }

  function removeOverlay() {
    const el = document.getElementById('focusguard-overlay');
    if (el) el.remove();
    overlayEl = null;
  }

  function keepPaused() {
    clearInterval(pauseInterval);
    const muteAndPause = () => {
      if (!focusMode || location.pathname !== '/watch') { clearInterval(pauseInterval); return; }
      const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (v) { v.pause(); v.muted = true; }
    };
    muteAndPause();
    pauseInterval = setInterval(muteAndPause, 500);
  }

  function cleanup() {
    removeOverlay();
    if (pauseInterval) { clearInterval(pauseInterval); pauseInterval = null; }
    const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (v) v.muted = false;
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
})();
