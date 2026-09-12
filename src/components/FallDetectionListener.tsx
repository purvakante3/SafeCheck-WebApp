import React, { useState, useEffect, useCallback } from 'react';
import { AppSettings } from '../types';
import {
  startFallDetection,
  stopFallDetection,
  isDeviceMotionSupported,
  needsIOSMotionPermission,
  requestIOSMotionPermission,
} from '../services/fallDetectionService';
import { FallDetectionModal } from './FallDetectionModal';

interface FallDetectionListenerProps {
  settings: AppSettings;
  onTriggerSOS: () => void;
  onUpdateSettings?: (updated: AppSettings) => void;
}

export const FallDetectionListener: React.FC<FallDetectionListenerProps> = ({
  settings,
  onTriggerSOS,
  onUpdateSettings,
}) => {
  const [fallDetectedState, setFallDetectedState] = useState<{
    isOpen: boolean;
    magnitude: number;
  }>({
    isOpen: false,
    magnitude: 0,
  });

  const [iosPermissionNeeded, setIosPermissionNeeded] = useState(false);

  const isEnabled = settings.fallDetectionEnabled ?? true;
  const countdownSec = settings.fallCountdownSeconds || 15;
  const sensitivity = settings.fallSensitivity || 'medium';

  useEffect(() => {
    if (needsIOSMotionPermission()) {
      setIosPermissionNeeded(true);
    }
  }, []);

  const handleFallDetected = useCallback((magnitude: number) => {
    console.warn('⚠️ Fall / Impact Detected by accelerometer! Magnitude:', magnitude);
    setFallDetectedState({
      isOpen: true,
      magnitude,
    });
  }, []);

  useEffect(() => {
    const handleSimulateFallEvent = (e: any) => {
      const mag = e?.detail?.magnitude || 28.5;
      handleFallDetected(mag);
    };

    window.addEventListener('safecheck:simulate-fall', handleSimulateFallEvent);
    return () => {
      window.removeEventListener('safecheck:simulate-fall', handleSimulateFallEvent);
    };
  }, [handleFallDetected]);

  useEffect(() => {
    if (!isEnabled || !isDeviceMotionSupported()) {
      stopFallDetection();
      return;
    }

    const stop = startFallDetection({
      sensitivity,
      onFallDetected: handleFallDetected,
    });

    return () => {
      stop();
    };
  }, [isEnabled, sensitivity, handleFallDetected]);

  const handleCancelFall = useCallback(() => {
    setFallDetectedState({ isOpen: false, magnitude: 0 });
  }, []);

  const handleConfirmSOS = useCallback(() => {
    setFallDetectedState({ isOpen: false, magnitude: 0 });
    onTriggerSOS();
  }, [onTriggerSOS]);

  const handleRequestIOSPermission = async () => {
    const res = await requestIOSMotionPermission();
    if (res === 'granted') {
      setIosPermissionNeeded(false);
      // Restart detector with granted permission
      startFallDetection({
        sensitivity,
        onFallDetected: handleFallDetected,
      });
    }
  };

  return (
    <>
      {/* iOS Safari Explicit Permission Request Banner if pending */}
      {isEnabled && iosPermissionNeeded && (
        <div
          id="ios-motion-permission-banner"
          className="fixed bottom-20 right-4 z-40 bg-white rounded-2xl shadow-xl border-2 border-amber-400 p-3 max-w-xs text-xs flex items-center justify-between space-x-2"
        >
          <div className="text-slate-800">
            <strong className="block text-amber-900 font-semibold">Enable iOS Motion Sensor</strong>
            <span>Tap to activate Fall Detection</span>
          </div>
          <button
            onClick={handleRequestIOSPermission}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold rounded-xl shrink-0"
          >
            Allow
          </button>
        </div>
      )}

      {/* Fall / Impact Detection Modal with 15-second countdown */}
      <FallDetectionModal
        isOpen={fallDetectedState.isOpen}
        magnitude={fallDetectedState.magnitude}
        initialCountdown={countdownSec}
        onCancel={handleCancelFall}
        onConfirmSOS={handleConfirmSOS}
      />
    </>
  );
};
