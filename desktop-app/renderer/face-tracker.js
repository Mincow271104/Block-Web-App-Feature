// ==========================================
// Face Tracker — MediaPipe Face Detection
// Tracks if user is sitting in front of screen
// ==========================================

const AFK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const DETECT_INTERVAL_MS = 2000; // check every 2 seconds

let faceDetector = null;
let videoStream = null;
let videoEl = null;
let detectInterval = null;
let lastFaceDetectedAt = 0;
let isTracking = false;

// Callbacks
let onStatusUpdate = null; // (status: 'tracking' | 'warning' | 'afk', afkElapsed: number) => void
let onAfkTimeout = null;   // () => void

async function initMediaPipe() {
  if (faceDetector) return;
  console.log('[FaceTracker] Loading MediaPipe...');
  
  try {
    const { FaceDetector, FilesetResolver } = await import(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs'
    );

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
        delegate: 'GPU'
      },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5
    });

    console.log('[FaceTracker] MediaPipe loaded successfully!');
  } catch (err) {
    console.error('[FaceTracker] Failed to load MediaPipe:', err);
    // Try CPU fallback
    try {
      const { FaceDetector, FilesetResolver } = await import(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs'
      );
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
          delegate: 'CPU'
        },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5
      });
      console.log('[FaceTracker] MediaPipe loaded with CPU fallback.');
    } catch (err2) {
      console.error('[FaceTracker] MediaPipe completely failed:', err2);
      throw err2;
    }
  }
}

async function startCamera(videoElement) {
  videoEl = videoElement;
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' }
    });
    videoEl.srcObject = videoStream;
    await videoEl.play();
    console.log('[FaceTracker] Camera started.');
  } catch (err) {
    console.error('[FaceTracker] Camera access error:', err);
    throw err;
  }
}

function stopCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
  if (videoEl) {
    videoEl.srcObject = null;
  }
  console.log('[FaceTracker] Camera stopped.');
}

function detectFace() {
  if (!faceDetector || !videoEl || videoEl.readyState < 2) return;

  try {
    const detections = faceDetector.detect(videoEl);
    const now = Date.now();

    if (detections.detections && detections.detections.length > 0) {
      // Face found!
      lastFaceDetectedAt = now;
      if (onStatusUpdate) onStatusUpdate('tracking', 0);
    } else {
      // No face
      const elapsed = now - lastFaceDetectedAt;
      if (elapsed >= AFK_TIMEOUT_MS) {
        // AFK timeout reached!
        console.log('[FaceTracker] AFK timeout! User away for 5+ minutes.');
        if (onAfkTimeout) onAfkTimeout();
        stopTracking();
      } else {
        if (onStatusUpdate) onStatusUpdate('warning', elapsed);
      }
    }
  } catch (err) {
    console.error('[FaceTracker] Detection error:', err);
  }
}

async function startTracking(videoElement, callbacks) {
  if (isTracking) return;
  isTracking = true;

  onStatusUpdate = callbacks.onStatusUpdate || null;
  onAfkTimeout = callbacks.onAfkTimeout || null;

  try {
    await initMediaPipe();
    await startCamera(videoElement);
    lastFaceDetectedAt = Date.now();

    detectInterval = setInterval(detectFace, DETECT_INTERVAL_MS);
    console.log('[FaceTracker] Tracking started.');
  } catch (err) {
    console.error('[FaceTracker] Could not start tracking:', err);
    isTracking = false;
    clearTimeout(waitForStreamReady); // Just in case
    // Notify UI that tracking failed (non-fatal, timer still works)
    if (onStatusUpdate) onStatusUpdate('error', err);
  }
}

function stopTracking() {
  isTracking = false;
  clearInterval(detectInterval);
  detectInterval = null;
  stopCamera();
  faceDetector = null; // force re-init next time
  onStatusUpdate = null;
  onAfkTimeout = null;
  console.log('[FaceTracker] Tracking stopped.');
}

function getIsTracking() {
  return isTracking;
}

// Export for app.js
window.FaceTracker = {
  startTracking,
  stopTracking,
  getIsTracking
};
