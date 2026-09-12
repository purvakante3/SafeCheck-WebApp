import React from 'react';
import { ShieldCheck, Lock } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

interface FooterProps {
  onNavigate: (page: string) => void;
  onOpenSystemLogs?: () => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigate }) => {
  const { t } = useLanguage();

  return (
    <footer className="bg-white border-t border-[#EFE8E1] mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8">
          {/* Col 1: Brand & Mission */}
          <div className="space-y-3 sm:col-span-2 md:col-span-1">
            <div className="flex items-center space-x-2">
              <div className="w-7 h-7 rounded-lg bg-[#C88EA7] flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-lg text-[#3A3A3A] font-sans">SafeCheck</span>
            </div>
            <p className="text-xs text-[#6B6368] leading-relaxed max-w-sm">
              {t('footerMissionText')}
            </p>
            <div className="flex items-center space-x-1.5 text-xs text-[#9E4D71] font-medium bg-[#F9EDF3] px-3 py-1 rounded-lg border border-[#F0D0DF] w-fit">
              <Lock className="w-3 h-3" />
              <span>{t('footerPrivacyBadge')}</span>
            </div>
          </div>

          {/* Col 2: Navigation Links */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-[#6B6368] uppercase tracking-wider">Quick Links</h4>
            <ul className="space-y-2 text-xs text-[#6B6368]">
              <li>
                <button
                  id="footer-link-home"
                  onClick={() => onNavigate('home')}
                  className="hover:text-[#3A3A3A] transition-colors cursor-pointer"
                >
                  {t('navHome')}
                </button>
              </li>
              <li>
                <button
                  id="footer-link-helplines"
                  onClick={() => onNavigate('helplines')}
                  className="hover:text-[#3A3A3A] text-[#9E4D71] font-semibold transition-colors cursor-pointer"
                >
                  {t('navHelplines')} (112, 1091, 100...)
                </button>
              </li>
              <li>
                <button
                  id="footer-link-about"
                  onClick={() => onNavigate('about')}
                  className="hover:text-[#3A3A3A] transition-colors cursor-pointer"
                >
                  {t('navAbout')}
                </button>
              </li>
              <li>
                <button
                  id="footer-link-contacts"
                  onClick={() => onNavigate('contacts')}
                  className="hover:text-[#3A3A3A] transition-colors cursor-pointer"
                >
                  {t('navContacts')}
                </button>
              </li>
              <li>
                <button
                  id="footer-link-history"
                  onClick={() => onNavigate('history')}
                  className="hover:text-[#3A3A3A] transition-colors cursor-pointer"
                >
                  {t('navHistory')}
                </button>
              </li>
            </ul>
          </div>

          {/* Col 3: Direct Emergency Helplines */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-[#6B6368] uppercase tracking-wider">Emergency Helplines</h4>
            <ul className="space-y-2 text-xs text-[#6B6368]">
              <li>
                <a
                  href="tel:112"
                  id="footer-helpline-112"
                  className="hover:text-rose-800 text-rose-700 font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <span className="font-bold">112</span>
                  <span className="text-[#6B6368] font-normal">— National Emergency</span>
                </a>
              </li>
              <li>
                <a
                  href="tel:1091"
                  id="footer-helpline-1091"
                  className="hover:text-[#7C3654] text-[#9E4D71] font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <span className="font-bold">1091</span>
                  <span className="text-[#6B6368] font-normal">— Women Helpline</span>
                </a>
              </li>
              <li>
                <a
                  href="tel:100"
                  id="footer-helpline-100"
                  className="hover:text-[#3A3A3A] text-[#3A3A3A] font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <span className="font-bold">100</span>
                  <span className="text-[#6B6368] font-normal">— Police Control</span>
                </a>
              </li>
              <li>
                <button
                  id="footer-link-all-helplines"
                  onClick={() => onNavigate('helplines')}
                  className="hover:text-[#7C3654] text-[#9E4D71] font-bold text-xs underline transition-colors cursor-pointer pt-0.5 block"
                >
                  View All Helplines →
                </button>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-[#EFE8E1] flex flex-col sm:flex-row items-center justify-between text-[11px] text-[#7D757A] font-medium uppercase tracking-widest gap-2">
          <span>© {new Date().getFullYear()} SafeCheck Security Systems</span>
          <span>English • हिन्दी • मराठी Multi-Language Support Enabled</span>
        </div>
      </div>
    </footer>
  );
};
