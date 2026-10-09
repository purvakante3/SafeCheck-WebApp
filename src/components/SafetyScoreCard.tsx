import React, { useState, useEffect } from 'react';
import { ShieldCheck, CheckCircle2, AlertCircle, ArrowRight, Users, MapPin, PhoneCall, Sparkles } from 'lucide-react';
import { AppSettings, EmergencyContact } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { getCurrentLocation } from '../services/locationService';

interface SafetyScoreCardProps {
  contacts: EmergencyContact[];
  settings?: AppSettings;
  onNavigate: (page: string) => void;
  compact?: boolean;
}

export const SafetyScoreCard: React.FC<SafetyScoreCardProps> = ({
  contacts,
  settings,
  onNavigate,
  compact = false,
}) => {
  const { t } = useLanguage();
  const [locationPermGranted, setLocationPermGranted] = useState<boolean>(false);
  const [checkingLoc, setCheckingLoc] = useState(false);

  useEffect(() => {
    // Check permission state via Permissions API if available
    if (typeof navigator !== 'undefined' && (navigator as any).permissions) {
      (navigator as any).permissions
        .query({ name: 'geolocation' })
        .then((result: any) => {
          setLocationPermGranted(result.state === 'granted');
          result.onchange = () => {
            setLocationPermGranted(result.state === 'granted');
          };
        })
        .catch(() => {
          // Fallback
          setLocationPermGranted(settings?.enableLocationByDefault ?? true);
        });
    } else {
      setLocationPermGranted(settings?.enableLocationByDefault ?? true);
    }
  }, [settings?.enableLocationByDefault]);

  const handleGrantLocation = async () => {
    setCheckingLoc(true);
    try {
      const res = await getCurrentLocation();
      if (res.success) {
        setLocationPermGranted(true);
      }
    } catch (e) {
      console.warn('Location grant prompt error:', e);
    } finally {
      setCheckingLoc(false);
    }
  };

  // Evaluation criteria (3 checklist items)
  const hasContacts = contacts.length > 0;
  const hasLocation = locationPermGranted;
  const hasFakeCaller = Boolean(settings?.fakeCallerName && settings.fakeCallerName.trim().length > 0);

  const items = [
    {
      id: 'contacts',
      label: t('contactsAddedLabel'),
      desc: t('contactsAddedDesc'),
      isComplete: hasContacts,
      statusText: hasContacts
        ? t('contactsCountUnit', { count: contacts.length })
        : t('noContactsAdded'),
      actionLabel: 'Add Contact',
      icon: Users,
      onClick: () => onNavigate('contacts'),
    },
    {
      id: 'location',
      label: t('locationPermLabel'),
      desc: t('locationPermDesc'),
      isComplete: hasLocation,
      statusText: hasLocation ? t('locationGranted') : t('locationNotGranted'),
      actionLabel: checkingLoc ? 'Requesting...' : 'Enable Location',
      icon: MapPin,
      onClick: handleGrantLocation,
    },
    {
      id: 'fakeCall',
      label: t('fakeCallLabel'),
      desc: t('fakeCallDesc'),
      isComplete: hasFakeCaller,
      statusText: hasFakeCaller
        ? t('fakeCallReady', { name: settings?.fakeCallerName || 'Mom' })
        : t('fakeCallDefault'),
      actionLabel: 'Configure',
      icon: PhoneCall,
      onClick: () => onNavigate('settings'),
    },
  ];

  const completedCount = items.filter((item) => item.isComplete).length;
  const totalCount = items.length;
  const percentage = Math.round((completedCount / totalCount) * 100);
  const isFullySetup = completedCount === totalCount;

  return (
    <div
      id="safety-setup-score-card"
      className="bg-white border border-[#EFE8E1] rounded-3xl p-6 sm:p-8 shadow-xs space-y-6"
    >
      {/* Header with Fraction and Progress Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#EFE8E1] pb-5">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-[#9E4D71] text-xs font-bold uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-[#9E4D71]" />
            <span>{t('safetyScoreTitle')}</span>
          </div>
          <h3 className="text-xl sm:text-2xl font-black text-[#3A3A3A] tracking-tight">
            {t('scoreFraction', { completed: completedCount, total: totalCount })}
          </h3>
          <p className="text-xs text-[#6B6368]">{t('safetyScoreSubtitle')}</p>
        </div>

        {/* Circular / Pill Score Badge */}
        <div className="flex items-center space-x-3 shrink-0">
          <div
            className={`px-4 py-2 rounded-2xl border text-xs font-black flex items-center space-x-2 shadow-2xs ${
              isFullySetup
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-[#F9EDF3] text-[#9E4D71] border-[#F0D0DF]'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isFullySetup ? 'bg-emerald-600' : 'bg-[#C88EA7] animate-pulse'
              }`}
            />
            <span>{percentage}% {isFullySetup ? t('scoreReady') : t('scoreActionRequired')}</span>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <div className="w-full h-2.5 bg-[#FAF6F3] border border-[#EFE8E1] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isFullySetup ? 'bg-emerald-600' : 'bg-[#B36D8B]'
            }`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      {/* Checklist Items */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className={`p-4 rounded-2xl border transition-all flex items-start justify-between gap-3 ${
                item.isComplete
                  ? 'bg-[#FAF6F3]/60 border-[#EFE8E1]'
                  : 'bg-white border-amber-200/80 shadow-2xs'
              }`}
            >
              <div className="flex items-start space-x-3 min-w-0 flex-1">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    item.isComplete
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}
                >
                  {item.isComplete ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <AlertCircle className="w-4 h-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-bold text-xs text-[#3A3A3A] truncate">{item.label}</span>
                  </div>
                  <p className="text-[11px] text-[#6B6368] line-clamp-1">{item.desc}</p>
                  <span
                    className={`inline-block text-[10px] font-semibold ${
                      item.isComplete ? 'text-emerald-700 font-bold' : 'text-amber-800'
                    }`}
                  >
                    {item.statusText}
                  </span>
                </div>
              </div>

              {!item.isComplete && (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="px-2.5 py-1.5 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white text-[11px] font-bold shadow-2xs transition-colors shrink-0 flex items-center space-x-1 cursor-pointer"
                >
                  <span>{item.actionLabel}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isFullySetup ? (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-2xl text-xs font-semibold flex items-center space-x-2">
          <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{t('allCompleteMsg')}</span>
        </div>
      ) : (
        <div className="flex items-center justify-between text-xs text-[#6B6368] pt-1">
          <span>Tap on any incomplete item to configure it in 1 step.</span>
        </div>
      )}
    </div>
  );
};
