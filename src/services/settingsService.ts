import { AppSettings } from '../types';

const SETTINGS_KEY = 'safecheck_app_settings';

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
  // Quick Dial Settings
  quickDialNumber: '1091', // Standard helpline (Women's Helpline/Emergency)
  quickDialLabel: "Women's Safety Helpline (1091)",
  // Fall / Impact Detection
  fallDetectionEnabled: true,
  fallCountdownSeconds: 15,
  fallSensitivity: 'medium',
  fallDetectionSensitivity: 'medium',
  // Audio Evidence Snapshotting
  audioSnapshottingEnabled: true,
};

export function getAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
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
