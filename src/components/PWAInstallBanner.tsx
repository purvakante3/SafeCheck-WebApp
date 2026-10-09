import React, { useState } from 'react';
import { Download, Smartphone, X, Shield, Sparkles, Check } from 'lucide-react';
import { usePWAInstallPrompt } from '../hooks/usePWAInstallPrompt';

interface PWAInstallBannerProps {
  variant?: 'banner' | 'button' | 'card';
  onDismiss?: () => void;
}

export const PWAInstallBanner: React.FC<PWAInstallBannerProps> = ({
  variant = 'banner',
  onDismiss,
}) => {
  const { isInstallable, isInstalled, promptInstall } = usePWAInstallPrompt();
  const [dismissed, setDismissed] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  if (isInstalled) {
    if (variant === 'button') {
      return (
        <span className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-semibold border border-emerald-200">
          <Check className="w-3.5 h-3.5" />
          <span>App Installed</span>
        </span>
      );
    }
    return null;
  }

  if (!isInstallable || dismissed) {
    return null;
  }

  const handleInstallClick = async () => {
    setIsInstalling(true);
    await promptInstall();
    setIsInstalling(false);
  };

  const handleDismiss = () => {
    setDismissed(true);
    if (onDismiss) onDismiss();
  };

  if (variant === 'button') {
    return (
      <button
        id="pwa-install-nav-btn"
        type="button"
        onClick={handleInstallClick}
        disabled={isInstalling}
        className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-sm transition active:scale-95"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Install App</span>
      </button>
    );
  }

  if (variant === 'card') {
    return (
      <div
        id="pwa-install-card"
        className="p-5 bg-gradient-to-br from-rose-900 to-slate-900 text-white rounded-3xl shadow-lg border border-rose-700/50 relative overflow-hidden"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/20 text-rose-300 flex items-center justify-center border border-rose-500/30">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-sm text-rose-100">Install SafeCheck PWA</h4>
              <p className="text-xs text-rose-200/80">Add to Home Screen for fast 1-tap SOS & offline check-ins</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-slate-400 hover:text-white p-1 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 flex items-center space-x-3">
          <button
            onClick={handleInstallClick}
            disabled={isInstalling}
            className="px-4 py-2 bg-white hover:bg-rose-50 active:scale-95 text-rose-900 font-bold text-xs rounded-xl shadow transition flex items-center space-x-2"
          >
            <Download className="w-4 h-4 text-rose-600" />
            <span>Install Now</span>
          </button>
          <span className="text-[11px] text-slate-300">Fast, offline-ready standalone mode</span>
        </div>
      </div>
    );
  }

  // Default Banner
  return (
    <div
      id="pwa-install-banner"
      className="bg-slate-900 text-white px-4 py-3 border-b border-slate-800 flex items-center justify-between shadow-md"
    >
      <div className="flex items-center space-x-3 min-w-0">
        <div className="w-8 h-8 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0">
          <Download className="w-4 h-4" />
        </div>
        <div className="text-xs min-w-0">
          <span className="font-bold text-slate-100 block truncate">
            Install SafeCheck on your device
          </span>
          <span className="text-slate-400 text-[11px] hidden sm:inline">
            Access offline safety check-ins and fast SOS directly from your home screen.
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-2 shrink-0 ml-3">
        <button
          onClick={handleInstallClick}
          disabled={isInstalling}
          className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs rounded-xl shadow transition flex items-center space-x-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install</span>
        </button>
        <button
          onClick={handleDismiss}
          className="p-1.5 text-slate-400 hover:text-white rounded-lg transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
