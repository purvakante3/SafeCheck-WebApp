import React from 'react';
import { X, Siren, QrCode, ShieldCheck } from 'lucide-react';
import { EmergencyQRCard } from './EmergencyQRCard';
import { Trip } from '../types';

interface EmergencyQRExchangeModalProps {
  isOpen: boolean;
  trip: Trip;
  isSosMode?: boolean;
  onClose: () => void;
}

export const EmergencyQRExchangeModal: React.FC<EmergencyQRExchangeModalProps> = ({
  isOpen,
  trip,
  isSosMode = false,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-[#1A1A1A]/85 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl relative border-2 border-[#C88EA7]">
        {/* Top Header */}
        <div
          className={`p-5 sm:p-6 flex items-center justify-between ${
            isSosMode ? 'bg-rose-700 text-white' : 'bg-[#FAF6F3] border-b border-[#EFE8E1] text-[#3A3A3A]'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            {isSosMode ? (
              <Siren className="w-6 h-6 text-white animate-pulse" />
            ) : (
              <QrCode className="w-6 h-6 text-[#9E4D71]" />
            )}
            <div>
              <h2 className="font-extrabold text-base sm:text-lg uppercase tracking-tight">
                {isSosMode ? '🚨 Emergency QR Handoff' : '🛡️ Guardian Companion QR Code'}
              </h2>
              <p className="text-xs opacity-90">
                {isSosMode
                  ? 'Show to responders or security for instant live location'
                  : 'Share live trip status with family or trusted companions'}
              </p>
            </div>
          </div>

          <button
            id="close-qr-modal-btn"
            onClick={onClose}
            className={`p-2 rounded-full transition-colors cursor-pointer ${
              isSosMode ? 'hover:bg-rose-800 text-white' : 'hover:bg-[#EFE8E1] text-[#7D757A]'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body with QR Code Card */}
        <div className="p-6 sm:p-7 space-y-4">
          <EmergencyQRCard trip={trip} isSosMode={isSosMode} />

          <div className="text-center pt-2">
            <button
              id="dismiss-qr-modal-bottom-btn"
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] font-bold text-xs border border-[#EFE8E1] transition-all cursor-pointer"
            >
              Close Handoff Screen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
