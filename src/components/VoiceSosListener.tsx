import React, { useState, useEffect, useCallback } from 'react';
import { Mic, MicOff, AlertCircle, Info, ShieldAlert, Sparkles, X, Volume2 } from 'lucide-react';
import { AppSettings } from '../types';
import {
  isSpeechRecognitionSupported,
  startVoiceSosListener,
  stopVoiceSosListener,
  requestMicrophoneAccess,
} from '../services/voiceSosService';
import { playVoiceRecognitionChime } from '../utils/soundAlert';

interface VoiceSosListenerProps {
  settings: AppSettings;
  onTriggerSOS: () => void;
  onUpdateSettings?: (updated: AppSettings) => void;
}

export const VoiceSosListener: React.FC<VoiceSosListenerProps> = ({
  settings,
  onTriggerSOS,
  onUpdateSettings,
}) => {
  const [isListening, setIsListening] = useState(false);
  const [lastHeard, setLastHeard] = useState<string>('');
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [detectedToast, setDetectedToast] = useState<{ phrase: string; time: number } | null>(null);

  const wakePhrase = settings.voiceWakePhrase || 'help me';
  const isEnabled = settings.voiceSosEnabled ?? false;
  const isSupported = isSpeechRecognitionSupported();

  const handleWakeDetected = useCallback(
    (matchedPhrase: string, rawTranscript: string) => {
      console.log('🎙️ Voice SOS Wake Word Detected:', matchedPhrase, 'Transcript:', rawTranscript);
      playVoiceRecognitionChime();
      setDetectedToast({ phrase: rawTranscript || matchedPhrase, time: Date.now() });

      setTimeout(() => {
        setDetectedToast(null);
      }, 5000);

      onTriggerSOS();
    },
    [onTriggerSOS]
  );

  useEffect(() => {
    if (!isEnabled || !isSupported) {
      stopVoiceSosListener();
      setIsListening(false);
      return;
    }

    const stopListener = startVoiceSosListener({
      wakePhrase,
      onWakeDetected: handleWakeDetected,
      onInterimSpeech: (transcript) => {
        setLastHeard(transcript);
      },
      onListeningChange: (listening) => {
        setIsListening(listening);
      },
      onError: (err) => {
        console.warn('Voice SOS listener error:', err);
        setPermissionError(err);
      },
    });

    return () => {
      stopListener();
    };
  }, [isEnabled, isSupported, wakePhrase, handleWakeDetected]);

  const handleEnableVoiceSos = async () => {
    setPermissionError(null);
    const micRes = await requestMicrophoneAccess();
    if (!micRes.granted) {
      setPermissionError(micRes.error || 'Microphone access is required to listen for voice emergency commands.');
      return;
    }

    setShowPermissionModal(false);
    if (onUpdateSettings) {
      onUpdateSettings({
        ...settings,
        voiceSosEnabled: true,
      });
    }
  };

  const handleDisableVoiceSos = () => {
    stopVoiceSosListener();
    setIsListening(false);
    if (onUpdateSettings) {
      onUpdateSettings({
        ...settings,
        voiceSosEnabled: false,
      });
    }
  };

  return (
    <>
      {/* Toast alert when wake phrase was detected */}
      {detectedToast && (
        <div
          id="voice-sos-detected-toast"
          className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 max-w-md w-[92%] bg-rose-900 text-white px-5 py-4 rounded-2xl shadow-2xl border-2 border-rose-400 flex items-center space-x-3 animate-bounce"
        >
          <div className="p-2 bg-rose-700 rounded-full">
            <Mic className="w-6 h-6 text-white animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-rose-100">🎙️ Emergency Voice Command Detected</p>
            <p className="text-xs text-rose-200 truncate">
              Heard: &quot;{detectedToast.phrase}&quot; • Activating SOS Alert!
            </p>
          </div>
        </div>
      )}

      {/* Floating Active Voice Indicator (Compact Pill when active) */}
      {isEnabled && isSupported && (
        <div
          id="voice-sos-active-indicator"
          className="fixed bottom-20 left-4 z-40 bg-slate-900/90 backdrop-blur text-white px-3.5 py-2 rounded-full shadow-lg border border-slate-700 flex items-center space-x-2 text-xs transition-all hover:bg-slate-800"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <span className="font-medium text-slate-200">
            Voice SOS: Say <strong className="text-emerald-400">&quot;{wakePhrase}&quot;</strong>
          </span>
          <button
            onClick={() => setShowPermissionModal(true)}
            title="Voice SOS Settings & Info"
            className="p-1 text-slate-400 hover:text-white rounded-full transition"
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Permission & Privacy Information Modal */}
      {showPermissionModal && (
        <div
          id="voice-sos-info-modal"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 relative overflow-hidden">
            <button
              onClick={() => setShowPermissionModal(false)}
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-4">
              <div className="w-12 h-12 bg-rose-100 text-rose-700 rounded-2xl flex items-center justify-center">
                <Mic className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Voice-Activated SOS</h3>
                <p className="text-xs text-slate-500">Hands-free emergency voice trigger</p>
              </div>
            </div>

            <div className="space-y-4 text-sm text-slate-600">
              <p>
                When enabled, SafeCheck uses the browser&apos;s Web Speech API to continuously listen for your
                safety wake phrase (<strong className="text-rose-700">&quot;{wakePhrase}&quot;</strong>). If you are in danger
                and cannot reach your phone screen, speaking the wake phrase immediately dispatches an SOS alert with your GPS coordinates.
              </p>

              {/* Strict Browser Limitation Disclaimer */}
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 text-xs flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-950">Important Browser Constraint:</p>
                  <p className="mt-0.5 text-amber-800 leading-relaxed">
                    Due to browser security protocols, Voice SOS operates <strong>strictly while the SafeCheck tab is open on your screen</strong>.
                    It cannot listen when your phone is locked or when switching to other apps.
                  </p>
                </div>
              </div>

              {/* Privacy Notice */}
              <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 text-slate-700 text-xs">
                <p className="font-semibold text-slate-900">🔒 Privacy Guarantee:</p>
                <p className="mt-0.5 text-slate-600">
                  Audio is processed locally by your browser. No continuous raw audio stream is sent or stored on any server.
                </p>
              </div>

              {permissionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{permissionError}</span>
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end space-x-3 pt-4 border-t border-slate-100">
              {isEnabled ? (
                <button
                  type="button"
                  onClick={handleDisableVoiceSos}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition flex items-center space-x-2"
                >
                  <MicOff className="w-4 h-4" />
                  <span>Disable Voice SOS</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleEnableVoiceSos}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-xs shadow-md transition flex items-center space-x-2"
                >
                  <Mic className="w-4 h-4" />
                  <span>Enable & Allow Microphone</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowPermissionModal(false)}
                className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
