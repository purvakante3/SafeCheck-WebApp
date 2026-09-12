/**
 * Voice-Activated SOS Service using Web Speech API (SpeechRecognition / webkitSpeechRecognition)
 * Listens for a configurable wake phrase (default: "help me") while the SafeCheck tab is open.
 */

// Browser SpeechRecognition interface declaration
type SpeechRecognitionInstance = any;

interface VoiceSosOptions {
  wakePhrase: string;
  onWakeDetected: (matchedPhrase: string, rawTranscript: string) => void;
  onInterimSpeech?: (transcript: string) => void;
  onError?: (errorMessage: string) => void;
  onListeningChange?: (isListening: boolean) => void;
}

let activeRecognition: SpeechRecognitionInstance | null = null;
let isExplicitlyStopped = false;
let restartTimeoutId: any = null;

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition
  );
}

export async function checkMicrophonePermission(): Promise<PermissionState | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) {
    return 'unsupported';
  }
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state;
  } catch (e) {
    return 'unsupported';
  }
}

export async function requestMicrophoneAccess(): Promise<{ granted: boolean; error?: string }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { granted: false, error: 'Microphone is not supported in this browser.' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop all tracks immediately after permission check
    stream.getTracks().forEach((track) => track.stop());
    return { granted: true };
  } catch (err: any) {
    return {
      granted: false,
      error: err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
        ? 'Microphone access was denied. Please allow microphone permissions in your browser bar.'
        : err.message || 'Microphone access failed.',
    };
  }
}

export async function requestMicrophonePermission(): Promise<boolean> {
  const res = await requestMicrophoneAccess();
  return res.granted;
}

/**
 * Normalizes phrases and checks if the transcript matches the configured wake phrase.
 */
export function matchesWakePhrase(transcript: string, configuredPhrase: string): boolean {
  if (!transcript || !configuredPhrase) return false;
  const cleanTranscript = transcript.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const cleanWake = configuredPhrase.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();

  if (cleanTranscript.includes(cleanWake)) {
    return true;
  }

  // Also catch high-urgency fallback variations if wake word is "help me" or "help"
  if (cleanWake === 'help me' || cleanWake === 'help') {
    const emergencyWords = ['help me', 'help please', 'safecheck help', 'emergency help', 'i need help', 'somebody help'];
    return emergencyWords.some((word) => cleanTranscript.includes(word));
  }

  return false;
}

/**
 * Starts continuous voice recognition listening for the wake phrase.
 * Automatically handles pauses and restarts while the tab is active.
 */
export function startVoiceSosListener(options: VoiceSosOptions): () => void {
  if (!isSpeechRecognitionSupported()) {
    if (options.onError) {
      options.onError('Web Speech API is not supported in this browser. Please use Chrome, Edge, or Safari.');
    }
    return () => {};
  }

  // Stop any previous active recognition instance
  stopVoiceSosListener();
  isExplicitlyStopped = false;

  const SpeechRecognitionClass =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  function initRecognition() {
    if (isExplicitlyStopped) return;

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      recognition.maxAlternatives = 2;

      recognition.onstart = () => {
        if (options.onListeningChange) options.onListeningChange(true);
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          const text = result[0].transcript;
          if (result.isFinal) {
            finalTranscript += ' ' + text;
          } else {
            interimTranscript += ' ' + text;
          }
        }

        const combined = `${finalTranscript} ${interimTranscript}`.trim();
        if (options.onInterimSpeech && combined) {
          options.onInterimSpeech(combined);
        }

        // Check if matched
        if (matchesWakePhrase(combined, options.wakePhrase)) {
          options.onWakeDetected(options.wakePhrase, combined);
        }
      };

      recognition.onerror = (event: any) => {
        // 'no-speech' or 'aborted' are normal lifecycle events
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          console.warn('Voice SOS Speech recognition warning:', event.error);
          if (options.onError && event.error === 'not-allowed') {
            options.onError('Microphone permission not granted for Voice SOS.');
          }
        }
      };

      recognition.onend = () => {
        if (options.onListeningChange) options.onListeningChange(false);
        // If not explicitly stopped, restart listener with slight debounce
        if (!isExplicitlyStopped) {
          clearTimeout(restartTimeoutId);
          restartTimeoutId = setTimeout(() => {
            if (!isExplicitlyStopped) {
              initRecognition();
            }
          }, 350);
        }
      };

      activeRecognition = recognition;
      recognition.start();
    } catch (err: any) {
      console.warn('Failed to start SpeechRecognition:', err);
      if (options.onError) {
        options.onError(err.message || 'Could not start voice listener.');
      }
    }
  }

  initRecognition();

  return () => {
    stopVoiceSosListener();
  };
}

export function stopVoiceSosListener(): void {
  isExplicitlyStopped = true;
  clearTimeout(restartTimeoutId);
  if (activeRecognition) {
    try {
      activeRecognition.stop();
      activeRecognition.abort();
    } catch (e) {}
    activeRecognition = null;
  }
}
