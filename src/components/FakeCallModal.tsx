import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, Grid, Plus, User, MessageSquare, Clock } from 'lucide-react';
import { AppSettings } from '../types';
import { DEFAULT_SETTINGS } from '../services/settingsService';

interface FakeCallModalProps {
  isOpen?: boolean;
  onClose: () => void;
  settings?: AppSettings;
  callerName?: string;
  callerSubtitle?: string;
  soundEnabled?: boolean;
}

export const FakeCallModal: React.FC<FakeCallModalProps> = ({
  isOpen = true,
  onClose,
  settings,
  callerName: propCallerName,
  callerSubtitle: propCallerSubtitle,
  soundEnabled: propSoundEnabled,
}) => {
  const [callState, setCallState] = useState<'ringing' | 'connected'>('ringing');
  const [callSeconds, setCallSeconds] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSpeaker, setIsSpeaker] = useState<boolean>(false);
  const [showKeypad, setShowKeypad] = useState<boolean>(false);
  const [keypadInput, setKeypadInput] = useState<string>('');

  const audioContextRef = useRef<AudioContext | null>(null);
  const ringIntervalRef = useRef<any>(null);

  const callerName = propCallerName || settings?.fakeCallerName || DEFAULT_SETTINGS.fakeCallerName || 'Mom';
  const callerSubtitle = propCallerSubtitle || settings?.fakeCallerSubtitle || DEFAULT_SETTINGS.fakeCallerSubtitle || 'Mobile';
  const soundEnabled = propSoundEnabled ?? settings?.ringtoneEnabled ?? DEFAULT_SETTINGS.ringtoneEnabled ?? true;

  // Initialize ringtone sound generator using Web Audio API
  const startRinging = () => {
    if (!soundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const playRingBurst = () => {
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
        // US telephone standard dual frequency: 440Hz + 480Hz
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.frequency.setValueAtTime(440, ctx.currentTime);
        osc2.frequency.setValueAtTime(480, ctx.currentTime);

        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.6);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);

        osc1.start();
        osc2.start();
        osc1.stop(ctx.currentTime + 1.6);
        osc2.stop(ctx.currentTime + 1.6);
      };

      playRingBurst();
      ringIntervalRef.current = setInterval(playRingBurst, 3500);

      // Trigger vibration if available
      if ('vibrate' in navigator) {
        navigator.vibrate([600, 400, 600, 400]);
      }
    } catch (e) {
      // Audio autoplay policy fallback
    }
  };

  const stopRinging = () => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        audioContextRef.current.close();
      } catch (e) {}
      audioContextRef.current = null;
    }
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(0);
      } catch (e) {}
    }
  };

  useEffect(() => {
    if (isOpen) {
      setCallState('ringing');
      setCallSeconds(0);
      setIsMuted(false);
      setIsSpeaker(false);
      setShowKeypad(false);
      setKeypadInput('');
      startRinging();
    } else {
      stopRinging();
    }

    return () => {
      stopRinging();
    };
  }, [isOpen]);

  // Call timer when connected
  useEffect(() => {
    let timer: any = null;
    if (isOpen && callState === 'connected') {
      timer = setInterval(() => {
        setCallSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isOpen, callState]);

  const handleAccept = () => {
    stopRinging();
    setCallState('connected');
  };

  const handleDecline = () => {
    stopRinging();
    onClose();
  };

  const handleKeypadPress = (digit: string) => {
    setKeypadInput((prev) => prev + digit);
  };

  // Desktop keyboard controls for Fake Call modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopRinging();
        onClose();
        return;
      }

      if (callState === 'ringing') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleAccept();
        }
      } else if (callState === 'connected') {
        if (e.key.toLowerCase() === 'm') {
          setIsMuted((prev) => !prev);
        } else if (e.key.toLowerCase() === 's') {
          setIsSpeaker((prev) => !prev);
        } else if (e.key.toLowerCase() === 'k') {
          setShowKeypad((prev) => !prev);
        } else if (showKeypad && (/^[0-9*#]$/.test(e.key))) {
          handleKeypadPress(e.key);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, callState, showKeypad, onClose]);

  if (!isOpen) return null;

  const formatCallDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div
      id="fake-call-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md text-white font-sans select-none animate-in fade-in duration-200"
    >
      <div className="w-full max-w-sm h-full max-h-[720px] flex flex-col justify-between py-12 px-6 relative rounded-3xl overflow-hidden bg-gradient-to-b from-slate-900 via-slate-950 to-black border border-slate-800 shadow-2xl">
        {/* Top Info */}
        <div className="flex flex-col items-center text-center space-y-3 mt-4">
          <div className="w-24 h-24 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-3xl font-bold shadow-xl relative">
            <User className="w-12 h-12 text-slate-400" />
            {callState === 'ringing' && (
              <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-60 pointer-events-none" />
            )}
          </div>

          <div className="space-y-1">
            <h2 className="text-3xl font-bold tracking-tight text-white">{callerName}</h2>
            <p className="text-sm font-medium text-slate-400">
              {callState === 'ringing' ? `${callerSubtitle} • Incoming Call...` : formatCallDuration(callSeconds)}
            </p>
          </div>
        </div>

        {/* Center / Keypad Display (when in connected call) */}
        {callState === 'connected' && (
          <div className="my-auto w-full space-y-4">
            {showKeypad ? (
              <div className="space-y-3 animate-in fade-in duration-150">
                <div className="text-center text-xl font-mono tracking-widest text-emerald-400 h-8">
                  {keypadInput || ' '}
                </div>
                <div className="grid grid-cols-3 gap-3 max-w-[240px] mx-auto text-center">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => setKeypadInput((prev) => prev + digit)}
                      className="w-14 h-14 rounded-full bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-lg font-bold flex items-center justify-center transition-colors mx-auto"
                    >
                      {digit}
                    </button>
                  ))}
                </div>
                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => setShowKeypad(false)}
                    className="text-xs text-slate-400 hover:text-white underline"
                  >
                    Hide Keypad
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-6 max-w-[280px] mx-auto text-center">
                {/* Mute */}
                <div className="flex flex-col items-center space-y-1.5">
                  <button
                    id="fake-call-mute-btn"
                    type="button"
                    onClick={() => setIsMuted(!isMuted)}
                    className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                      isMuted ? 'bg-white text-slate-900' : 'bg-slate-800/80 hover:bg-slate-700 text-white'
                    }`}
                  >
                    {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                  </button>
                  <span className="text-[11px] text-slate-400 font-medium">Mute</span>
                </div>

                {/* Keypad */}
                <div className="flex flex-col items-center space-y-1.5">
                  <button
                    id="fake-call-keypad-btn"
                    type="button"
                    onClick={() => setShowKeypad(true)}
                    className="w-14 h-14 rounded-full bg-slate-800/80 hover:bg-slate-700 active:bg-slate-600 text-white flex items-center justify-center transition-colors"
                  >
                    <Grid className="w-6 h-6" />
                  </button>
                  <span className="text-[11px] text-slate-400 font-medium">Keypad</span>
                </div>

                {/* Speaker */}
                <div className="flex flex-col items-center space-y-1.5">
                  <button
                    id="fake-call-speaker-btn"
                    type="button"
                    onClick={() => setIsSpeaker(!isSpeaker)}
                    className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                      isSpeaker ? 'bg-white text-slate-900' : 'bg-slate-800/80 hover:bg-slate-700 text-white'
                    }`}
                  >
                    {isSpeaker ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
                  </button>
                  <span className="text-[11px] text-slate-400 font-medium">Speaker</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bottom Actions */}
        <div className="w-full">
          {callState === 'ringing' ? (
            <div className="space-y-8">
              {/* Quick Remind / Message subtle row */}
              <div className="flex justify-around text-slate-400 text-xs px-6">
                <div className="flex flex-col items-center space-y-1 opacity-70">
                  <Clock className="w-5 h-5" />
                  <span>Remind Me</span>
                </div>
                <div className="flex flex-col items-center space-y-1 opacity-70">
                  <MessageSquare className="w-5 h-5" />
                  <span>Message</span>
                </div>
              </div>

              {/* Decline & Accept Buttons */}
              <div className="flex items-center justify-around px-4">
                {/* Decline */}
                <div className="flex flex-col items-center space-y-2">
                  <button
                    id="decline-fake-call-btn"
                    type="button"
                    onClick={handleDecline}
                    className="w-18 h-18 rounded-full bg-rose-600 hover:bg-rose-700 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-rose-900/50 transition-all cursor-pointer"
                  >
                    <PhoneOff className="w-8 h-8" />
                  </button>
                  <span className="text-xs font-medium text-slate-300">Decline</span>
                </div>

                {/* Accept */}
                <div className="flex flex-col items-center space-y-2">
                  <button
                    id="accept-fake-call-btn"
                    type="button"
                    onClick={handleAccept}
                    className="w-18 h-18 rounded-full bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-emerald-900/50 transition-all cursor-pointer animate-bounce"
                  >
                    <Phone className="w-8 h-8" />
                  </button>
                  <span className="text-xs font-medium text-slate-300">Accept</span>
                </div>
              </div>
            </div>
          ) : (
            /* End Call Button */
            <div className="flex flex-col items-center space-y-2">
              <button
                id="end-fake-call-btn"
                type="button"
                onClick={handleDecline}
                className="w-18 h-18 rounded-full bg-rose-600 hover:bg-rose-700 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-rose-900/50 transition-all cursor-pointer mx-auto"
              >
                <PhoneOff className="w-8 h-8" />
              </button>
              <span className="text-xs font-medium text-slate-300">End Call</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
