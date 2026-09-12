import React, { useState, useRef } from 'react';
import { Play, Pause, Download, Volume2, Mic, Clock, ShieldCheck, AlertCircle } from 'lucide-react';
import { AudioEvidence } from '../types';

interface AudioEvidencePlayerProps {
  evidence: AudioEvidence;
  title?: string;
}

export const AudioEvidencePlayer: React.FC<AudioEvidencePlayerProps> = ({
  evidence,
  title = 'Recorded Audio Evidence Snapshot',
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch((e) => console.warn('Playback error:', e));
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const formattedDate = new Date(evidence.recordedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div
      id="audio-evidence-player"
      className="p-4 bg-slate-900 text-white rounded-2xl border border-slate-800 shadow-md flex flex-col space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center">
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-slate-200 tracking-wide uppercase">{title}</h4>
            <div className="flex items-center space-x-2 text-[11px] text-slate-400">
              <span className="flex items-center space-x-1">
                <Clock className="w-3 h-3" />
                <span>Captured at {formattedDate}</span>
              </span>
              <span>•</span>
              <span>{evidence.durationSeconds}s duration</span>
            </div>
          </div>
        </div>

        <a
          href={evidence.audioDataUrl}
          download={`SafeCheck_Evidence_${new Date(evidence.recordedAt).getTime()}.webm`}
          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-xs transition flex items-center space-x-1"
          title="Download Audio Evidence"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Save</span>
        </a>
      </div>

      {/* Audio Element & Controls */}
      <audio
        ref={audioRef}
        src={evidence.audioDataUrl}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        className="hidden"
      />

      <div className="flex items-center space-x-3 bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/50">
        <button
          type="button"
          onClick={togglePlay}
          className="w-10 h-10 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white rounded-xl flex items-center justify-center shadow transition shrink-0"
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 translate-x-0.5" />}
        </button>

        {/* Animated Waveform Visualizer simulation */}
        <div className="flex-1 flex items-center space-x-1 h-6">
          {[40, 75, 30, 90, 60, 45, 80, 100, 70, 50, 85, 35, 95, 65, 40, 80, 55, 90, 30, 70].map(
            (height, idx) => (
              <div
                key={idx}
                className={`w-1 rounded-full transition-all duration-200 ${
                  isPlaying
                    ? 'bg-rose-400 animate-pulse'
                    : 'bg-slate-600'
                }`}
                style={{
                  height: isPlaying ? `${Math.max(20, Math.round(height * Math.random()))}%` : `${height}%`,
                }}
              />
            )
          )}
        </div>

        <span className="text-xs font-mono text-slate-300 shrink-0">
          {currentTime.toFixed(1)}s / {evidence.durationSeconds}s
        </span>
      </div>

      <div className="text-[11px] text-slate-400 flex items-center space-x-1.5">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span>Stored securely in local forensic emergency cache.</span>
      </div>
    </div>
  );
};
