import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, ShieldAlert, CheckCircle } from 'lucide-react';
import { playEmergencyPulseBeep, playSafeDisarmChime } from '../utils/soundAlert';

interface FallDetectionModalProps {
  isOpen: boolean;
  magnitude: number;
  initialCountdown?: number;
  onCancel: () => void;
  onConfirmSOS: () => void;
}

export const FallDetectionModal: React.FC<FallDetectionModalProps> = ({
  isOpen,
  magnitude,
  initialCountdown = 15,
  onCancel,
  onConfirmSOS,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(initialCountdown);
  const onConfirmSOSRef = useRef(onConfirmSOS);
  const onCancelRef = useRef(onCancel);
  const triggeredRef = useRef(false);

  useEffect(() => {
    onConfirmSOSRef.current = onConfirmSOS;
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    if (!isOpen) {
      setSecondsLeft(initialCountdown);
      triggeredRef.current = false;
      return;
    }

    setSecondsLeft(initialCountdown);
    triggeredRef.current = false;

    // Initial alert beep
    try {
      playEmergencyPulseBeep(920, 0.3);
    } catch {}

    let currentSec = initialCountdown;

    const interval = setInterval(() => {
      currentSec -= 1;
      if (currentSec <= 0) {
        clearInterval(interval);
        setSecondsLeft(0);
        if (!triggeredRef.current) {
          triggeredRef.current = true;
          setTimeout(() => {
            onConfirmSOSRef.current();
          }, 0);
        }
        return;
      }

      setSecondsLeft(currentSec);
      try {
        const freq = 700 + (initialCountdown - currentSec) * 50;
        playEmergencyPulseBeep(freq, 0.2);
      } catch {}
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [isOpen, initialCountdown]);

  if (!isOpen) return null;

  const progressPercent = ((initialCountdown - secondsLeft) / initialCountdown) * 100;

  const handleImOkay = () => {
    try {
      playSafeDisarmChime();
    } catch {}
    onCancelRef.current();
  };

  const handleManualSOS = () => {
    if (!triggeredRef.current) {
      triggeredRef.current = true;
      onConfirmSOSRef.current();
    }
  };

  return (
    <div
      id="fall-detection-modal"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border-4 border-amber-500 text-center relative overflow-hidden">
        {/* Urgent pulsating top banner */}
        <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
          <AlertTriangle className="w-10 h-10" />
        </div>

        <h2 className="text-2xl font-black text-slate-900 tracking-tight">
          Fall or Impact Detected!
        </h2>
        <p className="text-sm text-slate-600 mt-1 font-medium">
          A sharp sudden movement ({magnitude.toFixed(1)} m/s²) was registered.
        </p>

        {/* Big Countdown Timer Circle */}
        <div className="my-6 p-6 bg-amber-50/80 rounded-3xl border border-amber-200 flex flex-col items-center justify-center">
          <span className="text-xs uppercase tracking-wider font-bold text-amber-800 mb-1">
            Emergency SOS Auto-Dispatches in
          </span>
          <div className="text-6xl font-black text-rose-600 tracking-tighter tabular-nums animate-pulse">
            {secondsLeft}s
          </div>
          {/* Progress bar */}
          <div className="w-full bg-amber-200 h-2.5 rounded-full mt-4 overflow-hidden">
            <div
              className="bg-rose-600 h-full transition-all duration-1000 ease-linear rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <p className="text-xs text-slate-500 mb-6 leading-relaxed">
          If you do not respond, SafeCheck will automatically broadcast your live GPS location and emergency notification to your contacts.
        </p>

        <div className="flex flex-col space-y-3">
          {/* Primary Disarm Button */}
          <button
            id="fall-modal-cancel-btn"
            type="button"
            onClick={handleImOkay}
            className="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white font-bold text-lg rounded-2xl shadow-lg transition flex items-center justify-center space-x-2"
          >
            <CheckCircle className="w-6 h-6" />
            <span>I&apos;m Okay (False Alarm)</span>
          </button>

          {/* Skip Countdown / Immediate SOS Button */}
          <button
            id="fall-modal-confirm-sos-btn"
            type="button"
            onClick={handleManualSOS}
            className="w-full py-3 px-4 bg-rose-100 hover:bg-rose-200 active:scale-98 text-rose-800 font-bold text-sm rounded-xl transition flex items-center justify-center space-x-2"
          >
            <ShieldAlert className="w-4 h-4 text-rose-600" />
            <span>Trigger SOS Immediately</span>
          </button>
        </div>
      </div>
    </div>
  );
};
