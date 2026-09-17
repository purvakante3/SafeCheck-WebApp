/**
 * Audio Evidence Snapshotting Service using browser MediaRecorder API
 * Records rolling 12-second audio clips during an active trip.
 * Automatically overwrites older clips (keeping only 1 recent clip in memory).
 * When trip ends safely, all clips and hardware streams are destroyed.
 * When SOS is triggered, genuine ambient microphone audio is locked as forensic evidence.
 * NEVER uses synthetic tones, mock audio generators, or fake WAV fallbacks.
 */

import { AudioEvidence } from '../types';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

let mediaRecorder: MediaRecorder | null = null;
let currentStream: MediaStream | null = null;
let currentTripId: string | null = null;
let latestAudioSnapshot: AudioEvidence | null = null;
let rollingTimerId: any = null;

const ROLLING_CLIP_SECONDS = 12;
export const DEFAULT_SOS_AUDIO_DURATION_SECONDS = 30; // 30 seconds

/**
 * Updates the trip document with the current audioStatus ('recording' | 'uploading' | 'ready' | 'failed')
 * directly in Firestore so that any Guardian real-time onSnapshot listener updates immediately.
 * Also syncs with the local server and localStorage.
 */
// Persistent module-level state for dedicated SOS emergency recording
let activeSosRecorder: MediaRecorder | null = null;
let activeSosStream: MediaStream | null = null;
let activeSosTripId: string | null = null;
let activeSosTimerId: any = null;
let isSosRecordingStarting = false;

/**
 * Immediately stops any ongoing SOS recording hardware and clears timers.
 */
export function abortSosAudioRecording(): void {
  console.log('[SafeCheck Audio SOS] 🛑 Aborting SOS audio hardware and recording timers.');
  if (activeSosRecorder) {
    try {
      activeSosRecorder.ondataavailable = null;
      activeSosRecorder.onstop = null;
      if (activeSosRecorder.state === 'recording') {
        activeSosRecorder.stop();
      }
    } catch (e) {}
    activeSosRecorder = null;
  }
  if (activeSosStream) {
    try {
      activeSosStream.getTracks().forEach((track) => track.stop());
    } catch (e) {}
    activeSosStream = null;
  }
  if (activeSosTimerId) {
    clearTimeout(activeSosTimerId);
    activeSosTimerId = null;
  }
  activeSosTripId = null;
  isSosRecordingStarting = false;
}

/**
 * Updates the trip document with the current audioStatus ('recording' | 'uploading' | 'ready' | 'failed')
 * directly in Firestore using updateDoc so deleted documents are NEVER resurrected.
 * Also syncs with the local server and localStorage.
 */
export async function updateTripAudioStatus(
  tripId: string,
  status: 'recording' | 'uploading' | 'ready' | 'failed',
  evidence?: AudioEvidence | null,
  errorMsg?: string | null
): Promise<boolean> {
  const timestamp = new Date().toISOString();
  console.log(`[SafeCheck Audio Status] 📡 Updating trip "${tripId}" audioStatus -> "${status}"${errorMsg ? ` (${errorMsg})` : ''}`);

  const updatePayload: any = {
    audioStatus: status,
    audioStatusUpdatedAt: timestamp,
  };

  if (evidence) {
    updatePayload.audioEvidence = evidence;
  }
  if (errorMsg) {
    updatePayload.audioError = errorMsg;
  } else if (status === 'ready' || status === 'recording') {
    updatePayload.audioError = null;
  }

  // 1. Direct Firestore write to 'trips' collection - using updateDoc so deleted documents are never resurrected!
  try {
    if (db) {
      await updateDoc(doc(db, 'trips', tripId), updatePayload);
      console.log(`[SafeCheck Audio Status] ✅ Updated Firestore 'trips/${tripId}' with audioStatus="${status}".`);
    }
  } catch (fsErr: any) {
    const isNotFound = fsErr?.code === 'not-found' || fsErr?.message?.includes('No document to update');
    if (isNotFound) {
      console.warn(`[SafeCheck Audio Status] 🛑 Trip/SOS document "${tripId}" does not exist in Firestore (it was deleted). Aborting all audio operations.`);
      abortSosAudioRecording();
      return false;
    }
    console.warn('[SafeCheck Audio Status] Direct Firestore trips update notice:', fsErr?.message || fsErr);
  }

  // 2. Server API update to keep local server memory in sync
  try {
    fetch(`/api/trips/${encodeURIComponent(tripId)}/audio-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        evidence: evidence || null,
        error: errorMsg || null,
      }),
    }).catch(() => {});
  } catch {}

  // 3. Local storage update so local components/views immediately reflect the status
  if (typeof localStorage !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('safecheck_trips_') || key.startsWith('safecheck_active_trip_'))) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              let updated = false;
              const next = parsed.map((t: any) => {
                if (t.id === tripId) {
                  updated = true;
                  return { ...t, ...updatePayload };
                }
                return t;
              });
              if (updated) localStorage.setItem(key, JSON.stringify(next));
            } else if (parsed && parsed.id === tripId) {
              localStorage.setItem(key, JSON.stringify({ ...parsed, ...updatePayload }));
            }
          }
        }
      }
    } catch {}
  }
  return true;
}

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
 */
export function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/aac',
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return 'audio/webm';
}

/**
 * Resolves standard file extension based on MIME type.
 */
export function getAudioExtension(mimeType: string = ''): string {
  const m = mimeType.toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a';
  if (m.includes('mp3') || m.includes('mpeg')) return 'mp3';
  return 'webm';
}

/**
 * Requests microphone stream with fallback to simple constraints if advanced constraints fail.
 */
export async function requestMicrophoneStream(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Microphone access (navigator.mediaDevices.getUserMedia) is not supported in this browser environment.');
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err: any) {
    console.warn('[SafeCheck Audio] Advanced audio constraints rejected, falling back to audio: true...', err?.message || err);
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

/**
 * Starts continuous rolling audio clip recording for an active trip.
 * Uses real microphone capture with 1000ms timeslices.
 */
export async function startRollingAudioRecorder(
  tripId: string,
  onSnapshotUpdated?: (snapshot: AudioEvidence) => void
): Promise<{ success: boolean; error?: string }> {
  if (!isAudioSnapshotSupported()) {
    return { success: false, error: 'MediaRecorder is not supported in this browser.' };
  }

  // Purge any prior session
  purgeAudioSnapshots();
  currentTripId = tripId;

  try {
    console.log(`[SafeCheck Audio Rolling] Requesting microphone stream for trip "${tripId}"...`);
    const stream = await requestMicrophoneStream();
    currentStream = stream;

    const mimeType = getSupportedMimeType();
    console.log(`[SafeCheck Audio Rolling] Stream acquired! Initializing rolling slices with MIME "${mimeType}"...`);

    function recordClipSlice() {
      if (!currentStream || !currentStream.active) return;

      try {
        const recorder = new MediaRecorder(currentStream, { mimeType });
        const chunks: BlobPart[] = [];
        const startTime = Date.now();

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
          }
        };

        recorder.onstop = () => {
          if (chunks.length > 0) {
            const blob = new Blob(chunks, { type: mimeType });
            const durationSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));

            const reader = new FileReader();
            reader.onloadend = () => {
              const dataUrl = reader.result as string;
              // Overwrite with ONLY the latest single snapshot in memory
              latestAudioSnapshot = {
                audioDataUrl: dataUrl,
                recordedAt: new Date().toISOString(),
                durationSeconds: durationSec,
                mimeType,
              };

              try {
                sessionStorage.setItem(
                  'safecheck_latest_audio_snapshot',
                  JSON.stringify(latestAudioSnapshot)
                );
              } catch (e) {}

              if (onSnapshotUpdated && latestAudioSnapshot) {
                onSnapshotUpdated(latestAudioSnapshot);
              }
            };
            reader.readAsDataURL(blob);
          }

          // Restart next clip slice if stream is still active and trip is ongoing
          if (currentStream && currentStream.active) {
            rollingTimerId = setTimeout(recordClipSlice, 200);
          }
        };

        mediaRecorder = recorder;
        // Timeslice of 1000ms ensures chunks accumulate progressively
        recorder.start(1000);

        // Stop recorder after ROLLING_CLIP_SECONDS to seal the slice and cycle to the next
        setTimeout(() => {
          if (recorder.state === 'recording') {
            try {
              recorder.stop();
            } catch (e) {}
          }
        }, ROLLING_CLIP_SECONDS * 1000);
      } catch (err) {
        console.warn('[SafeCheck Audio Rolling] Error during audio slice recording:', err);
      }
    }

    recordClipSlice();
    return { success: true };
  } catch (err: any) {
    console.error('[SafeCheck Audio Rolling] Recorder initialization failed:', err);
    return {
      success: false,
      error:
        err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
          ? 'Microphone permission denied for Audio Snapshotting.'
          : err.message || 'Microphone capture error.',
    };
  }
}

/**
 * Starts a persistent SOS emergency audio recording session that lives at the
 * module service level and continues for its full intended duration (120s / 2 minutes)
 * independently of UI re-renders, component unmounts, or route navigation.
 * Captures real microphone audio into MediaRecorder and uploads genuine audio Blob.
 */
export async function startSosEvidenceRecording(
  tripId: string,
  userId: string,
  durationSeconds: number = DEFAULT_SOS_AUDIO_DURATION_SECONDS,
  onProgress?: (secondsElapsed: number) => void
): Promise<{ success: boolean; error?: string }> {
  const callTimestamp = new Date().toISOString();
  console.log(`[SafeCheck Audio SOS] 🎙️ startSosEvidenceRecording() invoked at ${callTimestamp}`);
  console.log(`[SafeCheck Audio SOS] Target Trip ID: "${tripId}", User: "${userId}", Target Duration: ${durationSeconds}s`);

  if (!isAudioSnapshotSupported()) {
    const errorMsg = 'MediaRecorder or getUserMedia is not supported in this browser environment.';
    console.warn(`[SafeCheck Audio SOS] ⚠️ ${errorMsg}`);
    updateTripAudioStatus(tripId, 'failed', null, errorMsg);
    return { success: false, error: errorMsg };
  }

  // If already recording, PRESERVE IT for the full duration
  if (activeSosRecorder && activeSosRecorder.state === 'recording') {
    console.log(`[SafeCheck Audio SOS] 🔒 SOS recording already actively recording (trip: "${activeSosTripId}", state: "${activeSosRecorder.state}"). Preserving ongoing recording.`);
    return { success: true };
  }

  if (isSosRecordingStarting) {
    console.log('[SafeCheck Audio SOS] 🔒 SOS recording is already currently initializing getUserMedia. Duplicate trigger ignored.');
    return { success: true };
  }

  isSosRecordingStarting = true;

  // Immediately signal to Firestore & Guardian View that recording has commenced
  updateTripAudioStatus(tripId, 'recording');

  // Clean up any prior non-recording SOS recorder
  if (activeSosRecorder) {
    try {
      if (activeSosRecorder.state === 'recording') {
        activeSosRecorder.stop();
      }
    } catch {}
    activeSosRecorder = null;
  }
  if (activeSosStream) {
    try {
      activeSosStream.getTracks().forEach((t) => t.stop());
    } catch {}
    activeSosStream = null;
  }
  if (activeSosTimerId) {
    clearTimeout(activeSosTimerId);
    activeSosTimerId = null;
  }

  // Stop rolling recorder so it doesn't conflict with dedicated emergency recording
  if (mediaRecorder) {
    try {
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    } catch {}
    mediaRecorder = null;
    clearTimeout(rollingTimerId);
    rollingTimerId = null;
  }

  let stream: MediaStream;
  try {
    console.log('[SafeCheck Audio SOS] 🎙️ Requesting live microphone access from user via getUserMedia...');
    // If currentStream from rolling recorder is still live and active, reuse it
    if (currentStream && currentStream.active && currentStream.getAudioTracks().some((t) => t.readyState === 'live')) {
      stream = currentStream;
      console.log('[SafeCheck Audio SOS] ♻️ Reusing existing active audio stream from rolling trip recorder.');
    } else {
      stream = await requestMicrophoneStream();
      console.log(`[SafeCheck Audio SOS] ✅ Live microphone access GRANTED! Active tracks: ${stream.getAudioTracks().length} (${stream.getAudioTracks().map((t) => t.label || 'Mic').join(', ')})`);
    }
  } catch (micErr: any) {
    isSosRecordingStarting = false;
    const errMsg = micErr?.name === 'NotAllowedError' || micErr?.name === 'PermissionDeniedError'
      ? `Microphone permission DENIED by user or browser: ${micErr?.message || micErr}`
      : `Microphone access error: ${micErr?.message || micErr}`;
    console.error(`[SafeCheck Audio SOS] ❌ ${errMsg}`);
    updateTripAudioStatus(tripId, 'failed', null, errMsg);
    return { success: false, error: errMsg };
  } finally {
    isSosRecordingStarting = false;
  }

  activeSosStream = stream;
  activeSosTripId = tripId;

  const mimeType = getSupportedMimeType();
  console.log(`[SafeCheck Audio SOS] Initializing persistent MediaRecorder with MIME: "${mimeType}"...`);

  try {
    const recorder = new MediaRecorder(stream, { mimeType });
    activeSosRecorder = recorder;

    const chunks: BlobPart[] = [];
    const startTime = Date.now();
    const startTimeIso = new Date(startTime).toISOString();

    recorder.onerror = (errEvent: any) => {
      const recErr = errEvent?.error?.message || errEvent?.message || 'MediaRecorder runtime error';
      console.error('[SafeCheck Audio SOS] ❌ MediaRecorder.onerror event:', recErr);
      updateTripAudioStatus(tripId, 'failed', null, recErr);
    };

    const safeStopRecorder = (reason: string) => {
      console.log(`[SafeCheck Audio SOS] 🛑 MediaRecorder.stop() called! Reason: "${reason}", State: "${recorder.state}"`);
      // Update status to 'uploading' as soon as the stop command begins
      updateTripAudioStatus(tripId, 'uploading');
      if (recorder.state === 'recording') {
        try {
          recorder.stop();
        } catch (e: any) {
          console.warn('[SafeCheck Audio SOS] Warning in recorder.stop():', e?.message || e);
        }
      }
    };

    // Collect chunks as they arrive
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        if (onProgress) onProgress(elapsedSec);
      }
    };

    recorder.onstop = async () => {
      const stopTime = Date.now();
      const actualDuration = Math.max(1, Math.round((stopTime - startTime) / 1000));
      console.log(`[SafeCheck Audio SOS] 🛑 MediaRecorder.onstop fired at ${new Date(stopTime).toISOString()}. Recording duration: ${actualDuration}s, total chunks collected: ${chunks.length}`);

      // Release microphone hardware
      try {
        stream.getTracks().forEach((track) => track.stop());
      } catch (e) {}

      activeSosStream = null;
      activeSosRecorder = null;
      if (activeSosTimerId) {
        clearTimeout(activeSosTimerId);
        activeSosTimerId = null;
      }

      if (chunks.length === 0) {
        console.warn('[SafeCheck Audio SOS] ⚠️ No audio chunks collected before recorder stopped.');
        await updateTripAudioStatus(tripId, 'failed', null, 'No audio data captured by microphone.');
        return;
      }

      // Assemble final Blob from ALL collected chunks with genuine MIME type
      const finalBlob = new Blob(chunks, { type: mimeType });
      console.log(`[SafeCheck Audio SOS] 🎵 Final recorded ambient audio Blob: Size=${finalBlob.size} bytes (${(finalBlob.size / 1024).toFixed(1)} KB), Duration=${actualDuration}s, MIME="${finalBlob.type}"`);

      // Read as Data URL to store directly into the Firestore trip document
      const reader = new FileReader();
      reader.onerror = (rErr) => {
        console.error('[SafeCheck Audio SOS] ❌ FileReader error reading blob:', rErr);
        updateTripAudioStatus(tripId, 'failed', null, 'Failed to process audio recording.');
      };

      reader.onloadend = async () => {
        const dataUrl = (reader.result as string) || '';
        if (!dataUrl) {
          console.warn('[SafeCheck Audio SOS] ⚠️ FileReader produced empty dataUrl');
          await updateTripAudioStatus(tripId, 'failed', null, 'Empty audio stream generated.');
          return;
        }

        const audioId = `audio_${tripId}_${Date.now()}`;
        const evidence: AudioEvidence = {
          id: audioId,
          tripId,
          alertId: tripId,
          userId,
          audioDataUrl: dataUrl,
          download_url: dataUrl,
          recordedAt: startTimeIso,
          durationSeconds: actualDuration,
          mimeType,
        };
        latestAudioSnapshot = evidence;
        try {
          sessionStorage.setItem('safecheck_latest_audio_snapshot', JSON.stringify(evidence));
        } catch {}

        // CRITICAL: Immediately update Firestore trip document with 'ready' status & base64 audio!
        // This rides along with the Guardian view's real-time onSnapshot listener on 'trips/${tripId}'.
        const updateSuccess = await updateTripAudioStatus(tripId, 'ready', evidence);
        if (!updateSuccess) {
          console.warn(`[SafeCheck Audio SOS] Trip document "${tripId}" does not exist in Firestore. Skipping evidence write.`);
          return;
        }

        // Also write to top-level sos_audio_evidence collection in Firestore
        try {
          if (db) {
            await setDoc(doc(db, 'sos_audio_evidence', audioId), {
              audio_id: audioId,
              trip_id: tripId,
              sos_id: tripId,
              user_id: userId,
              download_url: dataUrl,
              duration_seconds: actualDuration,
              recorded_at: startTimeIso,
              file_size_bytes: finalBlob.size,
              mime_type: mimeType,
              created_at: new Date().toISOString(),
            }, { merge: true });
          }
        } catch (sosAudioErr) {
          console.warn('[SafeCheck Audio SOS] sos_audio_evidence write notice:', sosAudioErr);
        }

        // Background non-blocking archival upload
        try {
          const { uploadAndLogAudioEvidence } = await import('./sosService');
          uploadAndLogAudioEvidence({
            tripId,
            sosId: tripId,
            userId,
            audioBlobOrDataUrl: finalBlob,
            recordedAt: startTimeIso,
            durationSeconds: actualDuration,
            mimeType,
          }).catch((uploadErr) => {
            console.warn('[SafeCheck Audio SOS] Background upload notice (non-blocking):', uploadErr);
          });
        } catch {}
      };
      reader.readAsDataURL(finalBlob);
    };

    // Start recorder with 1-second timeslice so chunks generate continuously
    recorder.start(1000);
    console.log(`[SafeCheck Audio SOS] ▶️ Live ambient recording started at ${startTimeIso} (intended duration: ${durationSeconds}s)`);

    const targetTimeoutMs = (durationSeconds || 30) * 1000;
    activeSosTimerId = setTimeout(() => {
      safeStopRecorder(`Intended duration timer elapsed (${targetTimeoutMs}ms)`);
    }, targetTimeoutMs);

    return { success: true };
  } catch (err: any) {
    console.error('[SafeCheck Audio SOS] ❌ Error initializing MediaRecorder:', err);
    const errMsg = err?.message || 'MediaRecorder failed to start';
    updateTripAudioStatus(tripId, 'failed', null, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Manually stops the active SOS audio recording session early (e.g. if the user resolves SOS).
 * Gracefully flushes and uploads whatever audio was recorded up to this point.
 */
export function stopSosAudioRecording(reason: string = 'Explicit call to stopSosAudioRecording'): void {
  console.log(`[SafeCheck Audio SOS] 🛑 stopSosAudioRecording() invoked - Reason: "${reason}" at ${new Date().toISOString()}`);
  if (activeSosRecorder && activeSosRecorder.state === 'recording') {
    try {
      activeSosRecorder.stop();
    } catch (e) {}
  }
}

/**
 * Returns whether an SOS emergency recording is currently active.
 */
export function isSosRecordingActive(): boolean {
  return Boolean(activeSosRecorder && activeSosRecorder.state === 'recording');
}

/**
 * Captures live microphone audio evidence on demand.
 * Prompts for permission and records real ambient audio.
 * NEVER returns synthetic tones or fake WAV fallbacks.
 */
export async function captureMicrophoneAudioEvidence(
  durationSeconds: number = DEFAULT_SOS_AUDIO_DURATION_SECONDS
): Promise<AudioEvidence> {
  console.log(`[SafeCheck Audio] Starting live microphone capture attempt (target duration: ${durationSeconds}s) at ${new Date().toISOString()}...`);

  if (!isAudioSnapshotSupported()) {
    throw new Error('Microphone audio recording is not supported in this browser environment.');
  }

  const stream = await requestMicrophoneStream();
  const audioTracks = stream.getAudioTracks();
  console.log(`[SafeCheck Audio] Microphone permission GRANTED! Active audio tracks: ${audioTracks.length} (${audioTracks.map((t) => t.label || 'AudioTrack').join(', ')})`);

  const mimeType = getSupportedMimeType();
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];
  const startTime = Date.now();

  return new Promise<AudioEvidence>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
      }
    };

    recorder.onerror = (errEvent: any) => {
      console.error('[SafeCheck Audio] MediaRecorder error:', errEvent);
      try { stream.getTracks().forEach((t) => t.stop()); } catch {}
      reject(new Error('Audio recording hardware error.'));
    };

    recorder.onstop = () => {
      const stopTime = Date.now();
      const actualDuration = Math.max(1, Math.round((stopTime - startTime) / 1000));
      try {
        stream.getTracks().forEach((track) => track.stop());
      } catch {}

      if (chunks.length === 0) {
        reject(new Error('No microphone audio data captured.'));
        return;
      }

      const blob = new Blob(chunks, { type: mimeType });
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = (reader.result as string) || '';
        const evidence: AudioEvidence = {
          audioDataUrl: dataUrl,
          recordedAt: new Date(startTime).toISOString(),
          durationSeconds: actualDuration,
          mimeType,
        };
        latestAudioSnapshot = evidence;
        try {
          sessionStorage.setItem('safecheck_latest_audio_snapshot', JSON.stringify(evidence));
        } catch {}
        resolve(evidence);
      };
      reader.onerror = () => reject(new Error('Failed to encode audio data URL.'));
      reader.readAsDataURL(blob);
    };

    recorder.start(1000);

    setTimeout(() => {
      if (recorder.state === 'recording') {
        try {
          recorder.stop();
        } catch {}
      }
    }, durationSeconds * 1000);
  });
}

/**
 * Returns the latest in-memory audio snapshot.
 */
export function getLatestAudioSnapshot(): AudioEvidence | null {
  if (latestAudioSnapshot) return latestAudioSnapshot;
  try {
    const raw = sessionStorage.getItem('safecheck_latest_audio_snapshot');
    if (raw) {
      latestAudioSnapshot = JSON.parse(raw);
      return latestAudioSnapshot;
    }
  } catch (e) {}
  return null;
}

/**
 * Freezes and captures the latest audio evidence upon SOS trigger.
 * If a rolling recording is active, flushes and captures the real ambient slice.
 * If no real recording is available, returns null.
 * NEVER generates synthetic mock tones or fake WAV audio.
 */
export async function freezeAudioSnapshot(): Promise<AudioEvidence | null> {
  clearTimeout(rollingTimerId);
  console.log('[SafeCheck Audio] freezeAudioSnapshot() called. Evaluating active recording state...');

  // 1. If rolling recorder is actively recording during a trip, flush and seal the active recording
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.log('[SafeCheck Audio] Active rolling trip recording detected. Flushing active buffer for SOS...');
    try {
      const activeRec = mediaRecorder;
      const flushPromise = new Promise<AudioEvidence | null>((resolve) => {
        const prevOnStop = activeRec.onstop;
        activeRec.onstop = (ev) => {
          if (prevOnStop) {
            try { prevOnStop.call(activeRec, ev); } catch (e) {}
          }
          // Poll briefly for FileReader in onstop to set latestAudioSnapshot
          let attempts = 0;
          const poll = setInterval(() => {
            attempts++;
            const snap = getLatestAudioSnapshot();
            if (snap && snap.audioDataUrl) {
              clearInterval(poll);
              resolve(snap);
            } else if (attempts >= 10) {
              clearInterval(poll);
              resolve(getLatestAudioSnapshot());
            }
          }, 100);
        };

        try {
          if (typeof activeRec.requestData === 'function') {
            activeRec.requestData();
          }
          activeRec.stop();
        } catch (e) {
          resolve(getLatestAudioSnapshot());
        }
      });

      const flushed = await Promise.race([
        flushPromise,
        new Promise<null>((r) => setTimeout(() => r(null), 1800)),
      ]);

      if (flushed && flushed.audioDataUrl) {
        console.log('[SafeCheck Audio] Returning flushed rolling audio snapshot.');
        return flushed;
      }
    } catch (e) {
      console.warn('[SafeCheck Audio] Error flushing rolling recorder:', e);
    }
  }

  // 2. Check if a cached or rolling audio snapshot is already available in memory
  const existing = getLatestAudioSnapshot();
  if (existing && existing.audioDataUrl) {
    console.log('[SafeCheck Audio] Using existing active/cached audio snapshot.');
    return existing;
  }

  // 3. No mock tone generator! Return null if no genuine ambient audio snapshot exists yet.
  console.log('[SafeCheck Audio] No pre-existing ambient audio snapshot in RAM. Returning null.');
  return null;
}

/**
 * Safely purges all audio data and stops hardware audio streams when trip ends safely.
 */
export function purgeAudioSnapshots(): void {
  clearTimeout(rollingTimerId);

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    try {
      mediaRecorder.stop();
    } catch (e) {}
  }
  mediaRecorder = null;

  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }

  latestAudioSnapshot = null;
  currentTripId = null;

  try {
    sessionStorage.removeItem('safecheck_latest_audio_snapshot');
  } catch (e) {}
}
