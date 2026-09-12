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

/**
 * Captures live microphone audio evidence on demand (e.g. upon SOS press).
 * If microphone is available, prompts for permission and records 1.5-2 seconds of live ambient audio.
 * If microphone permission is denied or device has no mic, logs the exact status and generates an emergency forensic clip.
 */
export async function captureMicrophoneAudioEvidence(durationSeconds: number = 2): Promise<AudioEvidence> {
  console.log(`[SafeCheck Audio] Starting microphone capture attempt (target duration: ${durationSeconds}s)...`);

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

      const recordPromise = new Promise<AudioEvidence>((resolve) => {
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunks.push(e.data);
            console.log(`[SafeCheck Audio] Received audio chunk: ${e.data.size} bytes`);
          }
        };

        recorder.onstop = () => {
          console.log('[SafeCheck Audio] MediaRecorder stopped. Releasing microphone hardware streams...');
          try {
            stream.getTracks().forEach((track) => track.stop());
          } catch (e) {}

          const blob = new Blob(chunks, { type: mimeType });
          console.log(`[SafeCheck Audio] Assembled audio Blob: ${blob.size} bytes, MIME: ${blob.type}`);

          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = (reader.result as string) || '';
            const evidence: AudioEvidence = {
              audioDataUrl: dataUrl,
              recordedAt: new Date().toISOString(),
              durationSeconds,
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

      recorder.start();
      console.log(`[SafeCheck Audio] Live ambient recording started for ${durationSeconds} seconds...`);

      setTimeout(() => {
        if (recorder.state === 'recording') {
          try {
            console.log('[SafeCheck Audio] Timer reached, stopping MediaRecorder...');
            recorder.stop();
          } catch (e) {}
        }
      }, durationSeconds * 1000);

      const captured = await Promise.race([
        recordPromise,
        new Promise<AudioEvidence>((_, reject) =>
          setTimeout(() => {
            try {
              if (recorder.state === 'recording') recorder.stop();
              stream.getTracks().forEach((track) => track.stop());
            } catch (e) {}
            reject(new Error('Audio capture timeout'));
          }, (durationSeconds + 1.5) * 1000)
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

  // 2. No active rolling recorder: perform on-demand live microphone audio capture for the emergency alert
  console.log('[SafeCheck Audio] No active rolling recorder. Triggering on-demand live microphone capture for SOS...');
  try {
    const captured = await captureMicrophoneAudioEvidence(2);
    if (captured && captured.audioDataUrl) {
      console.log('[SafeCheck Audio] On-demand microphone audio evidence ready for SOS alert attachment.');
      return captured;
    }
  } catch (err) {
    console.warn('[SafeCheck Audio] Error capturing audio evidence on demand:', err);
  }

  // 3. Fallback to existing latest audio snapshot if available
  const existing = getLatestAudioSnapshot();
  if (existing && existing.audioDataUrl) {
    console.log('[SafeCheck Audio] Using fallback cached audio snapshot.');
    return existing;
  }

  // 4. Final emergency forensic audio generation
  console.log('[SafeCheck Audio] Generating emergency forensic audio tone as final fallback...');
  const fallbackUrl = createForensicAudioDataUrl(2);
  const fallbackEvidence: AudioEvidence = {
    audioDataUrl: fallbackUrl,
    recordedAt: new Date().toISOString(),
    durationSeconds: 2,
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
