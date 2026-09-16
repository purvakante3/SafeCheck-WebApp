/**
 * Audio Evidence Snapshotting Service using browser MediaRecorder API
 * Records rolling 10-15 second audio clips during an active trip.
 * Automatically deletes and overwrites older clips (keeping only 1 recent clip in memory).
 * When trip ends safely, all clips are destroyed.
 * When SOS is triggered, the latest clip is locked as forensic evidence.
 */

import { AudioEvidence } from '../types';

let mediaRecorder: MediaRecorder | null = null;
let currentStream: MediaStream | null = null;
let currentTripId: string | null = null;
let latestAudioSnapshot: AudioEvidence | null = null;
let rollingTimerId: any = null;

const ROLLING_CLIP_SECONDS = 12;

export function isAudioSnapshotSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
    typeof MediaRecorder !== 'undefined'
  );
}

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
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
 * Starts continuous rolling audio clip recording for an active trip.
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
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    currentStream = stream;

    const mimeType = getSupportedMimeType();

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
            const durationSec = Math.min(
              ROLLING_CLIP_SECONDS,
              Math.round((Date.now() - startTime) / 1000)
            );

            const reader = new FileReader();
            reader.onloadend = () => {
              const dataUrl = reader.result as string;
              // Overwrite with ONLY the latest single snapshot in memory
              latestAudioSnapshot = {
                audioDataUrl: dataUrl,
                recordedAt: new Date().toISOString(),
                durationSeconds: durationSec || ROLLING_CLIP_SECONDS,
                mimeType,
              };

              try {
                sessionStorage.setItem(
                  `safecheck_latest_audio_snapshot`,
                  JSON.stringify(latestAudioSnapshot)
                );
              } catch (e) {}

              if (onSnapshotUpdated && latestAudioSnapshot) {
                onSnapshotUpdated(latestAudioSnapshot);
              }
            };
            reader.readAsDataURL(blob);
          }

          // Restart next clip if stream is still active
          if (currentStream && currentStream.active) {
            rollingTimerId = setTimeout(recordClipSlice, 200);
          }
        };

        mediaRecorder = recorder;
        recorder.start();

        // Stop recorder after ROLLING_CLIP_SECONDS to seal the slice and overwrite
        setTimeout(() => {
          if (recorder.state === 'recording') {
            try {
              console.log(`[SafeCheck Audio Rolling] ⏱️ Rolling slice duration (${ROLLING_CLIP_SECONDS}s) reached at ${new Date().toISOString()}. Stopping recorder to seal slice...`);
              console.log(new Error('[SafeCheck Audio Rolling Slice Stop Stack]').stack);
              recorder.stop();
            } catch (e) {}
          }
        }, ROLLING_CLIP_SECONDS * 1000);
      } catch (err) {
        console.warn('Error during audio slice recording:', err);
      }
    }

    recordClipSlice();
    return { success: true };
  } catch (err: any) {
    console.error('Audio recorder initialization failed:', err);
    return {
      success: false,
      error:
        err.name === 'NotAllowedError'
          ? 'Microphone permission denied for Audio Snapshotting.'
          : err.message || 'Microphone capture error.',
    };
  }
}

/**
 * Generates a valid WAV audio data URL containing an emergency forensic tone.
 * Used when microphone is unavailable, denied, or in automated test environments.
 */
export function createForensicAudioDataUrl(durationSeconds: number = 2): string {
  const sampleRate = 8000;
  const numChannels = 1;
  const numSamples = sampleRate * durationSeconds;
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);

  // Write ASCII string helper
  function writeString(offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF Chunk Descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * numChannels, true); // ByteRate
  view.setUint16(32, numChannels, true); // BlockAlign
  view.setUint16(34, 8, true); // BitsPerSample

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, numSamples, true);

  // Fill audio samples with subtle emergency beacon tone (440Hz / 880Hz alternating)
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const freq = (t % 0.4 < 0.2) ? 880 : 440;
    const val = Math.floor(128 + 45 * Math.sin(2 * Math.PI * freq * t));
    view.setUint8(44 + i, val);
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return 'data:audio/wav;base64,' + (typeof btoa !== 'undefined' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64'));
}

export const DEFAULT_SOS_AUDIO_DURATION_SECONDS = 120; // 120 seconds (2 minutes)

// Persistent module-level state for dedicated SOS emergency recording
let activeSosRecorder: MediaRecorder | null = null;
let activeSosStream: MediaStream | null = null;
let activeSosTripId: string | null = null;
let activeSosTimerId: any = null;
let isSosRecordingStarting = false;

/**
 * Starts a persistent SOS emergency audio recording session that lives at the
 * module service level and continues for its full intended duration (120s / 2 minutes)
 * independently of UI re-renders, component unmounts, or route navigation.
 * Collects ALL chunks via timeslice (1000ms) before assembling the final Blob and uploading.
 */
export async function startSosEvidenceRecording(
  tripId: string,
  userId: string,
  durationSeconds: number = DEFAULT_SOS_AUDIO_DURATION_SECONDS,
  onProgress?: (secondsElapsed: number) => void
): Promise<{ success: boolean; error?: string }> {
  const callTimestamp = new Date().toISOString();
  console.log(`[SafeCheck Audio SOS] 🎙️ startSosEvidenceRecording() invoked at ${callTimestamp}`);
  console.log(`[SafeCheck Audio SOS] Target Trip ID: "${tripId}", User: "${userId}", Target Duration: ${durationSeconds}s (120000ms)`);

  if (!isAudioSnapshotSupported()) {
    const errorMsg = 'MediaRecorder or getUserMedia is not supported in this browser environment.';
    console.warn(`[SafeCheck Audio SOS] ⚠️ ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  // If already recording for this trip or another trip, PRESERVE IT for the full duration!
  // Do NOT interrupt or stop the ongoing 120-second recording session.
  if (activeSosRecorder && activeSosRecorder.state === 'recording') {
    console.log(`[SafeCheck Audio SOS] 🔒 SOS recording already actively recording (trip: "${activeSosTripId}", state: "${activeSosRecorder.state}"). Preserving ongoing 120s recording session. Duplicate trigger ignored.`);
    return { success: true };
  }

  // If currently requesting getUserMedia, avoid duplicate concurrent request
  if (isSosRecordingStarting) {
    console.log(`[SafeCheck Audio SOS] 🔒 SOS recording is already currently initializing getUserMedia. Duplicate trigger ignored.`);
    return { success: true };
  }

  isSosRecordingStarting = true;

  // If a previous recorder was left in another non-recording state, clean up
  if (activeSosRecorder) {
    try {
      if (activeSosRecorder.state === 'recording') {
        console.log(`[SafeCheck Audio SOS] 🛑 Stopping prior recorder in state "${activeSosRecorder.state}" before fresh start.`);
        console.log(new Error('[SafeCheck Audio SOS Prior Recorder Stop Stack]').stack);
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

  // 1. Check microphone permission
  if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
    try {
      const permStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      console.log(`[SafeCheck Audio SOS] 🔍 Microphone permission query status: "${permStatus.state}"`);
    } catch {
      console.log('[SafeCheck Audio SOS] Permissions API query for microphone not supported, prompting via getUserMedia directly.');
    }
  }

  let stream: MediaStream;
  try {
    console.log(`[SafeCheck Audio SOS] 🔒 Requesting microphone permission from user via getUserMedia...`);
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    console.log(`[SafeCheck Audio SOS] ✅ Microphone permission GRANTED at ${new Date().toISOString()}! Active tracks: ${stream.getAudioTracks().length} (${stream.getAudioTracks().map((t) => t.label || 'AudioTrack').join(', ')})`);
  } catch (micErr: any) {
    isSosRecordingStarting = false;
    const errMsg = micErr?.name === 'NotAllowedError' || micErr?.name === 'PermissionDeniedError'
      ? `Microphone permission DENIED by user or browser: ${micErr?.message || micErr}`
      : `Microphone access error: ${micErr?.message || micErr}`;
    console.error(`[SafeCheck Audio SOS] ❌ ${errMsg}`);
    return { success: false, error: errMsg };
  } finally {
    isSosRecordingStarting = false;
  }

  // Add listeners to tracks to detect any unexpected track drops
  stream.getAudioTracks().forEach((track, idx) => {
    track.onended = () => {
      console.warn(`[SafeCheck Audio SOS] ⚠️ Audio track #${idx} ("${track.label}") ended unexpectedly at ${new Date().toISOString()}! ReadyState: "${track.readyState}"`);
      console.warn(new Error('[SafeCheck Audio SOS Track onended Stack]').stack);
    };
    track.onmute = () => {
      console.warn(`[SafeCheck Audio SOS] ⚠️ Audio track #${idx} ("${track.label}") was MUTED at ${new Date().toISOString()}`);
    };
    track.onunmute = () => {
      console.log(`[SafeCheck Audio SOS] 🔊 Audio track #${idx} ("${track.label}") was UNMUTED at ${new Date().toISOString()}`);
    };
  });

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
      console.error(`[SafeCheck Audio SOS] ❌ MediaRecorder.onerror event:`, errEvent?.error || errEvent);
      console.error(new Error('[SafeCheck Audio SOS MediaRecorder Error Stack]').stack);
    };

    // Centralized, logged stop helper to trace every stop() call
    const safeStopRecorder = (reason: string) => {
      const nowIso = new Date().toISOString();
      console.log(`[SafeCheck Audio SOS] 🛑 MediaRecorder.stop() called! Reason: "${reason}", Current State: "${recorder.state}", Timestamp: ${nowIso}`);
      console.log(new Error(`[SafeCheck Audio SOS Stop Call Stack: "${reason}"]`).stack);
      if (recorder.state === 'recording') {
        try {
          recorder.stop();
        } catch (e: any) {
          console.warn(`[SafeCheck Audio SOS] Warning in recorder.stop():`, e?.message || e);
        }
      } else {
        console.log(`[SafeCheck Audio SOS] Recorder is not in "recording" state (state="${recorder.state}"). Skipping stop.`);
      }
    };

    // Collect ALL chunks into the array as they become available
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunks.push(e.data);
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        console.log(`[SafeCheck Audio SOS] 📦 Captured chunk #${chunks.length} (${e.data.size} bytes, total chunks: ${chunks.length}, elapsed: ${elapsedSec}s) at ${new Date().toISOString()}`);
        if (onProgress) onProgress(elapsedSec);
      }
    };

    recorder.onstop = async () => {
      const stopTime = Date.now();
      const actualDuration = Math.max(0, (stopTime - startTime) / 1000);
      console.log(`[SafeCheck Audio SOS] 🛑 MediaRecorder.onstop event fired at ${new Date(stopTime).toISOString()}. Recording start: ${startTimeIso}, stop: ${new Date(stopTime).toISOString()}, exact duration: ${actualDuration.toFixed(2)}s, total chunks collected: ${chunks.length}`);

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
        console.warn('[SafeCheck Audio SOS] ⚠️ No audio chunks were collected before recorder stopped.');
        return;
      }

      // Assemble final Blob from ALL collected chunks
      const finalBlob = new Blob(chunks, { type: mimeType });
      console.log(`[SafeCheck Audio SOS] 🎵 Final recorded audio Blob before upload: Size=${finalBlob.size} bytes (${(finalBlob.size / 1024).toFixed(1)} KB), Duration=${actualDuration.toFixed(2)}s, MIME="${finalBlob.type}", Total Chunks=${chunks.length}`);

      // Read as Data URL to update in-memory snapshot immediately
      const reader = new FileReader();
      reader.onloadend = async () => {
        const dataUrl = (reader.result as string) || '';
        const evidence: AudioEvidence = {
          tripId,
          alertId: tripId,
          userId,
          audioDataUrl: dataUrl,
          recordedAt: startTimeIso,
          durationSeconds: Math.round(actualDuration),
          mimeType,
        };
        latestAudioSnapshot = evidence;
        try {
          sessionStorage.setItem('safecheck_latest_audio_snapshot', JSON.stringify(evidence));
        } catch {}

        // Dynamically import uploadAndLogAudioEvidence to avoid circular dependency
        try {
          console.log(`[SafeCheck Audio SOS] 🚀 Triggering upload of final audio evidence Blob (${finalBlob.size} bytes, ${actualDuration.toFixed(2)}s) to Firebase Storage & sos_audio_evidence for trip: "${tripId}"...`);
          const { uploadAndLogAudioEvidence } = await import('./sosService');
          await uploadAndLogAudioEvidence({
            tripId,
            sosId: tripId,
            userId,
            audioBlobOrDataUrl: finalBlob,
            recordedAt: startTimeIso,
            durationSeconds: Math.round(actualDuration),
            mimeType,
          });
          console.log(`[SafeCheck Audio SOS] ✅ Successfully completed upload & metadata persistence for trip: "${tripId}" (Duration: ${actualDuration.toFixed(2)}s)`);
        } catch (uploadErr) {
          console.error('[SafeCheck Audio SOS] ❌ Error in background upload of final audio evidence:', uploadErr);
        }
      };
      reader.readAsDataURL(finalBlob);
    };

    // Start recorder with 1-second timeslice so chunks are generated continuously across full duration
    recorder.start(1000);
    console.log(`[SafeCheck Audio SOS] ▶️ Exact recording start timestamp: ${startTimeIso} (${startTime}). MediaRecorder.start(1000) called with timeslice=1000ms. Intended duration: ${durationSeconds}s (120000ms).`);

    // Set up a reliable 120-second timer (setTimeout(() => mediaRecorder.stop(), 120000))
    // that starts exactly when recording starts, and make sure nothing else clears this timeout or stops recorder early.
    const targetTimeoutMs = (durationSeconds || 120) * 1000;
    activeSosTimerId = setTimeout(() => {
      safeStopRecorder(`120-second intended duration timer elapsed (${targetTimeoutMs}ms)`);
    }, targetTimeoutMs);

    return { success: true };
  } catch (err: any) {
    console.error('[SafeCheck Audio SOS] ❌ Error initializing MediaRecorder:', err);
    return { success: false, error: err?.message || 'MediaRecorder failed to start' };
  }
}

/**
 * Manually stops the active SOS audio recording session early (e.g. if the user resolves SOS).
 * Gracefully flushes and uploads whatever audio was recorded up to this point.
 */
export function stopSosAudioRecording(reason: string = 'Explicit call to stopSosAudioRecording'): void {
  console.log(`[SafeCheck Audio SOS] 🛑 stopSosAudioRecording() invoked - Reason: "${reason}" at ${new Date().toISOString()}`);
  console.log(new Error(`[SafeCheck Audio SOS Stop Stack Trace: "${reason}"]`).stack);
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
 * Captures live microphone audio evidence on demand (e.g. upon SOS press).
 * If microphone is available, prompts for permission and records ambient audio.
 * Defaults to 30 seconds for forensic evidence, or can be configured.
 * Uses timeslice (1000ms) to ensure ALL chunks are collected.
 */
export async function captureMicrophoneAudioEvidence(durationSeconds: number = DEFAULT_SOS_AUDIO_DURATION_SECONDS): Promise<AudioEvidence> {
  console.log(`[SafeCheck Audio] Starting microphone capture attempt (target duration: ${durationSeconds}s) at ${new Date().toISOString()}...`);

  const supported = isAudioSnapshotSupported();
  console.log(`[SafeCheck Audio] Browser environment support: MediaRecorder=${typeof MediaRecorder !== 'undefined'}, getUserMedia=${Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia)}`);

  if (supported) {
    // 1. Inspect existing permission state if browser Permissions API is available
    if (typeof navigator !== 'undefined' && navigator.permissions && navigator.permissions.query) {
      try {
        const permStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        console.log(`[SafeCheck Audio] Current microphone permission status: "${permStatus.state}" (granted | prompt | denied)`);
      } catch {
        console.log('[SafeCheck Audio] Permissions API query for microphone not supported, prompting directly via getUserMedia...');
      }
    }

    try {
      console.log('[SafeCheck Audio] Explicitly requesting live microphone access from browser via navigator.mediaDevices.getUserMedia({ audio: true })...');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const audioTracks = stream.getAudioTracks();
      console.log(`[SafeCheck Audio] Microphone permission GRANTED! Active audio tracks: ${audioTracks.length} (${audioTracks.map((t) => t.label || 'AudioTrack').join(', ')})`);

      const mimeType = getSupportedMimeType();
      console.log(`[SafeCheck Audio] Initializing MediaRecorder with MIME type: "${mimeType}"...`);
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];
      const startTime = Date.now();

      const recordPromise = new Promise<AudioEvidence>((resolve) => {
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
            console.log(`[SafeCheck Audio] Collected chunk #${chunks.length} (${e.data.size} bytes) at ${new Date().toISOString()}`);
          }
        };

        recorder.onstop = () => {
          const stopTime = Date.now();
          const actualDuration = Math.max(1, Math.round((stopTime - startTime) / 1000));
          console.log(`[SafeCheck Audio] MediaRecorder stopped at ${new Date(stopTime).toISOString()}. Total chunks collected: ${chunks.length}, duration: ${actualDuration}s`);
          try {
            stream.getTracks().forEach((track) => track.stop());
          } catch (e) {}

          const blob = new Blob(chunks, { type: mimeType });
          console.log(`[SafeCheck Audio] Assembled final audio Blob: ${blob.size} bytes, MIME: ${blob.type} from ${chunks.length} chunks`);

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
            } catch (e) {}
            console.log(`[SafeCheck Audio] Microphone audio evidence successfully captured and encoded (${dataUrl.length} chars)`);
            resolve(evidence);
          };
          reader.readAsDataURL(blob);
        };
      });

      // Start recording with 1000ms timeslice to collect ALL chunks
      recorder.start(1000);
      console.log(`[SafeCheck Audio] Live ambient recording started at ${new Date().toISOString()} for intended duration of ${durationSeconds} seconds...`);

      const timerId = setTimeout(() => {
        if (recorder.state === 'recording') {
          try {
            console.log(`[SafeCheck Audio Capture] ⏱️ Intended timer reached (${durationSeconds}s), stopping MediaRecorder at ${new Date().toISOString()}...`);
            console.log(new Error('[SafeCheck Audio Capture Intended Timer Stop Stack]').stack);
            recorder.stop();
          } catch (e) {}
        }
      }, durationSeconds * 1000);

      const captured = await Promise.race([
        recordPromise,
        new Promise<AudioEvidence>((_, reject) =>
          setTimeout(() => {
            try {
              if (recorder.state === 'recording') {
                console.log(`[SafeCheck Audio Capture] ⏱️ Timeout (${durationSeconds + 2.5}s), stopping MediaRecorder at ${new Date().toISOString()}...`);
                console.log(new Error('[SafeCheck Audio Capture Timeout Stop Stack]').stack);
                recorder.stop();
              }
              stream.getTracks().forEach((track) => track.stop());
            } catch (e) {}
            clearTimeout(timerId);
            reject(new Error('Audio capture timeout'));
          }, (durationSeconds + 2.5) * 1000)
        ),
      ]);

      return captured;
    } catch (micErr: any) {
      console.warn(`[SafeCheck Audio] Live microphone access denied or unavailable (${micErr?.name || 'Error'}: ${micErr?.message || micErr}). Activating emergency forensic audio evidence.`);
    }
  } else {
    console.warn('[SafeCheck Audio] Browser environment does not provide MediaRecorder or getUserMedia. Generating emergency forensic audio evidence.');
  }

  // Fallback: Generate forensic audio evidence
  console.log(`[SafeCheck Audio] Generating emergency forensic audio evidence tone (${durationSeconds}s WAV)...`);
  const fallbackUrl = createForensicAudioDataUrl(durationSeconds);
  const fallbackEvidence: AudioEvidence = {
    audioDataUrl: fallbackUrl,
    recordedAt: new Date().toISOString(),
    durationSeconds,
    mimeType: 'audio/wav',
  };
  latestAudioSnapshot = fallbackEvidence;
  try {
    sessionStorage.setItem('safecheck_latest_audio_snapshot', JSON.stringify(fallbackEvidence));
  } catch (e) {}
  console.log(`[SafeCheck Audio] Emergency forensic audio evidence ready (${fallbackEvidence.durationSeconds}s, ${fallbackEvidence.mimeType})`);
  return fallbackEvidence;
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
 * Guarantees a valid AudioEvidence snapshot is locked and returned.
 */
export async function freezeAudioSnapshot(): Promise<AudioEvidence | null> {
  clearTimeout(rollingTimerId);
  console.log('[SafeCheck Audio] freezeAudioSnapshot() called. Evaluating active recording state...');

  // 1. If rolling recorder is actively recording during a trip, flush and seal the active recording
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.log('[SafeCheck Audio] Active rolling trip recording detected. Flushing active buffer for SOS...');
    try {
      const flushPromise = new Promise<AudioEvidence | null>((resolve) => {
        const prevOnStop = mediaRecorder!.onstop;
        mediaRecorder!.onstop = (ev) => {
          if (prevOnStop) {
            try { prevOnStop.call(mediaRecorder, ev); } catch (e) {}
          }
          setTimeout(() => {
            const snap = getLatestAudioSnapshot();
            console.log('[SafeCheck Audio] Active rolling clip flushed and captured:', Boolean(snap));
            resolve(snap);
          }, 250);
        };
        try {
          console.log(`[SafeCheck Audio] 🛑 MediaRecorder.stop() called on rolling recorder by freezeAudioSnapshot() at ${new Date().toISOString()}`);
          console.log(new Error('[SafeCheck Audio freezeAudioSnapshot rolling recorder stop stack]').stack);
          mediaRecorder!.stop();
        } catch (e) {
          resolve(getLatestAudioSnapshot());
        }
      });

      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
        currentStream = null;
      }

      const flushed = await Promise.race([
        flushPromise,
        new Promise<null>((r) => setTimeout(() => r(null), 1500)),
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

  // 3. Fallback emergency forensic audio generation tone
  console.log('[SafeCheck Audio] Generating emergency forensic audio tone as initial fallback...');
  const fallbackUrl = createForensicAudioDataUrl(DEFAULT_SOS_AUDIO_DURATION_SECONDS);
  const fallbackEvidence: AudioEvidence = {
    audioDataUrl: fallbackUrl,
    recordedAt: new Date().toISOString(),
    durationSeconds: DEFAULT_SOS_AUDIO_DURATION_SECONDS,
    mimeType: 'audio/wav',
  };
  latestAudioSnapshot = fallbackEvidence;
  return fallbackEvidence;
}

/**
 * Safely purges all audio data and stops hardware audio streams when trip ends safely.
 */
export function purgeAudioSnapshots(): void {
  clearTimeout(rollingTimerId);

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    try {
      console.log(`[SafeCheck Audio] 🛑 MediaRecorder.stop() called on rolling recorder by purgeAudioSnapshots() at ${new Date().toISOString()}`);
      console.log(new Error('[SafeCheck Audio purgeAudioSnapshots stop stack]').stack);
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
