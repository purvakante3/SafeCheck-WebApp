import React, { useState, useEffect, useRef } from 'react';
import { Mic, ShieldCheck, AlertCircle, Trash2, Info, Lock } from 'lucide-react';
import { AudioEvidence } from '../types';
import {
  isAudioSnapshotSupported,
  startRollingAudioRecorder,
  purgeAudioSnapshots,
  getLatestAudioSnapshot,
} from '../services/audioSnapshotService';

interface AudioEvidenceRecorderProps {
  tripId: string;
  isEnabled: boolean;
  onSnapshotUpdated?: (snapshot: AudioEvidence) => void;
}

export const AudioEvidenceRecorder: React.FC<AudioEvidenceRecorderProps> = ({
  tripId,
  isEnabled,
  onSnapshotUpdated,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  // Store callbacks, active trip and started flag in refs so re-renders don't recreate or interrupt recording
  const onSnapshotUpdatedRef = useRef(onSnapshotUpdated);
  onSnapshotUpdatedRef.current = onSnapshotUpdated;
  const isStartedRef = useRef(false);
  const tripIdRef = useRef(tripId);

  const isSupported = isAudioSnapshotSupported();

  useEffect(() => {
    if (!isEnabled || !isSupported || !tripId) {
      setIsRecording(false);
      return;
    }

    // If already started for this specific trip, avoid duplicate restart on component re-renders
    if (isStartedRef.current && tripIdRef.current === tripId) {
      return;
    }

    isStartedRef.current = true;
    tripIdRef.current = tripId;
    let isMounted = true;

    async function initRecorder() {
      const result = await startRollingAudioRecorder(tripId, (snapshot) => {
        if (onSnapshotUpdatedRef.current) {
          onSnapshotUpdatedRef.current(snapshot);
        }
      });

      if (!isMounted) return;

      if (result.success) {
        setIsRecording(true);
        setHasPermission(true);
        setErrorMessage(null);
      } else {
        setIsRecording(false);
        setHasPermission(false);
        setErrorMessage(result.error || 'Failed to start audio snapshotting.');
      }
    }

    initRecorder();

    // Do NOT stop or purge the recorder on component unmount or view navigation!
    // Recordings must survive component re-renders and navigation to another screen.
    return () => {
      isMounted = false;
    };
  }, [tripId, isEnabled, isSupported]);

  if (!isEnabled || !isSupported) return null;

  return (
    <div
      id="audio-evidence-recorder-card"
      className="p-3.5 bg-slate-900/90 text-white rounded-2xl border border-slate-800 shadow-sm flex flex-col space-y-2"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="relative">
            <div className="w-7 h-7 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center">
              <Mic className="w-3.5 h-3.5" />
            </div>
            {isRecording && (
              <span className="absolute -top-1 -right-1 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-bold text-slate-100">Rolling Audio Evidence Active</span>
              <span className="px-1.5 py-0.5 bg-rose-950 text-rose-300 text-[10px] font-semibold rounded-md border border-rose-800">
                12s Buffer
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Only the last 12s is buffered in memory • Erased on safe arrival
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowInfo(!showInfo)}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
          title="Privacy & Audio Evidence Details"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>

      {/* Expandable Privacy & Lifecycle Details */}
      {showInfo && (
        <div className="p-3 bg-slate-800 rounded-xl text-xs text-slate-300 space-y-2 border border-slate-700">
          <p className="font-semibold text-white flex items-center space-x-1.5">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Zero Long-Term Storage Guarantee</span>
          </p>
          <p className="text-[11px] leading-relaxed text-slate-300">
            • <strong>Continuous Overwrite:</strong> SafeCheck only holds a single 12-second rolling slice in RAM. Older slices are wiped instantly every 12 seconds.
          </p>
          <p className="text-[11px] leading-relaxed text-slate-300">
            • <strong>Safe Arrival Purge:</strong> When you mark &quot;I&apos;m Safe&quot;, all audio buffers and microphone streams are completely destroyed.
          </p>
          <p className="text-[11px] leading-relaxed text-slate-300">
            • <strong>SOS Lock:</strong> Only if an SOS or overdue alert occurs is the final 12-second clip locked as forensic evidence.
          </p>
        </div>
      )}

      {errorMessage && (
        <div className="p-2 bg-amber-950/80 border border-amber-800 rounded-xl text-amber-200 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
