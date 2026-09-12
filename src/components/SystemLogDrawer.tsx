import React, { useEffect, useState } from 'react';
import { X, RefreshCw, Mail, CheckCircle2, AlertTriangle, Shield, Play } from 'lucide-react';
import { EmailNotificationLog } from '../types';

interface SystemLogDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SystemLogDrawer: React.FC<SystemLogDrawerProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<EmailNotificationLog[]>([]);
  const [hasSmtpConfigured, setHasSmtpConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setHasSmtpConfigured(Boolean(data.hasSmtpConfigured));
      }
    } catch (e) {
      console.error('Error fetching logs:', e);
    } finally {
      setLoading(false);
    }
  };

  const triggerCheck = async () => {
    setTriggering(true);
    try {
      const res = await fetch('/api/check-trips', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setLastCheckTime(data.time ? new Date(data.time).toLocaleTimeString() : new Date().toLocaleTimeString());
        await fetchLogs();
      }
    } catch (e) {
      console.error('Error triggering check:', e);
    } finally {
      setTriggering(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
      const interval = setInterval(fetchLogs, 8000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs animate-fade-in">
      <div className="w-full max-w-lg bg-white border-l border-[#EFE8E1] text-[#3A3A3A] h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#EFE8E1] flex items-center justify-between bg-white sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center justify-center font-bold">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[#3A3A3A] text-base">Live Trip Monitor Console</h3>
              <p className="text-xs text-[#6B6368]">Background Evaluator & Dispatch Logs</p>
            </div>
          </div>
          <button
            id="close-system-logs-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#7D757A] hover:text-[#3A3A3A] hover:bg-[#FAF6F3]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="p-4 bg-[#FAF6F3] border-b border-[#EFE8E1] space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${hasSmtpConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="text-[#3A3A3A] font-semibold">
                {hasSmtpConfigured ? 'Real SMTP Gmail Configured' : 'Simulated Email Console (Preview)'}
              </span>
            </div>
            <span className="text-[#7D757A] text-[11px]">{lastCheckTime ? `Checked ${lastCheckTime}` : 'Runs every 20s'}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="trigger-manual-check-btn"
              onClick={triggerCheck}
              disabled={triggering}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white text-xs font-bold transition-all shadow-xs"
            >
              <Play className={`w-3.5 h-3.5 ${triggering ? 'animate-spin' : ''}`} />
              <span>{triggering ? 'Evaluating Trips...' : 'Run Worker Check Now'}</span>
            </button>
            <button
              id="refresh-logs-btn"
              onClick={fetchLogs}
              disabled={loading}
              className="p-2 rounded-xl bg-white hover:bg-[#F3ECE5] text-[#6B6368] border border-[#EFE8E1] text-xs shadow-xs"
              title="Refresh logs"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Logs List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#FAF6F3]">
          {logs.length === 0 ? (
            <div className="text-center py-12 px-4 bg-white rounded-2xl border border-[#EFE8E1] shadow-xs">
              <Mail className="w-10 h-10 text-[#7D757A] mx-auto mb-2" />
              <p className="text-sm font-semibold text-[#3A3A3A]">No email dispatches recorded yet</p>
              <p className="text-xs text-[#6B6368] mt-1 max-w-xs mx-auto">
                Start a trip and let the timer elapse (or use 1 min demo test mode) to see Stage 1 reminder & Stage 2 emergency contact emails appear here!
              </p>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className={`p-4 rounded-2xl border text-xs space-y-2.5 transition-all shadow-xs ${
                  log.stage === 'alert'
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-bold border-b border-black/5 pb-2">
                  <span className="flex items-center gap-1.5">
                    {log.stage === 'alert' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    ) : (
                      <Mail className="w-3.5 h-3.5 text-amber-600" />
                    )}
                    <strong className="uppercase tracking-wider">
                      STAGE {log.stage === 'reminder' ? '1 REMINDER' : '2 EMERGENCY ALERT'}
                    </strong>
                  </span>
                  <span className="text-[#6B6368] font-mono">{new Date(log.sentAt).toLocaleTimeString()}</span>
                </div>

                <div>
                  <p className="font-bold text-[#3A3A3A] text-xs">{log.subject}</p>
                  <p className="text-[#6B6368] text-[11px] mt-0.5">
                    <strong>To:</strong> {log.recipient}
                  </p>
                </div>

                <div className="bg-white/90 p-2.5 rounded-xl border border-black/5 font-sans text-[#3A3A3A] text-[11px] leading-relaxed">
                  {log.bodySummary}
                </div>

                <div className="flex items-center justify-between text-[10px] text-[#6B6368] pt-1">
                  <span>Destination: {log.destination}</span>
                  <span className="px-2 py-0.5 rounded-full font-semibold bg-white border border-[#EFE8E1]">
                    {log.status === 'sent' ? '✓ Sent via Nodemailer' : '⚡ Captured in Preview Logs'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-[#EFE8E1] text-[11px] text-[#6B6368] bg-white text-center font-medium">
          Automated Scheduled Cloud Function (<code className="text-[#9E4D71] font-bold">checkTrips</code>) active.
        </div>
      </div>
    </div>
  );
};
