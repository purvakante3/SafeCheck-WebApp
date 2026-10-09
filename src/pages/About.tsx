import React from 'react';
import { ShieldCheck, Lock, BellRing, Mail, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';

export const About: React.FC = () => {
  const { t } = useLanguage();

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-8">
      {/* Header Banner */}
      <div className="bg-white border border-[#EFE8E1] p-8 rounded-3xl space-y-3 shadow-xs">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#F9EDF3] border border-[#F0D0DF] text-[#9E4D71] text-xs font-bold uppercase tracking-wider">
          <ShieldCheck className="w-4 h-4 text-[#9E4D71]" />
          <span>{t('aboutBadge')}</span>
        </div>
        <h1 className="text-3xl font-extrabold text-[#3A3A3A]">
          {t('aboutTitle')}
        </h1>
        <p className="text-sm text-[#6B6368] leading-relaxed max-w-2xl">
          {t('aboutSubtitle')}
        </p>
      </div>

      {/* Two-Stage Flow Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white border border-[#EFE8E1] p-6 rounded-2xl space-y-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-800 flex items-center justify-center border border-amber-200">
            <BellRing className="w-5 h-5 text-amber-700" />
          </div>
          <h3 className="font-bold text-[#3A3A3A] text-lg">{t('aboutStage1Title')}</h3>
          <p className="text-xs text-[#6B6368] leading-relaxed">
            {t('aboutStage1Desc')}
          </p>
        </div>

        <div className="bg-white border border-[#EFE8E1] p-6 rounded-2xl space-y-3 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-800 flex items-center justify-center border border-rose-200">
            <Mail className="w-5 h-5 text-rose-700" />
          </div>
          <h3 className="font-bold text-[#3A3A3A] text-lg">{t('aboutStage2Title')}</h3>
          <p className="text-xs text-[#6B6368] leading-relaxed">
            {t('aboutStage2Desc')}
          </p>
        </div>
      </div>

      {/* Privacy Notice Callout */}
      <div className="bg-[#FFFDFB] border border-[#EFE8E1] rounded-2xl p-6 flex items-start gap-4 shadow-xs">
        <div className="w-10 h-10 rounded-xl bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center justify-center shrink-0 mt-0.5">
          <Lock className="h-5 w-5" />
        </div>
        <div>
          <h4 className="text-sm font-bold text-[#3A3A3A] mb-1">{t('aboutPrivacyTitle')}</h4>
          <p className="text-xs text-[#6B6368] leading-relaxed">
            {t('aboutPrivacyDesc')}
          </p>
        </div>
      </div>

      {/* Server Evaluator Architecture */}
      <div className="bg-white border border-[#EFE8E1] p-8 rounded-3xl space-y-4 shadow-xs">
        <h3 className="text-xl font-bold text-[#3A3A3A]">{t('aboutEvaluatorTitle')}</h3>
        <p className="text-xs text-[#6B6368] leading-relaxed">
          {t('aboutEvaluatorDesc')}
        </p>

        <div className="pt-2 border-t border-[#EFE8E1] grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-[#6B6368]">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            <span>Automated Alert Dispatch</span>
          </div>
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            <span>Real-Time Cloud Safety Sync</span>
          </div>
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            <span>Continuous Server Protection</span>
          </div>
        </div>
      </div>
    </div>
  );
};
