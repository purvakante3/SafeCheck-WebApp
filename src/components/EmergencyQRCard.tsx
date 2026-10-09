import React, { useState, useMemo } from 'react';
import { QrCode, Share2, Copy, Check, ExternalLink, Sun, AlertTriangle, ShieldCheck } from 'lucide-react';
import { getGuardianUrl } from '../services/guardianService';
import { generateQRCodeMatrix } from '../utils/qrCodeGenerator';
import { Trip } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface EmergencyQRCardProps {
  trip: Trip;
  isSosMode?: boolean;
  compact?: boolean;
}

export const EmergencyQRCard: React.FC<EmergencyQRCardProps> = ({
  trip,
  isSosMode = false,
  compact = false,
}) => {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [highBrightness, setHighBrightness] = useState(false);

  const guardianUrl = getGuardianUrl(trip.id);

  // Generate QR Code matrix
  const qrMatrix = useMemo(() => {
    try {
      return generateQRCodeMatrix(guardianUrl);
    } catch (e) {
      console.warn('QR code generation error:', e);
      return [];
    }
  }, [guardianUrl]);

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(guardianUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch (e) {}
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `SafeCheck Emergency Guardian Link - ${trip.userName || 'SafeCheck User'}`,
          text: `Live safety status & GPS tracking for ${trip.userName || 'SafeCheck User'}. No app or account required to view:`,
          url: guardianUrl,
        });
      } catch (e) {}
    } else {
      handleCopyLink();
    }
  };

  const matrixSize = qrMatrix.length || 25;
  const cellSize = 10;
  const padding = 20;
  const svgDimension = matrixSize * cellSize + padding * 2;

  return (
    <div
      id="emergency-qr-card"
      className={`rounded-3xl transition-all ${
        highBrightness
          ? 'bg-white text-slate-950 p-6 sm:p-8 shadow-2xl ring-8 ring-white'
          : isSosMode
          ? 'bg-rose-900/90 text-white border-2 border-rose-400 p-6 sm:p-7 shadow-xl'
          : 'bg-white border-2 border-[#EFE8E1] text-[#3A3A3A] p-6 sm:p-7 shadow-sm'
      }`}
    >
      {/* Header Badge & Title */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <div
            className={`p-2 rounded-xl ${
              isSosMode ? 'bg-rose-600 text-white' : 'bg-[#F9EDF3] text-[#9E4D71]'
            }`}
          >
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <h3
              className={`font-black text-sm sm:text-base uppercase tracking-wider ${
                highBrightness ? 'text-slate-950' : isSosMode ? 'text-white' : 'text-[#3A3A3A]'
              }`}
            >
              {isSosMode ? '🚨 Emergency Responder Handoff' : '🛡️ Live Guardian QR Code'}
            </h3>
            <p
              className={`text-[11px] font-medium ${
                highBrightness ? 'text-slate-700' : isSosMode ? 'text-rose-200' : 'text-[#6B6368]'
              }`}
            >
              Scan with any phone camera • No app download or login required
            </p>
          </div>
        </div>

        {/* High-brightness toggle for night or outdoor scans */}
        <button
          id="qr-high-brightness-toggle"
          type="button"
          onClick={() => setHighBrightness((prev) => !prev)}
          className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center space-x-1 transition-all cursor-pointer ${
            highBrightness
              ? 'bg-amber-400 text-slate-950 shadow-xs'
              : isSosMode
              ? 'bg-rose-800 text-rose-100 hover:bg-rose-700'
              : 'bg-[#FAF6F3] text-[#7D757A] hover:text-[#3A3A3A] border border-[#EFE8E1]'
          }`}
          title="Toggle maximum contrast mode for easy camera scanning"
        >
          <Sun className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{highBrightness ? 'Max Light' : 'High Contrast'}</span>
        </button>
      </div>

      {/* Main QR Display */}
      <div className="flex flex-col sm:flex-row items-center gap-6 justify-center my-4">
        <div
          className={`p-4 bg-white rounded-2xl shadow-md border flex items-center justify-center ${
            isSosMode ? 'border-rose-300' : 'border-[#EFE8E1]'
          }`}
        >
          <svg
            viewBox={`0 0 ${svgDimension} ${svgDimension}`}
            width={compact ? 160 : 190}
            height={compact ? 160 : 190}
            className="w-full max-w-[200px] h-auto rounded-lg"
            shapeRendering="crispEdges"
          >
            <rect width={svgDimension} height={svgDimension} fill="#FFFFFF" />
            {qrMatrix.map((row, r) =>
              row.map((cell, c) =>
                cell ? (
                  <rect
                    key={`${r}-${c}`}
                    x={padding + c * cellSize}
                    y={padding + r * cellSize}
                    width={cellSize}
                    height={cellSize}
                    fill="#1A1A1A"
                  />
                ) : null
              )
            )}
          </svg>
        </div>

        <div className="space-y-3 text-center sm:text-left max-w-xs">
          <div className="space-y-1">
            <div
              className={`inline-flex items-center space-x-1 text-[11px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                isSosMode
                  ? 'bg-rose-500 text-white'
                  : 'bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF]'
              }`}
            >
              {isSosMode ? <AlertTriangle className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
              <span>{isSosMode ? 'Emergency Active' : 'Live Tracking Active'}</span>
            </div>
            <p
              className={`text-xs font-bold ${
                highBrightness ? 'text-slate-900' : isSosMode ? 'text-white' : 'text-[#3A3A3A]'
              }`}
            >
              Show this to police, security, or a bystander
            </p>
            <p
              className={`text-[11px] leading-relaxed ${
                highBrightness ? 'text-slate-600' : isSosMode ? 'text-rose-100' : 'text-[#6B6368]'
              }`}
            >
              Anyone who scans will instantly see your destination, current GPS coordinates, emergency contact directory, and live status.
            </p>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap gap-2 justify-center sm:justify-start pt-1">
            <button
              id="copy-guardian-link-btn"
              type="button"
              onClick={handleCopyLink}
              className={`px-3 py-2 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition-all active:scale-[0.98] cursor-pointer shadow-2xs ${
                copied
                  ? 'bg-emerald-600 text-white'
                  : isSosMode
                  ? 'bg-white text-rose-900 hover:bg-rose-50'
                  : 'bg-[#B36D8B] hover:bg-[#9E5875] text-white'
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Link Copied!' : 'Copy Link'}</span>
            </button>

            <button
              id="share-guardian-link-btn"
              type="button"
              onClick={handleShare}
              className={`px-3 py-2 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition-all active:scale-[0.98] cursor-pointer border ${
                isSosMode
                  ? 'bg-rose-800 hover:bg-rose-700 text-white border-rose-500'
                  : 'bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] border-[#EFE8E1]'
              }`}
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Share</span>
            </button>

            <a
              id="open-guardian-preview-link"
              href={guardianUrl}
              target="_blank"
              rel="noreferrer"
              className={`px-3 py-2 rounded-xl font-bold text-xs flex items-center space-x-1.5 transition-all border ${
                isSosMode
                  ? 'bg-rose-800/80 hover:bg-rose-800 text-white border-rose-500/50'
                  : 'bg-white hover:bg-[#FAF6F3] text-[#3A3A3A] border-[#EFE8E1]'
              }`}
            >
              <span>View Status</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
