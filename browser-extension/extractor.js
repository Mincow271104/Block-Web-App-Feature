/* ===== Focus Guard — YouTube Data Extractor =====
   Runs in MAIN world (page context).
   Communicates with content.js (ISOLATED world) via window events.
   Extracts: videoId, title, author, channelId, category, keywords, description.
*/
(function () {
  'use strict';

  function getVideoIdFromUrl() {
    return new URLSearchParams(window.location.search).get('v');
  }

  function extractAndSend() {
    if (window.location.pathname !== '/watch') return;
    const urlVideoId = getVideoIdFromUrl();
    if (!urlVideoId) return;

    let pr = null;

    try {
      // Method 1: Player API (most reliable, updates on SPA nav)
      const player = document.querySelector('#movie_player');
      if (player && typeof player.getPlayerResponse === 'function') {
        const resp = player.getPlayerResponse();
        if (resp && resp.videoDetails && resp.videoDetails.videoId === urlVideoId) {
          pr = resp;
        }
      }

      // Method 2: Global variable (only reliable on initial page load)
      if (!pr && window.ytInitialPlayerResponse) {
        const resp = window.ytInitialPlayerResponse;
        if (resp && resp.videoDetails && resp.videoDetails.videoId === urlVideoId) {
          pr = resp;
        }
      }

      // Only send if we have VALID data matching current URL
      if (pr && pr.videoDetails && pr.videoDetails.title) {
        const vd = pr.videoDetails;
        const mf = (pr.microformat || {}).playerMicroformatRenderer || {};

        window.dispatchEvent(new CustomEvent('__fg_data__', {
          detail: JSON.stringify({
            videoId: vd.videoId,
            title: vd.title,
            channelId: vd.channelId || '',
            author: vd.author || '',
            category: mf.category || '',
            keywords: vd.keywords || [],
            description: (vd.shortDescription || '').substring(0, 500)
          })
        }));
      }
    } catch (e) {
      // Silently fail
    }
  }

  // Listen for extraction requests from content.js
  window.addEventListener('__fg_extract__', () => {
    extractAndSend();
  });

  // On SPA navigation, YouTube needs time to update player data
  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(extractAndSend, 500);
    setTimeout(extractAndSend, 1500);
    setTimeout(extractAndSend, 3000);
    setTimeout(extractAndSend, 5000);
  });
})();
