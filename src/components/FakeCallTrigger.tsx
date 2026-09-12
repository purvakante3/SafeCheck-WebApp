import React from 'react';
import { PhoneCall } from 'lucide-react';
import { AppSettings } from '../types';
import { DEFAULT_SETTINGS } from '../services/settingsService';

interface FakeCallTriggerProps {
  onTriggerFakeCall?: () => void;
  onTrigger?: () => void;
  settings?: AppSettings;
  callerName?: string;
}

export const FakeCallTrigger: React.FC<FakeCallTriggerProps> = ({
  onTriggerFakeCall,
  onTrigger,
  settings,
  callerName: propCallerName,
}) => {
  const trigger = onTrigger || onTriggerFakeCall;
  const name = propCallerName || settings?.fakeCallerName || DEFAULT_SETTINGS.fakeCallerName || 'Mom';

  return (
    <div className="fixed bottom-6 left-6 z-40 sm:bottom-8 sm:left-8">
      <button
        id="fake-call-fab"
        type="button"
        onClick={trigger}
        title={`Trigger simulated incoming phone call from ${name}`}
        className="group relative flex items-center space-x-2 bg-[#3A3A3A] hover:bg-[#2A2A2A] text-white font-bold text-xs uppercase tracking-wider py-3.5 px-4 sm:px-5 rounded-full shadow-2xl border border-[#4A4548] ring-2 ring-[#C88EA7]/30 transition-all hover:scale-105 active:scale-95 cursor-pointer"
      >
        <div className="w-6 h-6 rounded-full bg-[#C88EA7] text-white flex items-center justify-center shadow-xs">
          <PhoneCall className="w-3.5 h-3.5 animate-pulse" />
        </div>
        <div className="text-left">
          <div className="text-[11px] sm:text-xs font-bold leading-tight flex items-center gap-1">
            <span>Fake Call</span>
            <span className="text-[10px] text-rose-200 font-normal hidden sm:inline">
              ({name})
            </span>
          </div>
        </div>
      </button>
    </div>
  );
};
