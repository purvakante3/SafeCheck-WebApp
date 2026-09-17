export type TripStatus = 'active' | 'reminded' | 'safe' | 'alerted' | 'cancelled';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  photoURL?: string;
  photoUrl?: string;
  phone?: string;
  phoneNumber?: string;
  fcmToken?: string;
  pushNotificationsEnabled?: boolean;
  hasCompletedOnboarding?: boolean;
  createdAt?: string;
}

export interface EmergencyContact {
  id: string;
  userId: string;
  name: string;
  email: string;
  relation: string;
  phone?: string;
  priority?: number;
  isPrimary?: boolean;
  createdAt?: string;
}

export interface TripCheckInEvent {
  timestamp: string;
  type: 'scheduled_check_in' | 'manual_check_in' | 'reminder_sent' | 'emergency_alert';
  message: string;
}

export interface AudioEvidence {
  id?: string;
  tripId?: string;
  alertId?: string;
  userId?: string;
  audioDataUrl: string;
  download_url?: string;
  storage_path?: string;
  recordedAt: string;
  durationSeconds: number;
  mimeType: string;
  createdAt?: string;
}

export type SOSEventType = 'manual' | 'fall_detected' | 'auto_escalated' | 'low_battery' | string;
export type SOSEventStatus = 'active' | 'resolved' | 'escalated';

export interface NotifiedEmergencyContact {
  id?: string;
  name: string;
  email?: string;
  phone?: string;
  relation?: string;
  status?: string;
  deliveredAt?: string | null;
  notifiedAt?: string | null;
  messageId?: string | null;
  error?: string | null;
}

export interface SOSEvent {
  sos_id: string; // document ID
  user_id: string;
  trip_id: string | null; // nullable reference — only if triggered during an active trip
  timestamp: string; // ISO string of when SOS was triggered
  triggered_at?: string; // Explicit timestamp alias
  triggeredAt?: string;
  createdAt?: string;
  latitude?: number | null; // Direct GPS latitude
  longitude?: number | null; // Direct GPS longitude
  location: {
    lat: number | null;
    lng: number | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  gps?: {
    latitude: number | null;
    longitude: number | null;
  };
  type: SOSEventType;
  status: SOSEventStatus;
  countdown_started_at: string;
  responded_at: string | null;
  escalated_at: string | null;
  escalated_to: string[]; // array of emergency contact IDs
  emergency_contacts_notified?: NotifiedEmergencyContact[]; // Detailed emergency contacts notified
  notified_contacts?: string[]; // Human-readable summaries of notified contacts
  notifiedContacts?: string[];
  notified_count?: number;
  notifiedCount?: number;
  // Display metadata (optional)
  userName?: string;
  userEmail?: string;
  locationUrl?: string | null;
  destination?: string | null;
}

export interface SOSAudioEvidence {
  audio_id: string; // document ID
  trip_id?: string; // foreign key linking directly to trips document
  sos_id?: string; // backwards compatibility alias for trip_id
  user_id: string;
  storage_path: string; // e.g. /sos_audio/{user_id}/{trip_id}/{timestamp}.webm
  download_url: string;
  duration_seconds: number;
  recorded_at: string;
  file_size_bytes: number;
  mime_type?: string;
}

export interface SOSAlert {
  id: string;
  tripId?: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  timestamp: string;
  status: 'active' | 'resolved' | 'dismissed';
  latitude?: number | null;
  longitude?: number | null;
  locationUrl?: string | null;
  notifiedCount?: number;
  notifiedContacts?: string[];
  createdAt: string;
}

export interface LocationTrailPoint {
  id?: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number | null;
  timestamp: string; // ISO string
  locationUrl?: string;
  address?: string;
}

export interface LateTripResponse {
  timestamp: string;
  respondedAt?: string;
  action?: 'safe' | 'extended' | 'sos' | string;
  reason: 'Stuck in traffic' | 'Stopped somewhere' | 'Running late' | 'Need help' | 'Other' | string;
  note?: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  extendedMinutes?: number;
}

export interface Trip {
  id: string;
  userId: string;
  destination: string;
  startTime: string; // ISO string
  durationMinutes: number;
  graceMinutes: number;
  status: TripStatus;
  reminderSentAt?: string | null; // ISO string or null
  alertedAt?: string | null;
  safeAt?: string | null;
  cancelledAt?: string | null;
  userName?: string;
  userEmail?: string;
  latitude?: number | null;
  longitude?: number | null;
  locationUrl?: string | null;
  notifiedCount?: number;
  notifiedContacts?: string[];
  isSosEvent?: boolean;
  sosType?: 'manual' | 'fall_detected' | string;
  sosTimestamp?: string;
  sosLocation?: { lat: number | null; lng: number | null };
  sosStatus?: 'active' | 'resolved' | 'escalated';
  escalatedTo?: string[];
  emergencyContactsNotified?: any[];
  checkInEvents?: TripCheckInEvent[];
  audioEvidence?: AudioEvidence | null;
  audioStatus?: 'recording' | 'uploading' | 'ready' | 'failed';
  audioError?: string | null;
  audioStatusUpdatedAt?: string | null;
  // Trip Safety Check additions
  startLatitude?: number | null;
  startLongitude?: number | null;
  startLocationUrl?: string | null;
  startAddress?: string | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  destinationAddress?: string | null;
  durationMode?: 'auto' | 'manual';
  travelMode?: 'walking' | 'driving' | 'transit';
  estimatedDistanceMeters?: number;
  locationTrail?: LocationTrailPoint[];
  lastKnownLatitude?: number | null;
  lastKnownLongitude?: number | null;
  lastKnownAddress?: string | null;
  lastLocationUpdate?: string | null;
  arrivedAt?: string | null;
  lateResponses?: LateTripResponse[];
  autoEscalated?: boolean;
  lowBatteryAlertSent?: boolean;
  lowBatteryAlertSentAt?: string | null;
  lowBatteryLevel?: number | null;
}

export interface AppSettings {
  fakeCallerName: string;
  fakeCallerSubtitle: string;
  ringtoneEnabled: boolean;
  floatingFakeCallButton: boolean;
  enableLocationByDefault: boolean;
  // Scheduled Check-in Settings
  tripCheckInRemindersEnabled: boolean;
  checkInReminderIntervalMinutes: number;
  autoAlertIfNotAcknowledged: boolean;
  unacknowledgedTimeoutMinutes: number;
  // Quick Dial / Helpline Settings
  quickDialNumber: string;
  quickDialLabel: string;
  // Fall / Impact Detection
  fallDetectionEnabled: boolean;
  fallCountdownSeconds: number;
  fallSensitivity: 'low' | 'medium' | 'high';
  fallDetectionSensitivity?: 'low' | 'medium' | 'high';
  // Language
  language?: 'en' | 'hi' | 'mr';
  // Audio Evidence Snapshotting
  audioSnapshottingEnabled: boolean;
}

export interface EmailNotificationLog {
  id: string;
  tripId: string;
  destination: string;
  stage: 'reminder' | 'alert' | 'low_battery';
  recipient: string;
  subject: string;
  sentAt: string;
  status: 'sent' | 'simulated';
  bodySummary: string;
  locationUrl?: string | null;
}

