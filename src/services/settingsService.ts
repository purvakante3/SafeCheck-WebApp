import { AppSettings } from '../types';
import { SupportedLanguage } from '../i18n/translations';

const SETTINGS_KEY = 'safecheck_app_settings';

export const DEFAULT_VOICE_WAKE_PHRASES: Record<SupportedLanguage, string> = {
  en: 'help me',
  hi: 'मदद करो, बचाओ',
  mr: 'वाचवा',
};

export const DEFAULT_SETTINGS: AppSettings = {
  fakeCallerName: 'Mom',
  fakeCallerSubtitle: 'Mobile',
  ringtoneEnabled: true,
  floatingFakeCallButton: true,
  enableLocationByDefault: true,
  // Scheduled Check-in Settings
  tripCheckInRemindersEnabled: true,
  checkInReminderIntervalMinutes: 15, // Prompts user every 15 min or halfway
  autoAlertIfNotAcknowledged: true,
  unacknowledgedTimeoutMinutes: 5, // Escalates after 5 min unacknowledged
  // Hardware multi-press SOS Listener & Desktop Shortcut
  hardwareSosTriggerEnabled: true,
  hardwarePressCount: 4, // 4 rapid key/volume presses
  hardwareSosEnabled: true,
  desktopSosShortcutEnabled: true,
  desktopSosShortcut: 'Ctrl+Shift+S',
  // Quick Dial Settings
  quickDialNumber: '1091', // Standard helpline (Women's Helpline/Emergency)
  quickDialLabel: "Women's Safety Helpline (1091)",
  // Voice-Activated SOS
  voiceSosEnabled: false,
  voiceWakePhrase: 'help me',
  voiceSosWakePhrase: 'help me',
  voiceWakePhrases: {
    en: 'help me',
    hi: 'मदद करो, बचाओ',
    mr: 'वाचवा',
  },
  // Fall / Impact Detection
  fallDetectionEnabled: true,
  fallCountdownSeconds: 15,
  fallSensitivity: 'medium',
  fallDetectionSensitivity: 'medium',
  // Audio Evidence Snapshotting
  audioSnapshottingEnabled: true,
};

export function getWakePhraseForLanguage(
  settings: AppSettings | undefined,
  lang: SupportedLanguage = 'en'
): string {
  if (settings?.voiceWakePhrases && settings.voiceWakePhrases[lang]) {
    return settings.voiceWakePhrases[lang];
  }
  if (lang === 'en' && settings?.voiceWakePhrase) {
    return settings.voiceWakePhrase;
  }
  return DEFAULT_VOICE_WAKE_PHRASES[lang] || DEFAULT_VOICE_WAKE_PHRASES.en;
}

export function getAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        voiceWakePhrases: {
          ...DEFAULT_SETTINGS.voiceWakePhrases,
          ...(parsed.voiceWakePhrases || {}),
        },
      };
    }
  } catch (e) {}
  return DEFAULT_SETTINGS;
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {}
}

export const getStoredSettings = getAppSettings;
export const saveStoredSettings = saveAppSettings;
