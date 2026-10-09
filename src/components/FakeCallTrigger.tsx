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
    <div className="fixed bottom-5 left-4 z-30 sm:bottom-8 sm:left-8 pointer-events-auto">
      <button
        id="fake-call-fab"
        type="button"
        onClick={trigger}
        title={`Trigger simulated incoming phone call from ${name}`}
        className="group relative flex items-center space-x-2 bg-[#2D2A2E]/95 hover:bg-[#1E1B1F] backdrop-blur-xs text-white font-bold text-xs uppercase tracking-wider py-2.5 px-3.5 sm:py-3.5 sm:px-5 rounded-full shadow-xl border border-[#4A4548] ring-1 ring-[#C88EA7]/40 transition-all hover:scale-105 active:scale-95 cursor-pointer"
      >
        <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-[#C88EA7] text-white flex items-center justify-center shadow-xs shrink-0">
          <PhoneCall className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-pulse" />
        </div>
        <div className="text-left">
          <div className="text-[11px] sm:text-xs font-bold leading-tight flex items-center gap-1">
            <span>Fake Call</span>
            <span className="text-[10px] text-rose-200 font-normal hidden md:inline">
              ({name})
            </span>
          </div>
        </div>
      </button>
    </div>
  );
};
