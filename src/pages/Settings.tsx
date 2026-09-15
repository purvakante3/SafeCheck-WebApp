import React, { useState } from 'react';
import { Settings as SettingsIcon, PhoneCall, MapPin, Check, Save, RotateCcw, Play, ExternalLink, ShieldCheck, AlertTriangle, Volume2, Sparkles, Smartphone, BellRing, Phone, Clock, Activity, Disc, Download, Info, Globe, Copy, BatteryWarning } from 'lucide-react';
import { AppSettings } from '../types';
import { saveAppSettings, DEFAULT_SETTINGS } from '../services/settingsService';
import { getCurrentLocation, formatGoogleMapsUrl, shareLocationUrl } from '../services/locationService';
import { isDeviceMotionSupported, requestMotionPermissionIOS } from '../services/fallDetectionService';
import { isAudioSnapshotSupported } from '../services/audioSnapshotService';
import { usePWAInstallPrompt } from '../hooks/usePWAInstallPrompt';
import { useLanguage } from '../i18n/LanguageContext';
import { SupportedLanguage } from '../i18n/translations';

interface SettingsProps {
  settings?: AppSettings;
  onSave?: (newSettings: AppSettings) => void;
  onUpdateSettings?: (newSettings: AppSettings) => void;
  onTriggerFakeCall?: () => void;
  onNavigate?: (page: string) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  settings,
  onSave,
  onUpdateSettings,
  onTriggerFakeCall,
  onNavigate,
}) => {
  const { language, setLanguage, languages, t } = useLanguage();
  const currentSettings = settings || DEFAULT_SETTINGS;

  // Fake call settings
  const [callerName, setCallerName] = useState(currentSettings.fakeCallerName || DEFAULT_SETTINGS.fakeCallerName);
  const [callerSubtitle, setCallerSubtitle] = useState(currentSettings.fakeCallerSubtitle || DEFAULT_SETTINGS.fakeCallerSubtitle);
  const [ringtoneEnabled, setRingtoneEnabled] = useState(currentSettings.ringtoneEnabled ?? true);
  const [floatingFakeCallButton, setFloatingFakeCallButton] = useState(currentSettings.floatingFakeCallButton ?? true);

  // Scheduled check-in settings
  const [tripCheckInRemindersEnabled, setTripCheckInRemindersEnabled] = useState(currentSettings.tripCheckInRemindersEnabled ?? true);
  const [checkInReminderIntervalMinutes, setCheckInReminderIntervalMinutes] = useState(currentSettings.checkInReminderIntervalMinutes ?? 15);
  const [autoAlertIfNotAcknowledged, setAutoAlertIfNotAcknowledged] = useState(currentSettings.autoAlertIfNotAcknowledged ?? true);
  const [unacknowledgedTimeoutMinutes, setUnacknowledgedTimeoutMinutes] = useState(currentSettings.unacknowledgedTimeoutMinutes ?? 5);

  // Quick Dial / Helpline
  const [quickDialNumber, setQuickDialNumber] = useState(currentSettings.quickDialNumber || '1091');
  const [quickDialLabel, setQuickDialLabel] = useState(currentSettings.quickDialLabel || "Women's Safety Helpline (1091)");
  const [copiedQuickDial, setCopiedQuickDial] = useState(false);

  // Location settings
  const [enableLocationByDefault, setEnableLocationByDefault] = useState(currentSettings.enableLocationByDefault ?? true);

  // Fall Detection settings
  const [fallDetectionEnabled, setFallDetectionEnabled] = useState(currentSettings.fallDetectionEnabled ?? true);
  const [fallDetectionSensitivity, setFallDetectionSensitivity] = useState<'low' | 'medium' | 'high'>(currentSettings.fallDetectionSensitivity || 'medium');
  const [fallCountdownSeconds, setFallCountdownSeconds] = useState<number>(currentSettings.fallCountdownSeconds ?? 15);
  const [motionPermissionResult, setMotionPermissionResult] = useState<string | null>(null);

  // Audio Snapshot settings
  const [audioSnapshottingEnabled, setAudioSnapshottingEnabled] = useState(currentSettings.audioSnapshottingEnabled ?? true);

  // PWA Install hook
  const { isInstallable, isInstalled, promptInstall } = usePWAInstallPrompt();

  const [savedSuccess, setSavedSuccess] = useState(false);

  const [locationTesting, setLocationTesting] = useState(false);
  const [locationResult, setLocationResult] = useState<{
    lat?: number | null;
    lng?: number | null;
    url?: string | null;
    error?: string;
  } | null>(null);

  const handleCopyQuickDial = () => {
    try {
      navigator.clipboard?.writeText(quickDialNumber);
      setCopiedQuickDial(true);
      setTimeout(() => setCopiedQuickDial(false), 2000);
    } catch (e) {}
  };

  const handleSimulateFall = () => {
    window.dispatchEvent(new CustomEvent('safecheck:simulate-fall', { detail: { magnitude: 28.5 } }));
  };

  const handleRequestMotionPermission = async () => {
    try {
      const granted = await requestMotionPermissionIOS();
      if (granted) {
        setMotionPermissionResult(language === 'hi' ? 'मोशन सेंसर एक्सेस सक्षम हो गया!' : language === 'mr' ? 'मोशन सेन्सर अॅक्सेस सुरू झाला!' : 'Motion sensor access enabled!');
      } else {
        setMotionPermissionResult(language === 'hi' ? 'मोशन अनुमति अस्वीकृत या अनुपलब्ध।' : language === 'mr' ? 'मोशन परवानगी नाकारली किंवा अनुपलब्ध.' : 'Motion permission request declined or unavailable.');
      }
    } catch (e: any) {
      setMotionPermissionResult(e.message || 'Motion sensor error');
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: AppSettings = {
      fakeCallerName: callerName.trim() || 'Mom',
      fakeCallerSubtitle: callerSubtitle.trim() || 'Mobile',
      ringtoneEnabled,
      floatingFakeCallButton,
      enableLocationByDefault,
      tripCheckInRemindersEnabled,
      checkInReminderIntervalMinutes: Number(checkInReminderIntervalMinutes) || 15,
      autoAlertIfNotAcknowledged,
      unacknowledgedTimeoutMinutes: Number(unacknowledgedTimeoutMinutes) || 5,
      quickDialNumber: quickDialNumber.trim() || '1091',
      quickDialLabel: quickDialLabel.trim() || "Women's Safety Helpline (1091)",
      fallDetectionEnabled,
      fallSensitivity: fallDetectionSensitivity,
      fallDetectionSensitivity,
      fallCountdownSeconds: Number(fallCountdownSeconds) || 15,
      audioSnapshottingEnabled,
    };
    saveAppSettings(updated);
    if (onSave) onSave(updated);
    if (onUpdateSettings) onUpdateSettings(updated);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const handleReset = () => {
    if (window.confirm(t('resetConfirmPrompt'))) {
      setCallerName(DEFAULT_SETTINGS.fakeCallerName);
      setCallerSubtitle(DEFAULT_SETTINGS.fakeCallerSubtitle);
      setRingtoneEnabled(DEFAULT_SETTINGS.ringtoneEnabled);
      setFloatingFakeCallButton(DEFAULT_SETTINGS.floatingFakeCallButton);
      setEnableLocationByDefault(DEFAULT_SETTINGS.enableLocationByDefault);
      setTripCheckInRemindersEnabled(DEFAULT_SETTINGS.tripCheckInRemindersEnabled);
      setCheckInReminderIntervalMinutes(DEFAULT_SETTINGS.checkInReminderIntervalMinutes);
      setAutoAlertIfNotAcknowledged(DEFAULT_SETTINGS.autoAlertIfNotAcknowledged);
      setUnacknowledgedTimeoutMinutes(DEFAULT_SETTINGS.unacknowledgedTimeoutMinutes);
      setQuickDialNumber(DEFAULT_SETTINGS.quickDialNumber);
      setQuickDialLabel(DEFAULT_SETTINGS.quickDialLabel);
      setFallDetectionEnabled(DEFAULT_SETTINGS.fallDetectionEnabled);
      setFallDetectionSensitivity(DEFAULT_SETTINGS.fallDetectionSensitivity);
      setFallCountdownSeconds(DEFAULT_SETTINGS.fallCountdownSeconds);
      setAudioSnapshottingEnabled(DEFAULT_SETTINGS.audioSnapshottingEnabled);

      saveAppSettings(DEFAULT_SETTINGS);
      if (onSave) onSave(DEFAULT_SETTINGS);
      if (onUpdateSettings) onUpdateSettings(DEFAULT_SETTINGS);

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    }
  };

  const handleTestLocation = async () => {
    setLocationTesting(true);
    setLocationResult(null);
    try {
      const res = await getCurrentLocation();
      if (res.success && res.latitude && res.longitude) {
        setLocationResult({
          lat: res.latitude,
          lng: res.longitude,
          url: res.locationUrl,
        });
      } else {
        setLocationResult({
          error: res.errorMessage || 'Unable to retrieve location coordinates.',
        });
      }
    } catch (e: any) {
      setLocationResult({ error: e.message || 'Location error' });
    } finally {
      setLocationTesting(false);
    }
  };

  const HELPLINE_PRESETS = [
    { label: "Women's (1091)", number: '1091' },
    { label: "Emergency (112)", number: '112' },
    { label: "Police (100)", number: '100' },
    { label: "Ambulance (108)", number: '108' },
    { label: "US (911)", number: '911' },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center space-x-2 text-[#9E4D71] text-xs font-bold uppercase tracking-wider">
            <SettingsIcon className="w-4 h-4 text-[#9E4D71]" />
            <span>{t('settingsBadge')}</span>
          </div>
          <h1 className="text-2xl font-bold text-[#3A3A3A]">{t('settingsTitle')}</h1>
          <p className="text-xs sm:text-sm text-[#6B6368]">
            {t('settingsSubtitle')}
          </p>
        </div>

        {savedSuccess && (
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold animate-in fade-in">
            <Check className="w-4 h-4" />
            <span>{t('settingsSavedSuccess')}</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Section 0: Multi-Language Support */}
        <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between items-start gap-3.5 border-b border-[#EFE8E1] pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center justify-center shrink-0">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-[#3A3A3A] text-base">{t('languageSectionTitle')}</h3>
                <p className="text-xs text-[#6B6368]">
                  {t('languageSectionDesc')}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {languages.map((langOpt) => {
              const isSelected = language === langOpt.code;
              return (
                <button
                  key={langOpt.code}
                  id={`lang-select-${langOpt.code}-btn`}
                  type="button"
                  onClick={() => setLanguage(langOpt.code)}
                  className={`p-4 rounded-2xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                    isSelected
                      ? 'bg-[#F9EDF3] border-[#C88EA7] shadow-xs ring-2 ring-[#C88EA7]/30'
                      : 'bg-[#FAF6F3] border-[#EFE8E1] hover:bg-[#F3ECE5]'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl">{langOpt.flag}</span>
                    <div>
                      <div className="font-bold text-sm text-[#3A3A3A]">{langOpt.nativeName}</div>
                      <div className="text-[11px] text-[#7D757A] font-medium">{langOpt.label}</div>
                    </div>
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-[#B36D8B] text-white flex items-center justify-center shrink-0">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 1: Quick-Dial Helpline (One-Tap Emergency Call) */}
        <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between items-start gap-3.5 border-b border-[#EFE8E1] pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center justify-center shrink-0">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-[#3A3A3A] text-base">{t('quickDialSectionTitle')}</h3>
                <p className="text-xs text-[#6B6368]">
                  {t('quickDialSectionDesc')}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={handleCopyQuickDial}
                className="flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] border border-[#EFE8E1] font-bold text-xs transition-all w-full sm:w-auto cursor-pointer"
                title="Copy Helpline Number"
              >
                {copiedQuickDial ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-[#9E4D71]" />}
                <span>{copiedQuickDial ? t('copiedQuickDialBtn') : t('copyQuickDialBtn')}</span>
              </button>

              <a
                id="test-quick-dial-link"
                href={`tel:${quickDialNumber}`}
                className="flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs transition-all w-full sm:w-auto cursor-pointer"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>{t('quickDialCallBtn', { num: quickDialNumber })}</span>
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="quick-dial-number-input" className="block text-xs font-semibold text-[#6B6368] mb-1">
                {t('quickDialInputLabel')}
              </label>
              <input
                id="quick-dial-number-input"
                type="text"
                required
                value={quickDialNumber}
                onChange={(e) => setQuickDialNumber(e.target.value)}
                placeholder={t('quickDialInputPlaceholder')}
                className="w-full bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl px-3.5 py-2.5 text-sm font-mono text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white"
              />
              <div className="text-[11px] text-[#7D757A] mt-2 flex flex-wrap items-center gap-1.5">
                <span>{t('quickDialPresetsLabel')}</span>
                {HELPLINE_PRESETS.map((preset) => (
                  <button
                    key={preset.number}
                    type="button"
                    onClick={() => {
                      setQuickDialNumber(preset.number);
                      setQuickDialLabel(preset.label);
                    }}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
                      quickDialNumber === preset.number
                        ? 'bg-[#F9EDF3] text-[#9E4D71] font-bold border border-[#F0D0DF]'
                        : 'bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] border border-[#EFE8E1]'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="quick-dial-label-input" className="block text-xs font-semibold text-[#6B6368] mb-1">
                {t('displayNameLabel')}
              </label>
              <input
                id="quick-dial-label-input"
                type="text"
                value={quickDialLabel}
                onChange={(e) => setQuickDialLabel(e.target.value)}
                placeholder="e.g. Women's Safety Helpline (1091)"
                className="w-full bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl px-3.5 py-2.5 text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white"
              />
              <p className="text-[11px] text-[#6B6368] mt-1.5">
                {language === 'hi' ? 'यह लेबल नेविगेशन बार और डैशबोर्ड पर त्वरित डायल बटन पर दिखाई देता है।' : language === 'mr' ? 'हे नाव नेव्हिगेशन बार आणि डॅशबोर्डवरील क्विक डायल बटणावर दिसेल.' : 'This label appears on quick dial buttons placed on the Navigation bar, Dashboard, and Active Trip screen.'}
              </p>
            </div>
          </div>
        </div>

        {/* Section 2: Scheduled Check-In Reminders & Auto-Notification */}
        <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between items-start gap-3.5 border-b border-[#EFE8E1] pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-[#3A3A3A] text-base">{t('scheduledCheckInSectionTitle')}</h3>
                <p className="text-xs text-[#6B6368]">
                  {t('scheduledCheckInSectionDesc')}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <input
                id="enable-scheduled-reminders-checkbox"
                type="checkbox"
                checked={tripCheckInRemindersEnabled}
                onChange={(e) => setTripCheckInRemindersEnabled(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-[#B36D8B] focus:ring-[#C88EA7] border-[#EFE8E1] accent-[#B36D8B]"
              />
              <div>
                <label
                  htmlFor="enable-scheduled-reminders-checkbox"
                  className="font-bold text-sm text-[#3A3A3A] cursor-pointer"
                >
                  {t('scheduledCheckInToggle')}
                </label>
                <p className="text-xs text-[#6B6368] mt-0.5 leading-relaxed">
                  {language === 'hi' ? 'सक्रिय ट्रिप के दौरान SafeCheck ध्वनि संकेत बजाएगा और त्वरित चेक-इन की मांग करेगा।' : language === 'mr' ? 'प्रवासादरम्यान SafeCheck आवाज वाजवून त्वरित चेक-इन पुष्टी मागेल.' : 'During an active trip, SafeCheck will play a chime sound and request a quick 1-tap check-in confirmation.'}
                </p>
              </div>
            </div>

            {tripCheckInRemindersEnabled && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-7 pt-2 border-t border-[#EFE8E1]">
                <div>
                  <label htmlFor="reminder-interval-select" className="block text-xs font-semibold text-[#6B6368] mb-1">
                    {t('scheduledIntervalLabel')}
                  </label>
                  <select
                    id="reminder-interval-select"
                    value={checkInReminderIntervalMinutes}
                    onChange={(e) => setCheckInReminderIntervalMinutes(Number(e.target.value))}
                    className="w-full bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl px-3.5 py-2.5 text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white"
                  >
                    <option value={5}>5 {t('minsUnit')} ({language === 'hi' ? 'उच्च सुरक्षा मोड' : language === 'mr' ? 'उच्च सुरक्षा मोड' : 'High Safety Mode'})</option>
                    <option value={10}>10 {t('minsUnit')}</option>
                    <option value={15}>15 {t('minsUnit')} ({language === 'hi' ? 'अनुशंसित' : language === 'mr' ? 'शिफारस केलेले' : 'Recommended'})</option>
                    <option value={30}>30 {t('minsUnit')}</option>
                    <option value={45}>45 {t('minsUnit')}</option>
                    <option value={60}>60 {t('minsUnit')}</option>
                  </select>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start space-x-3">
                    <input
                      id="auto-alert-unresponsive-checkbox"
                      type="checkbox"
                      checked={autoAlertIfNotAcknowledged}
                      onChange={(e) => setAutoAlertIfNotAcknowledged(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded text-rose-600 focus:ring-rose-500 border-[#EFE8E1] accent-[#B36D8B]"
                    />
                    <div>
                      <label
                        htmlFor="auto-alert-unresponsive-checkbox"
                        className="font-bold text-xs text-[#3A3A3A] cursor-pointer"
                      >
                        {t('scheduledAutoAlertToggle')}
                      </label>
                      <p className="text-[11px] text-[#6B6368] mt-0.5">
                        {language === 'hi' ? 'यदि आप "मैं सुरक्षित हूँ" नहीं दबाते हैं, तो GPS लोकेशन के साथ आपातकालीन ईमेल भेजें।' : language === 'mr' ? 'प्रतिसाद न दिल्यास GPS लोकेशनसह आपत्कालीन ईमेल पाठवा.' : 'If you fail to tap "I\'m Safe" when prompted, dispatch emergency email alerts with GPS coordinates.'}
                      </p>
                    </div>
                  </div>

                  {autoAlertIfNotAcknowledged && (
                    <div>
                      <label htmlFor="unacknowledged-timeout-select" className="block text-xs font-semibold text-[#6B6368] mb-1">
                        {t('scheduledTimeoutLabel')}
                      </label>
                      <select
                        id="unacknowledged-timeout-select"
                        value={unacknowledgedTimeoutMinutes}
                        onChange={(e) => setUnacknowledgedTimeoutMinutes(Number(e.target.value))}
                        className="w-full bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl px-3.5 py-2 text-xs text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7]"
                      >
                        <option value={2}>2 {t('minsUnit')}</option>
                        <option value={3}>3 {t('minsUnit')}</option>
                        <option value={5}>5 {t('minsUnit')} ({language === 'hi' ? 'मानक' : language === 'mr' ? 'प्रमाणित' : 'Standard'})</option>
                        <option value={10}>10 {t('minsUnit')}</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Note on Automatic Low Battery Alert */}
            <div
              id="low-battery-alert-settings-note"
              className="mt-4 p-4 rounded-2xl bg-[#FFF8F0] border border-[#F59E0B]/40 flex items-start space-x-3 text-xs text-[#92400E]"
            >
              <div className="w-8 h-8 rounded-xl bg-[#FEF3C7] flex items-center justify-center shrink-0 text-[#D97706] mt-0.5">
                <BatteryWarning className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <div className="font-bold text-[#B45309] flex items-center gap-1.5">
                  <span>🔋 Low Battery Auto-Alert to Contacts</span>
                  <span className="px-2 py-0.5 rounded-md bg-[#FEF3C7] text-[10px] font-bold text-[#B45309]">
                    Automatic
                  </span>
                </div>
                <p className="text-[#78350F] leading-relaxed">
                  When a trip or check-in is active, SafeCheck monitors your device battery level using the browser's Battery Status API (<code className="font-mono text-[10px] bg-[#FEF3C7] px-1 py-0.5 rounded text-[#B45309]">navigator.getBattery()</code>). If your battery drops below <strong>15%</strong> during an active trip, an automated alert email with your battery percentage and last known GPS location is automatically sent to all saved emergency contacts once per trip session.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Fake Call Simulator */}
        <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between items-start gap-3.5 border-b border-[#EFE8E1] pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center justify-center shrink-0">
                <PhoneCall className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-[#3A3A3A] text-base">{t('fakeCallSectionTitle')}</h3>
                <p className="text-xs text-[#6B6368]">
                  {t('fakeCallSectionDesc')}
                </p>
              </div>
            </div>

            {onTriggerFakeCall && (
              <button
                id="test-fake-call-btn"
                type="button"
                onClick={onTriggerFakeCall}
                className="flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#3A3A3A] hover:bg-[#2A2A2A] text-white font-bold text-xs shadow-xs transition-all w-full sm:w-auto cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 text-emerald-400" />
                <span>{t('testFakeCallBtn')}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="caller-name-input" className="block text-xs font-semibold text-[#6B6368] mb-1">
                {t('fakeCallerNameLabel')} *
              </label>
              <input
                id="caller-name-input"
                type="text"
                required
                value={callerName}
                onChange={(e) => setCallerName(e.target.value)}
                placeholder="e.g. Mom, Boss, Dad, Alex"
                className="w-full bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl px-3.5 py-2.5 text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white"
              />
              <div className="text-[11px] text-[#7D757A] mt-1.5 flex flex-wrap items-center gap-1.5">
                <span>{t('quickDialPresetsLabel')}</span>
                {['Mom', 'Boss', 'Dad', 'Work Dispatch', 'Roommate'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCallerName(preset)}
                    className="px-2 py-0.5 rounded-md bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] border border-[#EFE8E1] font-medium text-[10px] transition-colors cursor-pointer"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="caller-subtitle-input" className="block text-xs font-semibold text-[#6B6368] mb-1">
                {t('fakeCallerSubtitleLabel')}
              </label>
              <input
                id="caller-subtitle-input"
                type="text"
                value={callerSubtitle}
                onChange={(e) => setCallerSubtitle(e.target.value)}
                placeholder="e.g. Mobile, Work, Calling..."
                className="w-full bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl px-3.5 py-2.5 text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7] focus:bg-white"
              />
            </div>
          </div>

          {/* Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#EFE8E1]">
            <div className="flex items-start space-x-3">
              <input
                id="enable-ringtone-checkbox"
                type="checkbox"
                checked={ringtoneEnabled}
                onChange={(e) => setRingtoneEnabled(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-[#B36D8B] focus:ring-[#C88EA7] border-[#EFE8E1] accent-[#B36D8B]"
              />
              <div>
                <label
                  htmlFor="enable-ringtone-checkbox"
                  className="font-bold text-xs text-[#3A3A3A] cursor-pointer flex items-center gap-1.5"
                >
                  <Volume2 className="w-3.5 h-3.5 text-[#9E4D71]" />
                  <span>{t('fakeCallRingtoneToggle')}</span>
                </label>
                <p className="text-[11px] text-[#6B6368] mt-0.5">
                  {language === 'hi' ? 'नकली कॉल के दौरान यथार्थवादी फोन रिंगटोन और कंपन बजाता है।' : language === 'mr' ? 'बनावट कॉलदरम्यान वास्तववादी रिंगटोन व व्हायब्रेशन वाजवतो.' : 'Plays an authentic phone ring tone cadence during the incoming call simulation.'}
                </p>
              </div>
            </div>

            <div className="flex items-start space-x-3">
              <input
                id="enable-floating-button-checkbox"
                type="checkbox"
                checked={floatingFakeCallButton}
                onChange={(e) => setFloatingFakeCallButton(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-[#B36D8B] focus:ring-[#C88EA7] border-[#EFE8E1] accent-[#B36D8B]"
              />
              <div>
                <label
                  htmlFor="enable-floating-button-checkbox"
                  className="font-bold text-xs text-[#3A3A3A] cursor-pointer flex items-center gap-1.5"
                >
                  <Smartphone className="w-3.5 h-3.5 text-[#9E4D71]" />
                  <span>{t('fakeCallFloatingToggle')}</span>
                </label>
                <p className="text-[11px] text-[#6B6368] mt-0.5">
                  {language === 'hi' ? 'स्क्रीन पर तुरंत फेक कॉल शुरू करने के लिए फ्लोटिंग बटन प्रदर्शित करता है।' : language === 'mr' ? 'स्क्रीनवर त्वरित फेक कॉल सुरू करण्यासाठी फ्लोटिंग बटण दाखवतो.' : 'Displays a floating button on screens for one-tap escape access.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 5: Live Location Sharing */}
        <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between items-start gap-3.5 border-b border-[#EFE8E1] pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center justify-center shrink-0">
                <MapPin className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-[#3A3A3A] text-base">{t('locationSectionTitle')}</h3>
                <p className="text-xs text-[#6B6368]">
                  {t('locationSectionDesc')}
                </p>
              </div>
            </div>

            <button
              id="test-location-btn"
              type="button"
              onClick={handleTestLocation}
              disabled={locationTesting}
              className="flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#F9EDF3] hover:bg-[#F3DEE8] text-[#9E4D71] border border-[#F0D0DF] font-bold text-xs transition-all w-full sm:w-auto cursor-pointer"
            >
              <MapPin className={`w-3.5 h-3.5 ${locationTesting ? 'animate-bounce' : ''}`} />
              <span>{locationTesting ? t('testingLocationBtn') : t('testLocationBtn')}</span>
            </button>
          </div>

          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <input
                id="enable-location-default-checkbox"
                type="checkbox"
                checked={enableLocationByDefault}
                onChange={(e) => setEnableLocationByDefault(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-[#B36D8B] focus:ring-[#C88EA7] border-[#EFE8E1] accent-[#B36D8B]"
              />
              <div>
                <label
                  htmlFor="enable-location-default-checkbox"
                  className="font-bold text-sm text-[#3A3A3A] cursor-pointer"
                >
                  {t('locationDefaultToggle')}
                </label>
                <p className="text-xs text-[#6B6368] mt-0.5 leading-relaxed">
                  {language === 'hi' ? 'चेक-इन शुरू करते समय या SOS दबाते समय गूगल मैप्स लिंक स्वतः संपर्कों को भेजा जाएगा।' : language === 'mr' ? 'चेक-इन किंवा SOS सुरू करताना गुगल मॅप्स लिंक आपोआप संपर्कांना पाठवली जाईल.' : 'When starting a safety check-in or triggering One-Tap SOS, SafeCheck will query your coordinates and embed the Google Maps link into contact emails and the active trip screen.'}
                </p>
              </div>
            </div>

            {/* Test Location Output */}
            {locationResult && (
              <div
                className={`p-4 rounded-2xl border text-xs space-y-2 animate-in fade-in ${
                  locationResult.url
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-amber-50 border-amber-200 text-amber-900'
                }`}
              >
                {locationResult.url ? (
                  <>
                    <div className="flex items-center space-x-2 font-bold text-emerald-800">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>{language === 'hi' ? 'GPS निर्देशांक सफलतापूर्वक प्राप्त हुए' : language === 'mr' ? 'GPS निर्देशांक यशस्वीरित्या प्राप्त झाले' : 'GPS Coordinates Retrieved Successfully'}</span>
                    </div>
                    <div className="font-mono text-[11px] text-emerald-800">
                      Latitude: {locationResult.lat}, Longitude: {locationResult.lng}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <a
                        href={locationResult.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-emerald-700 text-white font-bold text-[11px] hover:bg-emerald-800 transition-colors shadow-xs"
                      >
                        <span>{t('tripCardViewMap')}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2 font-bold text-amber-800">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <span>{t('locationPermLabel')}</span>
                    </div>
                    <p className="text-[11px] text-amber-800">{locationResult.error}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Section 7: Fall / Impact Detection (DeviceMotionEvent) */}
        <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between items-start gap-3.5 border-b border-[#EFE8E1] pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center justify-center shrink-0">
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-[#3A3A3A] text-base">{t('fallDetectionSectionTitle')}</h3>
                <p className="text-xs text-[#6B6368]">
                  {t('fallDetectionSectionDesc')}
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <button
                id="test-simulate-fall-btn"
                type="button"
                onClick={handleSimulateFall}
                className="flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#F9EDF3] hover:bg-[#F3DEE8] text-[#9E4D71] border border-[#F0D0DF] font-bold text-xs transition-all w-full sm:w-auto cursor-pointer"
                title="Test 15-second Fall Alert & Siren UI on desktop or mobile"
              >
                <Play className="w-3.5 h-3.5 text-[#9E4D71]" />
                <span>{t('fallDetectionSimulateBtn')}</span>
              </button>

              <button
                id="request-ios-motion-btn"
                type="button"
                onClick={handleRequestMotionPermission}
                className="flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#FAF6F3] hover:bg-[#F3ECE5] text-[#3A3A3A] border border-[#EFE8E1] font-bold text-xs transition-all w-full sm:w-auto cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-[#9E4D71]" />
                <span>{t('requestMotionIosBtn')}</span>
              </button>
            </div>
          </div>

          {/* Desktop Hardware Notice */}
          {!isDeviceMotionSupported() && (
            <div className="bg-amber-50/80 border border-amber-200/80 p-4 rounded-2xl text-xs text-amber-900 flex items-start space-x-3">
              <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">{language === 'hi' ? 'डेस्कटॉप हार्डवेयर सूचना:' : language === 'mr' ? 'डेस्कटॉप हार्डवेअर सूचना:' : 'Desktop Hardware Notice:'}</span>{' '}
                <span>{t('fallDetectionDesktopNotice')}</span>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <input
                id="enable-fall-detection-checkbox"
                type="checkbox"
                checked={fallDetectionEnabled}
                onChange={(e) => setFallDetectionEnabled(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-[#B36D8B] focus:ring-[#C88EA7] border-[#EFE8E1] accent-[#B36D8B]"
              />
              <div>
                <label
                  htmlFor="enable-fall-detection-checkbox"
                  className="font-bold text-sm text-[#3A3A3A] cursor-pointer"
                >
                  {t('fallDetectionToggle')}
                </label>
                <p className="text-xs text-[#6B6368] mt-0.5 leading-relaxed">
                  {language === 'hi' ? 'अचानक तेज झटके या गिरने का पता लगने पर स्वतः SOS भेजने से पहले उलटी गिनती (काउंटडाउन) शुरू होती है।' : language === 'mr' ? 'अचानक पडल्याचे किंवा धडक बसल्याचे समजल्यास आपोआप SOS पाठवण्यापूर्वी काउंटडाउन सुरू होते.' : 'When a sharp acceleration spike is detected, displays an "Are you okay?" prompt with a countdown before automatically triggering SOS.'}
                </p>
              </div>
            </div>

            {fallDetectionEnabled && (
              <div className="pl-7 grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#EFE8E1]">
                <div>
                  <label htmlFor="fall-sensitivity-select" className="block text-xs font-semibold text-[#6B6368] mb-1">
                    {t('fallSensitivityLabel')}
                  </label>
                  <select
                    id="fall-sensitivity-select"
                    value={fallDetectionSensitivity}
                    onChange={(e) => setFallDetectionSensitivity(e.target.value as any)}
                    className="w-full bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl px-3.5 py-2.5 text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7]"
                  >
                    <option value="low">{t('sensitivityLow')}</option>
                    <option value="medium">{t('sensitivityMedium')}</option>
                    <option value="high">{t('sensitivityHigh')}</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="fall-countdown-select" className="block text-xs font-semibold text-[#6B6368] mb-1">
                    {t('fallCountdownLabel')}
                  </label>
                  <select
                    id="fall-countdown-select"
                    value={fallCountdownSeconds}
                    onChange={(e) => setFallCountdownSeconds(Number(e.target.value))}
                    className="w-full bg-[#FAF6F3] border border-[#EFE8E1] rounded-xl px-3.5 py-2.5 text-sm text-[#3A3A3A] focus:outline-none focus:border-[#C88EA7]"
                  >
                    <option value={10}>10</option>
                    <option value={15}>15 ({language === 'hi' ? 'अनुशंसित' : language === 'mr' ? 'शिफारस केलेले' : 'Recommended'})</option>
                    <option value={20}>20</option>
                    <option value={30}>30</option>
                  </select>
                </div>

                {motionPermissionResult && (
                  <div className="sm:col-span-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-900 flex items-center space-x-1.5">
                    <Check className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>{motionPermissionResult}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Section 9: Rolling Audio Evidence Snapshot (MediaRecorder) */}
        <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between items-start gap-3.5 border-b border-[#EFE8E1] pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center justify-center shrink-0">
                <Disc className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-[#3A3A3A] text-base">{t('audioSnapshotSectionTitle')}</h3>
                <p className="text-xs text-[#6B6368]">
                  {t('audioSnapshotSectionDesc')}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <input
                id="enable-audio-snapshotting-checkbox"
                type="checkbox"
                checked={audioSnapshottingEnabled}
                onChange={(e) => setAudioSnapshottingEnabled(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-[#B36D8B] focus:ring-[#C88EA7] border-[#EFE8E1] accent-[#B36D8B]"
              />
              <div>
                <label
                  htmlFor="enable-audio-snapshotting-checkbox"
                  className="font-bold text-sm text-[#3A3A3A] cursor-pointer"
                >
                  {t('audioSnapshotToggle')}
                </label>
                <p className="text-xs text-[#6B6368] mt-0.5 leading-relaxed">
                  {language === 'hi' ? 'सक्रिय ट्रिप के दौरान SafeCheck केवल RAM में 12 सेकंड का ऑडियो रखता है। सुरक्षित चेक-इन पर यह तुरंत स्थायी रूप से मिटा दिया जाता है।' : language === 'mr' ? 'प्रवासात SafeCheck केवळ RAM मध्ये १२ सेकंदांचा ऑडिओ ठेवतो. सुरक्षित पोहोचल्यास तो तात्काळ नष्ट केला जातो.' : 'During an active trip or when SOS is triggered, SafeCheck retains the latest 12-second audio snapshot in local session memory. If you complete the trip safely, the audio buffer is completely purged.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Section 10: Progressive Web App & Offline Installation */}
        <div className="bg-white border border-[#EFE8E1] p-6 sm:p-8 rounded-3xl space-y-6 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between items-start gap-3.5 border-b border-[#EFE8E1] pb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-[#F9EDF3] text-[#9E4D71] border border-[#F0D0DF] flex items-center justify-center shrink-0">
                <Download className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-[#3A3A3A] text-base">{t('pwaSectionTitle')}</h3>
                <p className="text-xs text-[#6B6368]">
                  {t('pwaSectionDesc')}
                </p>
              </div>
            </div>

            {isInstallable && (
              <button
                id="pwa-install-settings-btn"
                type="button"
                onClick={promptInstall}
                className="flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-xs shadow-xs transition-all w-full sm:w-auto cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t('pwaInstallBtn')}</span>
              </button>
            )}
          </div>

          <div className="space-y-2 text-xs text-[#6B6368]">
            <p>
              {isInstalled
                ? `✅ ${t('pwaInstalledBadge')}`
                : (language === 'hi' ? 'SafeCheck में ऑफलाइन सर्विस वर्कर और पूर्ण स्क्रीन ऐप सपोर्ट शामिल है।' : language === 'mr' ? 'SafeCheck मध्ये ऑफलाइन सर्व्हिस वर्कर आणि पूर्ण स्क्रीन अॅप सपोर्ट समाविष्ट आहे.' : 'SafeCheck includes an offline-first Service Worker, Web App Manifest, and adaptive icons for iOS, Android, and Desktop.')}
            </p>
          </div>
        </div>

        {/* Save & Reset Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          <button
            id="reset-settings-btn"
            type="button"
            onClick={handleReset}
            className="flex items-center justify-center space-x-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-[#7D757A] hover:text-[#3A3A3A] hover:bg-[#FAF6F3] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{t('resetDefaultsBtn')}</span>
          </button>

          <button
            id="save-settings-btn"
            type="submit"
            className="flex items-center justify-center space-x-2 px-6 py-3 rounded-xl bg-[#B36D8B] hover:bg-[#9E5875] text-white font-bold text-sm shadow-md transition-all active:scale-[0.98] cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{t('saveSettingsBtn')}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
