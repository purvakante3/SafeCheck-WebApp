import React from 'react';
import { LogOut, X, AlertTriangle } from 'lucide-react';

interface LogoutConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  userName?: string;
}

export const LogoutConfirmModal: React.FC<LogoutConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  userName,
}) => {
  if (!isOpen) return null;

  console.log('[LogoutConfirmModal] Rendered! isOpen =', isOpen, 'userName =', userName);

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[LogoutConfirmModal] Cancel clicked -> closing modal');
    onClose();
  };

  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[LogoutConfirmModal] Logout confirmed -> triggering onConfirm()');
    onConfirm();
  };

  return (
    <div
      id="logout-confirm-backdrop"
      className="fixed inset-0 bg-[#1A1A1A]/70 backdrop-blur-xs flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-150"
      onClick={handleCancel}
    >
      <div
        id="logout-confirm-modal"
        className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl border border-[#EFE8E1] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 bg-[#FAF6F3] border-b border-[#EFE8E1] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-[#F9EDF3] border border-[#F0D0DF] flex items-center justify-center text-[#9E4D71] shadow-xs shrink-0">
              <LogOut className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#3A3A3A]">Log Out of SafeCheck</h2>
              <p className="text-xs text-[#7D757A]">You'll need to log back in next time</p>
            </div>
          </div>
          <button
            id="btn-close-logout-modal"
            onClick={handleCancel}
            aria-label="Close"
            className="p-2 rounded-xl text-[#7D757A] hover:text-[#3A3A3A] hover:bg-[#EFE8E1]/60 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          <p className="text-sm text-[#5A5558] leading-relaxed">
            Are you sure you want to log out{userName ? `, ${userName}` : ''}? You will need to sign back in to start active check-ins or manage your emergency contacts.
          </p>

          <div className="bg-[#FAF6F3] border border-[#EFE8E1] rounded-2xl p-3.5 flex items-start space-x-2.5 text-xs text-[#6B6368]">
            <AlertTriangle className="w-4 h-4 text-[#9E4D71] shrink-0 mt-0.5" />
            <span>Your saved contacts, safe zones, and trip logs remain securely stored in your account.</span>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="p-4 sm:p-6 bg-white border-t border-[#EFE8E1] flex items-center justify-end space-x-3">
          <button
            id="btn-cancel-logout"
            type="button"
            onClick={handleCancel}
            className="px-4 py-2.5 rounded-xl border border-[#EFE8E1] text-[#5A5558] hover:bg-[#FAF6F3] hover:text-[#3A3A3A] font-semibold text-sm transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            id="btn-confirm-logout"
            type="button"
            onClick={handleConfirm}
            className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-semibold text-sm transition-all shadow-sm flex items-center space-x-2 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  );
};
