import React from 'react';
import { ShieldCheck, Lock, BellRing, Users, ArrowRight, CheckCircle2, PhoneCall } from 'lucide-react';
import { UserProfile } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface HomeProps {
  user: UserProfile | null;
  onNavigate: (page: string) => void;
}

export const Home: React.FC<HomeProps> = ({ user, onNavigate }) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-12 pb-8">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-3xl bg-white border border-[#EFE8E1] text-[#3A3A3A] p-8 sm:p-12 shadow-xs">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-[#F9EDF3] rounded-full blur-3xl pointer-events-none opacity-80" />

        <div className="relative max-w-3xl space-y-6">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#F9EDF3] border border-[#F0D0DF] text-[#9E4D71] text-xs font-bold uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-[#9E4D71]" />
            <span>{t('heroTagline')}</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold text-[#3A3A3A] tracking-tight leading-tight">
            {t('heroTitle')}
          </h1>

          <p className="text-base sm:text-lg text-[#6B6368] leading-relaxed font-sans">
            {t('heroDesc')}
          </p>

          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {user ? (
              <button
                id="hero-start-trip-btn"
                onClick={() => onNavigate('start-trip')}
                className="flex items-center justify-center space-x-2 px-6 py-3.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-sm shadow-sm transition-all hover:scale-[1.01]"
              >
                <span>{t('startCheckInBtn')}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                id="hero-get-started-btn"
                onClick={() => onNavigate('auth')}
                className="flex items-center justify-center space-x-2 px-6 py-3.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-sm shadow-sm transition-all hover:scale-[1.01]"
              >
                <span>{t('getStartedFreeBtn')}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            <button
              id="hero-how-it-works-btn"
              onClick={() => onNavigate('about')}
              className="flex items-center justify-center space-x-2 px-6 py-3.5 rounded-xl bg-white hover:bg-[#FAF6F3] text-[#3A3A3A] border border-[#EFE8E1] font-semibold text-sm transition-all"
            >
              <span>{t('learnHowItWorksBtn')}</span>
            </button>
          </div>

          <div className="pt-4 flex flex-wrap items-center gap-6 text-xs text-[#6B6368] border-t border-[#EFE8E1]">
            <span className="flex items-center space-x-1.5 text-[#9E4D71] font-medium">
              <CheckCircle2 className="w-4 h-4 text-[#9E4D71]" />
              <span>{t('twoStageHighlight')}</span>
            </span>
            <span className="flex items-center space-x-1.5 text-rose-800 font-medium">
              <CheckCircle2 className="w-4 h-4 text-rose-700" />
              <span>{t('autoEmailHighlight')}</span>
            </span>
          </div>
        </div>
      </section>

      {/* Privacy Notice Highlight Box */}
      <div className="bg-[#FFFDFB] border border-[#EFE8E1] rounded-2xl p-6 flex items-start gap-4 shadow-xs">
        <div className="w-10 h-10 rounded-xl bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center justify-center shrink-0 mt-0.5">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-[#3A3A3A] mb-1">{t('privacyGuaranteeTitle')}</h4>
          <p className="text-xs text-[#6B6368] leading-relaxed">
            {t('privacyGuaranteeDesc')}
          </p>
        </div>
      </div>

      {/* The Two-Stage Escalation Explainer */}
      <section className="space-y-6">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#3A3A3A]">
            {t('whyTwoStageTitle')}
          </h2>
          <p className="text-sm text-[#6B6368]">
            {t('whyTwoStageDesc')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Step 1 */}
          <div className="bg-white border border-[#EFE8E1] p-6 rounded-2xl space-y-3 shadow-xs">
            <div className="w-8 h-8 rounded-lg bg-[#F9EDF3] text-[#9E4D71] font-bold flex items-center justify-center text-sm border border-[#F0D0DF]">
              1
            </div>
            <h3 className="font-bold text-[#3A3A3A] text-base">{t('step1Title')}</h3>
            <p className="text-xs text-[#6B6368] leading-relaxed">
              {t('step1Desc')}
            </p>
          </div>

          {/* Step 2 */}
          <div className="bg-white border border-[#EFE8E1] p-6 rounded-2xl space-y-3 shadow-xs">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-800 font-bold flex items-center justify-center text-sm border border-amber-200">
              2
            </div>
            <h3 className="font-bold text-[#3A3A3A] text-base">{t('step2Title')}</h3>
            <p className="text-xs text-[#6B6368] leading-relaxed">
              {t('step2Desc')}
            </p>
          </div>

          {/* Step 3 */}
          <div className="bg-white border border-[#EFE8E1] p-6 rounded-2xl space-y-3 shadow-xs">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 font-bold flex items-center justify-center text-sm border border-emerald-200">
              3
            </div>
            <h3 className="font-bold text-[#3A3A3A] text-base">{t('step3Title')}</h3>
            <p className="text-xs text-[#6B6368] leading-relaxed">
              {t('step3Desc')}
            </p>
          </div>

          {/* Step 4 */}
          <div className="bg-white border border-[#EFE8E1] p-6 rounded-2xl space-y-3 shadow-xs">
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-800 font-bold flex items-center justify-center text-sm border border-rose-200">
              4
            </div>
            <h3 className="font-bold text-[#3A3A3A] text-base">{t('step4Title')}</h3>
            <p className="text-xs text-[#6B6368] leading-relaxed">
              {t('step4Desc')}
            </p>
          </div>
        </div>
      </section>

      {/* Feature Cards Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white border border-[#EFE8E1] p-6 rounded-2xl space-y-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-[#F9EDF3] text-[#9E4D71] flex items-center justify-center border border-[#F0D0DF]">
            <Lock className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-[#3A3A3A] text-lg">{t('featureNoTrackingTitle')}</h3>
          <p className="text-sm text-[#6B6368] leading-relaxed">
            {t('featureNoTrackingDesc')}
          </p>
        </div>

        <div className="bg-white border border-[#EFE8E1] p-6 rounded-2xl space-y-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-[#F9EDF3] text-[#9E4D71] flex items-center justify-center border border-[#F0D0DF]">
            <Users className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-[#3A3A3A] text-lg">{t('featureContactsTitle')}</h3>
          <p className="text-sm text-[#6B6368] leading-relaxed">
            {t('featureContactsDesc')}
          </p>
        </div>

        <div className="bg-white border border-[#EFE8E1] p-6 rounded-2xl space-y-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-[#F9EDF3] text-[#9E4D71] flex items-center justify-center border border-[#F0D0DF]">
            <BellRing className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-[#3A3A3A] text-lg">{t('featureServerChecksTitle')}</h3>
          <p className="text-sm text-[#6B6368] leading-relaxed">
            {t('featureServerChecksDesc')}
          </p>
        </div>
      </section>

      {/* Offline Emergency Helplines Quick Banner */}
      <section className="bg-gradient-to-r from-[#F9EDF3] to-[#FFFDFB] border border-[#F0D0DF] p-6 sm:p-8 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-xs">
        <div className="space-y-2 max-w-xl">
          <div className="flex items-center space-x-2 text-xs font-bold uppercase tracking-wider text-[#9E4D71]">
            <PhoneCall className="w-4 h-4" />
            <span>{t('homeHelplineBannerBadge')}</span>
          </div>
          <h3 className="text-xl sm:text-2xl font-bold text-[#3A3A3A]">
            {t('homeHelplineBannerTitle')}
          </h3>
          <p className="text-xs sm:text-sm text-[#6B6368] leading-relaxed">
            {t('homeHelplineBannerDesc')}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0 flex-wrap">
          <a
            id="home-call-112-btn"
            href="tel:112"
            className="inline-flex items-center space-x-2 px-5 py-3 rounded-xl bg-[#9E4D71] hover:bg-[#7C3654] text-white font-bold text-xs shadow-xs transition-all active:scale-95"
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>{t('homeCall112Btn')}</span>
          </a>
          <button
            id="home-view-helplines-btn"
            onClick={() => onNavigate('helplines')}
            className="inline-flex items-center space-x-2 px-5 py-3 rounded-xl bg-white hover:bg-[#FAF6F3] text-[#3A3A3A] border border-[#EFE8E1] font-bold text-xs shadow-2xs transition-colors cursor-pointer"
          >
            <span>{t('homeViewAllHelplinesBtn')}</span>
            <ArrowRight className="w-3.5 h-3.5 text-[#9E4D71]" />
          </button>
        </div>
      </section>

      {/* Call to Action Box */}
      <section className="bg-[#3A3A3A] p-8 sm:p-10 rounded-3xl text-center space-y-4 text-white shadow-lg border border-[#4A4548]">
        <h3 className="text-2xl font-bold">{t('readyToTravelTitle')}</h3>
        <p className="text-sm text-[#E2DCD5] max-w-xl mx-auto">
          {t('readyToTravelDesc')}
        </p>
        <div>
          <button
            id="cta-get-started-btn"
            onClick={() => onNavigate(user ? 'start-trip' : 'auth')}
            className="px-8 py-3.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-sm shadow-md transition-all cursor-pointer"
          >
            {user ? t('homeStartCheckInNowBtn') : t('createFreeAccountBtn')}
          </button>
        </div>
      </section>
    </div>
  );
};

