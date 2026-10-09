/**
 * Audio Evidence Snapshotting & SOS Segmented Audio Service
 * Fully client-side + Firestore powered (100% FREE - No Firebase Storage / Blaze plan required).
 *
 * Architecture:
 * 1. Early mic stream pre-warming on trip start so SOS records instantly.
 * 2. 10-second segmented recording during SOS: stop and restart MediaRecorder every 10s
 *    so every segment is an independent, complete, playable file with valid headers.
 * 3. Immediate local persistence to IndexedDB before upload.
 * 4. Background non-blocking upload to Firestore at `trips/{tripId}/audioChunks/{index}` as base64 string.
 * 5. Automatic retry every 5 seconds and on the browser 'online' event if network drops.
 * 6. Screen Wake Lock API active throughout SOS so phone does not sleep.
 * 7. Clear status: Recording / Uploading n of n / All saved.
 */

import { AudioEvidence } from '../types';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import {
  saveAudioChunkToIndexedDb,
  markAudioChunkUploaded,
  recordChunkUploadFailure,
  getPendingAudioChunks,
  getAllAudioChunksForTrip,
  deleteAudioChunksForTrip,
  SavedAudioChunk,
} from './indexedDbAudioService';

// Module-level persistent state
let readyMicStream: MediaStream | null = null;
let currentStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let latestAudioSnapshot: AudioEvidence | null = null;
let rollingTimerId: any = null;

// Dedicated SOS Recording State
let activeSosRecorder: MediaRecorder | null = null;
let activeSosStream: MediaStream | null = null;
let activeSosTripId: string | null = null;
let activeSosSegmentTimer: any = null;
let isSosRecording = false;
let currentSegmentIndex = 0;
let totalRecordedSegments = 0;
let totalUploadedSegments = 0;
let latestUploadError: string | null = null;

// Screen Wake Lock State
let wakeLockSentinel: any = null;

// Progress Subscription State
export interface SosAudioProgress {
  isRecording: boolean;
  currentSegmentIndex: number;
  recordedCount: number;
  uploadedCount: number;
  statusText: string;
  status: 'idle' | 'recording' | 'uploading' | 'ready' | 'failed';
  error?: string | null;
}

const progressListeners = new Set<(progress: SosAudioProgress) => void>();

function notifyProgressListeners(): void {
  const progress = getSosAudioProgress();
  progressListeners.forEach((listener) => {
    try {
      listener(progress);
    } catch (e) {
      console.warn('[SOS-AUDIO] Progress listener notice:', e);
    }
  });
}

export function subscribeSosAudioProgress(listener: (progress: SosAudioProgress) => void): () => void {
  progressListeners.add(listener);
  // Emit current progress immediately
  listener(getSosAudioProgress());
  return () => {
    progressListeners.delete(listener);
  };
}

export function getSosAudioProgress(): SosAudioProgress {
  let statusText = 'Ready';
  let status: SosAudioProgress['status'] = 'idle';

  if (isSosRecording) {
    status = 'recording';
    if (latestUploadError) {
      statusText = `Upload error: ${latestUploadError} (recording segment ${currentSegmentIndex + 1})`;
    } else if (totalRecordedSegments > totalUploadedSegments) {
      statusText = `Recording / Uploading ${totalUploadedSegments} of ${totalRecordedSegments}`;
    } else if (totalRecordedSegments > 0) {
      statusText = `Recording (Segment ${currentSegmentIndex + 1}) • All saved`;
    } else {
      statusText = `Recording (Segment ${currentSegmentIndex + 1})...`;
    }
  } else if (totalRecordedSegments > 0) {
    if (latestUploadError) {
      status = 'failed';
      statusText = `Upload error: ${latestUploadError}`;
    } else if (totalUploadedSegments < totalRecordedSegments) {
      status = 'uploading';
      statusText = `Uploading ${totalUploadedSegments} of ${totalRecordedSegments}`;
    } else {
      status = 'ready';
      statusText = 'All saved';
    }
  } else {
    statusText = latestUploadError ? `Error: ${latestUploadError}` : 'Ready';
  }

  return {
    isRecording: isSosRecording,
    currentSegmentIndex,
    recordedCount: totalRecordedSegments,
    uploadedCount: totalUploadedSegments,
    statusText,
    status,
    error: latestUploadError,
  };
}

// Retry loop management
interface RetryManager {
  intervalId: any;
  onlineListener: () => void;
  isRunning: boolean;
}

const activeRetryManagers = new Map<string, RetryManager>();

// Wake Lock Handler
export async function requestWakeLock(): Promise<void> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    console.log('[SOS-AUDIO] [WAKE LOCK] Screen Wake Lock API not supported in this browser.');
    return;
  }
  try {
    wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
    console.log('[SOS-AUDIO] [WAKE LOCK] 💡 Screen Wake Lock acquired during SOS.');

    wakeLockSentinel.addEventListener('release', () => {
      console.log('[SOS-AUDIO] [WAKE LOCK] Screen Wake Lock was released.');
      wakeLockSentinel = null;
    });
  } catch (err: any) {
    console.error('[SOS-AUDIO] [WAKE LOCK ERROR] Failed to acquire Screen Wake Lock:', err);
  }
}

export async function releaseWakeLock(): Promise<void> {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
      console.log('[SOS-AUDIO] [WAKE LOCK] Screen Wake Lock released manually.');
    } catch (err: any) {
      console.error('[SOS-AUDIO] [WAKE LOCK RELEASE ERROR] Failed to release Wake Lock:', err);
    }
    wakeLockSentinel = null;
  }
}

// Handle visibility change to restore wake lock if browser tab returns to foreground
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isSosRecording && !wakeLockSentinel) {
      console.log('[SOS-AUDIO] [WAKE LOCK] Tab returned to visible during active SOS. Re-requesting Screen Wake Lock...');
      requestWakeLock();
    }
  });
}

/**
 * Checks if audio snapshotting via browser APIs is supported.
 */
export function isAudioSnapshotSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  );
}

/**
 * Returns the best audio MIME type supported natively by the browser.
 * Priority required: "audio/webm;codecs=opus", then "audio/mp4", then "audio/webm".
 */
export function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
    console.log('[SOS-AUDIO] [FORMAT] Using "audio/webm;codecs=opus"');
    return 'audio/webm;codecs=opus';
  }
  if (MediaRecorder.isTypeSupported('audio/mp4')) {
    console.log('[SOS-AUDIO] [FORMAT] Using "audio/mp4"');
    return 'audio/mp4';
  }
  if (MediaRecorder.isTypeSupported('audio/webm')) {
    console.log('[SOS-AUDIO] [FORMAT] Using "audio/webm"');
    return 'audio/webm';
  }
  return '';
}

/**
 * Resolves standard file extension based on MIME type: 'webm' or 'mp4'.
 */
export function getAudioExtension(mimeType: string = ''): 'webm' | 'mp4' {
  const m = mimeType.toLowerCase();
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) {
    return 'mp4';
  }
  return 'webm';
}

/**
 * Requests microphone stream with high-reliability constraints.
 */
export async function requestMicrophoneStream(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const err = new Error('Microphone access (navigator.mediaDevices.getUserMedia) is not supported in this browser environment.');
    console.error('[SOS-AUDIO] [MIC ERROR]', err);
    throw err;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    return stream;
  } catch (err: any) {
    console.warn('[SOS-AUDIO] Advanced audio constraints rejected, falling back to audio: true...', err?.message || err);
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

/**
 * Requests microphone permission early when a trip starts and keeps the stream ready in memory.
 * Ensures that when SOS is triggered, recording begins IMMEDIATELY with zero user prompt or delay.
 */
export async function requestEarlyMicrophonePermission(): Promise<{ granted: boolean; error?: string }> {
  console.log('[SOS-AUDIO] [EARLY MIC REQUEST] Requesting early mic permission on trip start...');
  if (!isAudioSnapshotSupported()) {
    const msg = 'Microphone hardware access is not available on this device/browser.';
    console.error('[SOS-AUDIO] [MIC ERROR]', msg);
    return { granted: false, error: msg };
  }

  try {
    // If we already hold an active live stream, keep it ready
    if (readyMicStream && readyMicStream.active && readyMicStream.getAudioTracks().some((t) => t.readyState === 'live')) {
      console.log('[SOS-AUDIO] [EARLY MIC REQUEST] Existing mic stream is already warm and ready.');
      return { granted: true };
    }

    const stream = await requestMicrophoneStream();
    readyMicStream = stream;
    currentStream = stream;
    console.log('[SOS-AUDIO] [EARLY MIC REQUEST] ✅ Microphone stream acquired and kept warm for instant SOS trigger.');
    return { granted: true };
  } catch (err: any) {
    const isDenied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
    const msg = isDenied
      ? 'Microphone permission denied by traveler device (NotAllowedError).'
      : err?.message || 'Microphone access failed.';
    console.error('[SOS-AUDIO] [EARLY MIC REQUEST ERROR] ❌', msg, err);
    return { granted: false, error: msg };
  }
}

/**
 * Converts a Blob to a base64 Data URL string asynchronously.
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      resolve(res);
    };
    reader.onerror = (err) => {
      console.error('[SOS-AUDIO] [BLOB TO BASE64 ERROR]', err);
      reject(err);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Uploads a single audio chunk to Firestore at `trips/{tripId}/audioChunks/{index}`.
 * Completely free - uses Firestore documents only.
 */
async function uploadAudioChunkToFirestore(tripId: string, chunk: SavedAudioChunk): Promise<boolean> {
  const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
  const chunkDocId = String(chunk.index);

  console.log("upload started", { tripId: cleanTripId, index: chunk.index, chunkDocId });

  try {
    if (!db) {
      throw new Error('Firestore instance (db) is not available.');
    }

    const payload = {
      index: chunk.index,
      timestamp: chunk.timestamp,
      base64: chunk.base64,
      mimeType: chunk.mimeType,
      durationSeconds: chunk.durationSeconds,
      sizeBytes: chunk.sizeBytes,
      uploadedAt: new Date().toISOString(),
    };

    // Store in subcollection trips/{tripId}/audioChunks/{index}
    await setDoc(doc(db, 'trips', cleanTripId, 'audioChunks', chunkDocId), payload);

    console.log("upload success", { tripId: cleanTripId, index: chunk.index, chunkDocId });

    // Reset latest upload error on success
    latestUploadError = null;

    // Mark as uploaded in IndexedDB
    await markAudioChunkUploaded(cleanTripId, chunk.index);

    totalUploadedSegments++;
    notifyProgressListeners();

    // Update parent trip document root status
    try {
      await setDoc(
        doc(db, 'trips', cleanTripId),
        {
          audioStatus: isSosRecording ? 'recording' : (totalUploadedSegments >= totalRecordedSegments ? 'ready' : 'uploading'),
          audioChunkCount: totalRecordedSegments,
          audioUploadedCount: totalUploadedSegments,
          audioMimeType: chunk.mimeType,
          audioStatusUpdatedAt: new Date().toISOString(),
          audioCapturedAt: chunk.timestamp,
        },
        { merge: true }
      );
    } catch (tripUpdateErr) {
      console.warn('[SOS-AUDIO] Trip root doc status update notice:', tripUpdateErr);
    }

    return true;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    console.error(errorMsg);
    latestUploadError = errorMsg;
    await recordChunkUploadFailure(cleanTripId, chunk.index, errorMsg);
    notifyProgressListeners();
    return false;
  }
}

/**
 * Processes all pending audio chunks in IndexedDB for a trip.
 */
async function processPendingUploads(tripId: string): Promise<void> {
  const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
  const pending = await getPendingAudioChunks(cleanTripId);

  if (pending.length === 0) {
    if (!isSosRecording && totalRecordedSegments > 0) {
      notifyProgressListeners();
    }
    return;
  }

  console.log(`[SOS-AUDIO] [PENDING QUEUE] Processing ${pending.length} pending audio chunks for trip "${cleanTripId}"...`);

  for (const chunk of pending) {
    const success = await uploadAudioChunkToFirestore(cleanTripId, chunk);
    if (!success) {
      // Don't halt entire queue, continue trying other chunks
      console.warn(`[SOS-AUDIO] Segment #${chunk.index} failed to upload. Will retry in 5s...`);
    }
  }

  notifyProgressListeners();
}

/**
 * Starts automatic retry loop for a trip:
 * - Retries every 5 seconds
 * - Retries on window 'online' event
 * Never blocks recording.
 */
export function startAudioUploadRetryLoop(tripId: string): void {
  const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
  if (activeRetryManagers.has(cleanTripId)) {
    return;
  }

  console.log(`[SOS-AUDIO] [RETRY LOOP] 🔄 Starting 5-second retry loop for trip "${cleanTripId}"...`);

  const onlineListener = () => {
    console.log(`[SOS-AUDIO] [ONLINE EVENT] 🌐 Browser online event detected. Retrying pending audio uploads for "${cleanTripId}"...`);
    processPendingUploads(cleanTripId);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onlineListener);
  }

  const intervalId = setInterval(() => {
    processPendingUploads(cleanTripId);
  }, 5000);

  activeRetryManagers.set(cleanTripId, {
    intervalId,
    onlineListener,
    isRunning: true,
  });
}

export function stopAudioUploadRetryLoop(tripId: string): void {
  const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
  const manager = activeRetryManagers.get(cleanTripId);
  if (manager) {
    if (manager.intervalId) clearInterval(manager.intervalId);
    if (typeof window !== 'undefined' && manager.onlineListener) {
      window.removeEventListener('online', manager.onlineListener);
    }
    activeRetryManagers.delete(cleanTripId);
    console.log(`[SOS-AUDIO] [RETRY STOP] Stopped retry loop for trip "${cleanTripId}".`);
  }
}

/**
 * Records a single 10-second audio segment, then automatically recurses to the next segment.
 * Stops and restarts MediaRecorder every 10 seconds so each segment is a complete, valid, playable file.
 */
function recordNextSegment(tripId: string, segmentIndex: number, maxSegments: number = 18): void {
  const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');

  if (!isSosRecording || activeSosTripId !== cleanTripId) {
    console.log(`[SOS-AUDIO] [SEGMENT STOPPED] SOS recording stopped before segment #${segmentIndex}.`);
    return;
  }

  if (segmentIndex >= maxSegments) {
    console.log(`[SOS-AUDIO] [MAX SEGMENTS REACHED] Completed maximum of ${maxSegments} segments (${maxSegments * 10}s). Stopping recorder.`);
    stopSosAudioRecording();
    return;
  }

  currentSegmentIndex = segmentIndex;
  notifyProgressListeners();

  const mimeType = getSupportedMimeType();
  const options = mimeType ? { mimeType } : undefined;

  let stream = activeSosStream;
  if (!stream || !stream.active || !stream.getAudioTracks().some((t) => t.readyState === 'live')) {
    stream = readyMicStream;
  }

  if (!stream) {
    console.error('[SOS-AUDIO] [STREAM ERROR] No active audio stream available for segment #' + segmentIndex);
    return;
  }

  try {
    const recorder = new MediaRecorder(stream, options);
    activeSosRecorder = recorder;
    const segmentChunks: BlobPart[] = [];
    const segmentStartTime = Date.now();

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) {
        segmentChunks.push(ev.data);
      }
    };

    recorder.onerror = (err: any) => {
      const errMsg = err?.error?.message || err?.message || 'MediaRecorder error';
      console.error(errMsg);
      latestUploadError = errMsg;
      notifyProgressListeners();
    };

    recorder.onstop = async () => {
      const durationSec = Math.round((Date.now() - segmentStartTime) / 1000) || 10;
      console.log("segment recorded", { index: segmentIndex, duration: durationSec, chunks: segmentChunks.length });
      const actualMimeType = recorder.mimeType || mimeType || 'audio/webm';

      if (segmentChunks.length > 0) {
        const segmentBlob = new Blob(segmentChunks, { type: actualMimeType });

        try {
          const base64Data = await blobToBase64(segmentBlob);
          const chunkRecord: SavedAudioChunk = {
            id: `${cleanTripId}_${segmentIndex}`,
            tripId: cleanTripId,
            index: segmentIndex,
            base64: base64Data,
            mimeType: actualMimeType,
            durationSeconds: durationSec,
            timestamp: new Date().toISOString(),
            sizeBytes: segmentBlob.size,
            uploaded: false,
            uploadAttempts: 0,
            createdAt: Date.now(),
          };

          // 1. Save to IndexedDB immediately!
          await saveAudioChunkToIndexedDb(chunkRecord);
          console.log("saved to IndexedDB", { index: segmentIndex, id: chunkRecord.id, tripId: cleanTripId });
          totalRecordedSegments = segmentIndex + 1;
          notifyProgressListeners();

          // 2. Upload to Firestore asynchronously (NON-BLOCKING)
          uploadAudioChunkToFirestore(cleanTripId, chunkRecord).catch((uErr: any) => {
            const uErrMsg = uErr?.message || String(uErr);
            console.error(uErrMsg);
            latestUploadError = uErrMsg;
            notifyProgressListeners();
          });
        } catch (convErr: any) {
          const cErrMsg = convErr?.message || String(convErr);
          console.error(cErrMsg);
          latestUploadError = cErrMsg;
          notifyProgressListeners();
        }
      } else {
        console.warn(`[SOS-AUDIO] [EMPTY SEGMENT] Segment #${segmentIndex} produced 0 data chunks.`);
      }

      // If SOS is still actively recording, proceed to next segment immediately!
      // Recording must keep going even if an upload fails!
      if (isSosRecording && activeSosTripId === cleanTripId) {
        recordNextSegment(cleanTripId, segmentIndex + 1, maxSegments);
      } else {
        console.log('[SOS-AUDIO] SOS recording completed or ended.');
        notifyProgressListeners();
      }
    };

    // Start recording the 10-second slice with 1000ms timeslices so data chunks emit steadily
    recorder.start(1000);
    console.log(`[SOS-AUDIO] [SEGMENT START] 🎙️ Recording segment #${segmentIndex} (10 seconds)...`);

    // Stop after exactly 10 seconds to generate a full, standalone playable file
    activeSosSegmentTimer = setTimeout(() => {
      if (recorder.state === 'recording') {
        try {
          recorder.stop();
        } catch (stopErr) {
          console.warn('[SOS-AUDIO] Notice stopping recorder:', stopErr);
        }
      }
    }, 10000);
  } catch (recInitErr: any) {
    console.error(`[SOS-AUDIO] [RECORDER INIT ERROR] Failed to initialize MediaRecorder for segment #${segmentIndex}:`, recInitErr);
  }
}

/**
 * Main entry point: Starts SOS segmented audio recording on traveler's device.
 * 1. Acquires Screen Wake Lock
 * 2. Prepares audio stream
 * 3. Starts 10-second segments loop
 * 4. Starts background 5-second retry loop
 */
export async function startSosEvidenceRecording(
  tripId: string,
  userId: string = 'traveler',
  maxDurationSeconds: number = 600
): Promise<{ success: boolean; error?: string }> {
  const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
  console.log(`[SOS-AUDIO] [SOS RECORDING START] 🚨 Starting SOS segmented audio evidence recording for trip "${cleanTripId}"...`);

  if (isSosRecording && activeSosTripId === cleanTripId) {
    console.log('[SOS-AUDIO] SOS recording already active for trip:', cleanTripId);
    return { success: true };
  }

  // Abort any existing recording session
  abortSosAudioRecording();

  isSosRecording = true;
  activeSosTripId = cleanTripId;
  currentSegmentIndex = 0;
  totalRecordedSegments = 0;
  totalUploadedSegments = 0;
  latestUploadError = null;

  // 1. Acquire Screen Wake Lock
  await requestWakeLock();

  // 2. Set initial status in Firestore: 'recording'
  if (db) {
    try {
      await setDoc(
        doc(db, 'trips', cleanTripId),
        {
          audioStatus: 'recording',
          audioStatusUpdatedAt: new Date().toISOString(),
          audioChunkCount: 0,
        },
        { merge: true }
      );
    } catch (statusErr) {
      console.warn('[SOS-AUDIO] Failed to write initial recording status to Firestore:', statusErr);
    }
  }

  // 3. Acquire / verify stream
  try {
    let stream = readyMicStream;
    if (!stream || !stream.active || !stream.getAudioTracks().some((t) => t.readyState === 'live')) {
      console.log('[SOS-AUDIO] Pre-warmed stream not available, requesting fresh mic stream...');
      stream = await requestMicrophoneStream();
      readyMicStream = stream;
    }
    activeSosStream = stream;
  } catch (micErr: any) {
    console.error('[SOS-AUDIO] [STREAM FAILURE] ❌ Could not acquire microphone stream for SOS:', micErr);
    isSosRecording = false;
    releaseWakeLock();
    if (db) {
      try {
        await setDoc(
          doc(db, 'trips', cleanTripId),
          {
            audioStatus: 'failed',
            audioError: micErr?.message || 'Microphone access denied',
            audioStatusUpdatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch {}
    }
    notifyProgressListeners();
    return { success: false, error: micErr?.message || 'Microphone access denied' };
  }

  // 4. Start the 5-second background retry loop for any network drops
  startAudioUploadRetryLoop(cleanTripId);

  // 5. Calculate max segments based on maxDurationSeconds (default 180s = 18 segments)
  const maxSegments = Math.max(3, Math.ceil(maxDurationSeconds / 10));

  // 6. Begin recording segment #0
  recordNextSegment(cleanTripId, 0, maxSegments);

  notifyProgressListeners();
  return { success: true };
}

/**
 * Stops SOS audio recording cleanly and finalizes uploads.
 */
export function stopSosAudioRecording(reason?: string): void {
  console.log(`[SOS-AUDIO] 🛑 Stopping SOS recording${reason ? ` (${reason})` : ''}...`);
  isSosRecording = false;

  if (activeSosSegmentTimer) {
    clearTimeout(activeSosSegmentTimer);
    activeSosSegmentTimer = null;
  }

  if (activeSosRecorder && activeSosRecorder.state === 'recording') {
    try {
      activeSosRecorder.stop();
    } catch {}
  }

  releaseWakeLock();

  if (activeSosTripId) {
    const tripId = activeSosTripId;
    // Process any remaining pending uploads
    processPendingUploads(tripId).then(() => {
      // If all uploaded, mark trip audioStatus as 'ready'
      if (db) {
        setDoc(
          doc(db, 'trips', tripId),
          {
            audioStatus: 'ready',
            audioStatusUpdatedAt: new Date().toISOString(),
          },
          { merge: true }
        ).catch(() => {});
      }
    });
  }

  notifyProgressListeners();
}

/**
 * Aborts SOS recording immediately without waiting.
 */
export function abortSosAudioRecording(): void {
  console.log('[SOS-AUDIO] 🛑 Aborting SOS audio hardware.');
  isSosRecording = false;

  if (activeSosSegmentTimer) {
    clearTimeout(activeSosSegmentTimer);
    activeSosSegmentTimer = null;
  }

  if (activeSosRecorder) {
    try {
      activeSosRecorder.ondataavailable = null;
      activeSosRecorder.onstop = null;
      if (activeSosRecorder.state === 'recording') {
        activeSosRecorder.stop();
      }
    } catch {}
    activeSosRecorder = null;
  }

  releaseWakeLock();
  activeSosTripId = null;
  notifyProgressListeners();
}

/**
 * Purges audio hardware and memory when trip ends safely.
 */
export function purgeAudioSnapshots(): void {
  abortSosAudioRecording();

  if (readyMicStream) {
    readyMicStream.getTracks().forEach((track) => track.stop());
    readyMicStream = null;
  }
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }
  if (activeSosStream) {
    activeSosStream.getTracks().forEach((track) => track.stop());
    activeSosStream = null;
  }

  latestAudioSnapshot = null;
}

/**
 * Rolling recorder legacy compatibility helpers
 */
export async function startRollingAudioRecorder(
  tripId: string,
  onSnapshotUpdated?: (snapshot: AudioEvidence) => void
): Promise<{ success: boolean; error?: string }> {
  // Pre-warms microphone stream for active trip
  const perm = await requestEarlyMicrophonePermission();
  return { success: perm.granted, error: perm.error };
}

export async function freezeAudioSnapshot(): Promise<AudioEvidence | null> {
  return latestAudioSnapshot;
}

export function getLatestAudioSnapshot(): AudioEvidence | null {
  return latestAudioSnapshot;
}

export async function updateTripAudioStatus(
  tripId: string,
  status: 'recording' | 'uploading' | 'upload_pending' | 'ready' | 'failed',
  evidence?: AudioEvidence | null,
  errorMsg?: string | null
): Promise<boolean> {
  const cleanTripId = String(tripId).replace(/[^A-Za-z0-9_-]/g, '_');
  if (!db) return false;
  try {
    await setDoc(
      doc(db, 'trips', cleanTripId),
      {
        audioStatus: status,
        audioStatusUpdatedAt: new Date().toISOString(),
        audioError: errorMsg || null,
      },
      { merge: true }
    );
    return true;
  } catch (err) {
    console.warn('[SOS-AUDIO] updateTripAudioStatus notice:', err);
    return false;
  }
}

export async function syncPendingCachedAudioEvidence(tripId?: string): Promise<void> {
  console.log(`[SOS-AUDIO] syncPendingCachedAudioEvidence called${tripId ? ` for trip ${tripId}` : ''}. Checking pending IndexedDB uploads...`);
  const pending = await getPendingAudioChunks(tripId);
  for (const chunk of pending) {
    await uploadAudioChunkToFirestore(chunk.tripId, chunk);
  }
}

// Auto-run startup check for any pending IndexedDB chunks from previous sessions
if (typeof window !== 'undefined') {
  setTimeout(() => {
    syncPendingCachedAudioEvidence().catch((err) => {
      console.warn('[SOS-AUDIO] Startup sync notice:', err);
    });
  }, 2000);
}
