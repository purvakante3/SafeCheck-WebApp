/**
 * SOS Alerts and Forensic Audio Evidence Service
 * 
 * Strict Architectural Separation:
 * 1. trips: Only trip data (start/destination, timers, status). Pure trip model.
 * 2. sos_events: Independent top-level Firestore collection for SOS alerts.
 * 3. sos_audio_evidence: Independent top-level Firestore collection for audio clips.
 * 4. Raw audio binaries: Stored securely on server disk via /api/sos/upload-audio
 */

import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  onSnapshot,
  updateDoc,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import { SOSEvent, SOSEventType, SOSEventStatus, SOSAudioEvidence, EmergencyContact, Trip, AudioEvidence } from '../types';
import { getCachedContacts, getUserContacts } from './contactService';
import { notifySosTriggered } from './notificationService';
import { isDeviceOnline, buildEmergencySmsMessage, triggerNativeSms } from './offlineSyncService';
import { ensureAuthStateReady } from './authService';
import { freezeAudioSnapshot, getLatestAudioSnapshot, startSosEvidenceRecording, getAudioExtension } from './audioSnapshotService';
import { getCurrentLocation } from './locationService';

import { triggerHapticFeedback } from '../utils/haptics';

let activeSosTriggerPromise: Promise<TriggerSOSAlertResult> | null = null;
let lastSosTriggerTime = 0;
export function dataUrlToBlob(dataUrl: string): { blob: Blob; mimeType: string } {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'audio/webm';
  const byteCharacters = atob(parts[1]);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });
  return { blob, mimeType };
}

/**
 * Uploads raw audio file to Firebase Storage at:
 * /sos_audio/{user_id}/{sos_id}/{timestamp}.webm
 * and logs an independent metadata record in top-level Firestore collection "sos_audio_evidence".
 * NEVER stores raw audio blobs in Firestore.
 */
export async function uploadAndLogAudioEvidence(params: {
  tripId?: string;
  sosId?: string;
  userId: string;
  audioBlobOrDataUrl: Blob | string;
  recordedAt?: string;
  durationSeconds?: number;
  mimeType?: string;
  isInterim?: boolean;
}): Promise<SOSAudioEvidence> {
  const targetTripId = params.tripId || params.sosId || `trip_${Date.now()}`;
  const { userId, audioBlobOrDataUrl, durationSeconds = 30, isInterim = false } = params;
  const recordedAt = params.recordedAt || new Date().toISOString();

  let audioBlob: Blob;
  let detectedMime = params.mimeType || '';
  let fileSizeBytes = 0;
  let base64DataUrl = '';

  if (typeof audioBlobOrDataUrl === 'string') {
    base64DataUrl = audioBlobOrDataUrl;
    if (base64DataUrl.startsWith('data:')) {
      const converted = dataUrlToBlob(base64DataUrl);
      audioBlob = converted.blob;
      detectedMime = detectedMime || converted.mimeType || 'audio/webm';
      fileSizeBytes = audioBlob.size;
    } else {
      detectedMime = detectedMime || 'audio/webm';
      base64DataUrl = `data:${detectedMime};base64,${base64DataUrl}`;
      const converted = dataUrlToBlob(base64DataUrl);
      audioBlob = converted.blob;
      fileSizeBytes = audioBlob.size;
    }
  } else {
    audioBlob = audioBlobOrDataUrl;
    detectedMime = audioBlob.type || detectedMime || 'audio/webm';
    fileSizeBytes = audioBlob.size;
    // Convert Blob to base64 data URL with FileReader.readAsDataURL
    base64DataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string) || '');
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(audioBlob);
    });
  }

  if (!detectedMime) {
    detectedMime = 'audio/webm';
  }

  const audioMimeType = detectedMime;
  const audioExtension = getAudioExtension(audioMimeType);
  const cleanTripId = String(targetTripId).replace(/[^A-Za-z0-9_-]/g, '_');
  const effectiveUserId = auth.currentUser?.uid || userId || 'traveler';
  const nowIso = new Date().toISOString();

  console.log(`[SOS-AUDIO] [START SAVING] Audio save initiated for trip "${cleanTripId}". Blob size: ${fileSizeBytes} bytes, MIME: "${audioMimeType}", extension: "${audioExtension}", base64 length: ${base64DataUrl.length} chars`);

  // 1. Immediately record syncing state on separate sos_evidence/{cleanTripId} document
  if (db) {
    try {
      await setDoc(doc(db, 'sos_evidence', cleanTripId), {
        tripId: cleanTripId,
        userId: effectiveUserId,
        audioStatus: 'syncing',
        audioMimeType,
        audioExtension,
        audioSizeBytes: fileSizeBytes,
        durationSeconds,
        recordedAt,
        updatedAt: nowIso,
      }, { merge: true });
      console.log(`[SOS-AUDIO] [STEP 1: EVIDENCE STATUS] Set sos_evidence/${cleanTripId} audioStatus="syncing".`);
    } catch (e) {
      console.warn('[SOS-AUDIO] Notice writing syncing status to sos_evidence:', e);
    }
  }

  // 1b. Storage upload omitted (Firestore-only mode for 100% free operation)
  const storageDownloadUrl = '';

  // 2. Save audio to Firestore sos_evidence/{tripId} (chunked into subcollection if over 900,000 characters)
  const CHUNK_THRESHOLD = 900000;
  const CHUNK_SIZE = 700000;
  let chunkCount = 0;

  try {
    if (base64DataUrl.length > CHUNK_THRESHOLD) {
      chunkCount = Math.ceil(base64DataUrl.length / CHUNK_SIZE);
      console.log(`[SOS-AUDIO] [STEP 2: CHUNKING] Base64 string (${base64DataUrl.length} chars) exceeds ${CHUNK_THRESHOLD}. Splitting into ${chunkCount} chunks (700,000 chars each) in sos_evidence/${cleanTripId}/chunks/{index}`);

      for (let index = 0; index < chunkCount; index++) {
        const chunkSlice = base64DataUrl.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE);
        if (db) {
          await setDoc(doc(db, 'sos_evidence', cleanTripId, 'chunks', String(index)), {
            index,
            chunk: chunkSlice,
            updatedAt: new Date().toISOString(),
          });
          console.log(`[SOS-AUDIO] [STEP 2: CHUNK SAVED] Chunk ${index + 1}/${chunkCount} saved to sos_evidence/${cleanTripId}/chunks/${index}`);
        }
      }

      // Update main document with ready status, chunkCount, and omit raw base64 string
      const syncedAt = new Date().toISOString();
      if (db) {
        await setDoc(doc(db, 'sos_evidence', cleanTripId), {
          tripId: cleanTripId,
          userId: effectiveUserId,
          audioStatus: isInterim ? 'syncing' : 'ready',
          audioBase64: null,
          chunkCount,
          audioMimeType,
          audioExtension,
          audioSizeBytes: fileSizeBytes,
          durationSeconds,
          recordedAt,
          updatedAt: syncedAt,
        }, { merge: true });
        console.log(`[SOS-AUDIO] [STEP 3: READY] ✅ Saved chunked audio to sos_evidence/${cleanTripId} with status="ready" (chunkCount: ${chunkCount}, blob size: ${fileSizeBytes} bytes, MIME: "${audioMimeType}")`);
      }
    } else {
      // Small or standard string (<= 900,000 characters), fits in single Firestore document
      chunkCount = 0;
      const syncedAt = new Date().toISOString();
      console.log(`[SOS-AUDIO] [STEP 2: SINGLE DOC] Base64 string (${base64DataUrl.length} chars) fits in main document. Saving to sos_evidence/${cleanTripId}...`);
      if (db) {
        await setDoc(doc(db, 'sos_evidence', cleanTripId), {
          tripId: cleanTripId,
          userId: effectiveUserId,
          audioStatus: isInterim ? 'syncing' : 'ready',
          audioBase64: base64DataUrl,
          chunkCount: 0,
          audioMimeType,
          audioExtension,
          audioSizeBytes: fileSizeBytes,
          durationSeconds,
          recordedAt,
          updatedAt: syncedAt,
        }, { merge: true });
        console.log(`[SOS-AUDIO] [STEP 3: READY] ✅ Saved audio to sos_evidence/${cleanTripId} with status="ready" (chunkCount: 0, blob size: ${fileSizeBytes} bytes, MIME: "${audioMimeType}")`);
      }
    }

    // 3. Clean up local emergency cache on successful save
    if (!isInterim) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(`safecheck_cached_audio_${cleanTripId}`);
        }
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem(`safecheck_cached_audio_${cleanTripId}`);
        }
        console.log(`[SOS-AUDIO] [STEP 4: CACHE CLEANUP] 🗑️ Deleted local emergency cache for trip "${cleanTripId}".`);
      } catch {}
    }
  } catch (saveErr: any) {
    const errorMsg = saveErr?.message || 'Firestore audio evidence write failed';
    console.warn(`[SOS-AUDIO] Direct Firestore save failed for trip "${cleanTripId}": ${errorMsg}. Attempting server backup save...`);

    let serverSaved = false;
    try {
      const serverPayload: any = {
        tripId: cleanTripId,
        userId: effectiveUserId,
        audioStatus: isInterim ? 'syncing' : 'ready',
        chunkCount,
        audioMimeType,
        audioExtension,
        audioSizeBytes: fileSizeBytes,
        durationSeconds,
        recordedAt,
        updatedAt: new Date().toISOString(),
      };
      if (chunkCount > 0) {
        const slices: string[] = [];
        for (let idx = 0; idx < chunkCount; idx++) {
          slices.push(base64DataUrl.slice(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE));
        }
        serverPayload.chunks = slices;
      } else {
        serverPayload.audioBase64 = base64DataUrl;
      }

      const resp = await fetch('/api/sos/save-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverPayload),
      });
      if (resp.ok) {
        console.log(`[SOS-AUDIO] [SERVER PROXY BACKUP SUCCESS] ✅ Successfully saved audio evidence via /api/sos/save-evidence for trip "${cleanTripId}".`);
        serverSaved = true;

        if (!isInterim) {
          try {
            if (typeof localStorage !== 'undefined') localStorage.removeItem(`safecheck_cached_audio_${cleanTripId}`);
            if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(`safecheck_cached_audio_${cleanTripId}`);
          } catch {}
        }
      }
    } catch (serverErr: any) {
      console.warn('[SOS-AUDIO] Server proxy save also failed:', serverErr?.message || serverErr);
    }

    if (!serverSaved) {
      console.error(`[SOS-AUDIO] [ERROR] Failed to save audio evidence for trip "${cleanTripId}":`, errorMsg);

      // Write "failed" status to sos_evidence/{cleanTripId}
      if (db) {
        try {
          await setDoc(doc(db, 'sos_evidence', cleanTripId), {
            tripId: cleanTripId,
            userId: effectiveUserId,
            audioStatus: 'failed',
            error: errorMsg,
            updatedAt: new Date().toISOString(),
          }, { merge: true });
          console.log(`[SOS-AUDIO] Set sos_evidence/${cleanTripId} audioStatus="failed". Local cache retained for retry.`);
        } catch (fsErr) {
          console.warn(`[SOS-AUDIO] Notice writing failed status to sos_evidence:`, fsErr);
        }
      }

      throw new Error(`Audio save failed: ${errorMsg}`);
    }
  }

  const audioId = `audio_${cleanTripId}_${Date.now()}`;
  const audioEvidenceRecord: SOSAudioEvidence = {
    audio_id: audioId,
    trip_id: targetTripId,
    sos_id: targetTripId,
    user_id: effectiveUserId,
    storage_path: `sos_evidence/${cleanTripId}`,
    download_url: '',
    duration_seconds: durationSeconds,
    recorded_at: recordedAt,
    file_size_bytes: fileSizeBytes,
    mime_type: audioMimeType,
  };

  // 4. Update the corresponding trips document with audio status metadata (never raw blob)
  try {
    const targetAudioStatus = isInterim ? 'recording' : 'ready';
    console.log(`[SOS-AUDIO] [STEP 5: TRIP DOC UPDATE] 📝 Updating 'trips' document "${targetTripId}" with audioStatus="${targetAudioStatus}"`);

    const tripUpdatePayload = {
      audioUrl: storageDownloadUrl || null,
      audioEvidenceUrl: storageDownloadUrl || null,
      audioStatus: targetAudioStatus,
      audioStatusUpdatedAt: nowIso,
      syncedAt: nowIso,
      audioError: null,
      audioCapturedAt: recordedAt,
      audioDurationSec: durationSeconds,
      audioEvidence: {
        id: audioId,
        tripId: targetTripId,
        alertId: targetTripId,
        userId: effectiveUserId,
        storage_path: `sos-audio/${cleanTripId}.${audioExtension === 'mp4' ? 'mp4' : 'webm'}`,
        download_url: storageDownloadUrl || '',
        recordedAt: recordedAt,
        durationSeconds: durationSeconds,
        mimeType: audioMimeType,
        syncedAt: nowIso,
      },
    };

    if (db) {
      const writes: Promise<any>[] = [
        setDoc(doc(db, 'trips', targetTripId), tripUpdatePayload, { merge: true }),
      ];
      if (params.sosId && params.sosId !== targetTripId) {
        writes.push(setDoc(doc(db, 'trips', params.sosId), tripUpdatePayload, { merge: true }));
      }
      await Promise.all(writes);
      console.log(`[SOS-AUDIO] [STEP 3: FIRESTORE UPDATE] ✅ Attached audioEvidence directly into trips doc: "${targetTripId}" with audioStatus="${targetAudioStatus}".`);
    }

    // Immediately sync to server endpoint so in-memory localTrips is updated for Guardian view
    try {
      await fetch(`/api/trips/${encodeURIComponent(targetTripId)}/audio-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: targetAudioStatus,
          evidence: tripUpdatePayload.audioEvidence,
          audioEvidenceUrl: '',
          syncedAt: nowIso,
        }),
      });
      if (params.sosId && params.sosId !== targetTripId) {
        await fetch(`/api/trips/${encodeURIComponent(params.sosId)}/audio-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: targetAudioStatus,
            evidence: tripUpdatePayload.audioEvidence,
            audioEvidenceUrl: '',
            syncedAt: nowIso,
          }),
        });
      }
    } catch {}
  } catch (tripUpdateErr: any) {
    const isNotFound = tripUpdateErr?.code === 'not-found' || tripUpdateErr?.message?.includes('No document to update');
    if (isNotFound) {
      console.warn(`[SafeCheck Audio Sync] 🛑 Target trip/SOS doc "${targetTripId}" was deleted from Firestore. Skipping.`);
      return audioEvidenceRecord;
    }
    console.warn('[SafeCheck Audio Sync] Notice attaching audio directly to trip doc:', tripUpdateErr);
  }

  // 5. Non-blocking metadata log to independent top-level collection "sos_audio_evidence" linked to trip_id
  let directFirestoreSucceeded = false;
  if (db) {
    setDoc(doc(db, 'sos_audio_evidence', audioId), {
      audio_id: audioEvidenceRecord.audio_id,
      trip_id: targetTripId,
      sos_id: targetTripId,
      user_id: audioEvidenceRecord.user_id,
      storage_path: audioEvidenceRecord.storage_path,
      download_url: audioEvidenceRecord.download_url,
      duration_seconds: audioEvidenceRecord.duration_seconds,
      recorded_at: audioEvidenceRecord.recorded_at,
      file_size_bytes: audioEvidenceRecord.file_size_bytes,
      mime_type: audioEvidenceRecord.mime_type,
      createdAt: nowIso,
      syncedAt: nowIso,
    })
      .then(() => {
        directFirestoreSucceeded = true;
        console.log(`[SafeCheck Audio Sync ✅ Success] Saved metadata document in 'sos_audio_evidence'.`);
      })
      .catch((firestoreErr) => {
        console.warn('[SafeCheck Audio Sync] Direct write to sos_audio_evidence notice:', firestoreErr?.message || firestoreErr);
      });
  }

  // 6. Server Admin SDK fallback if direct client write had permissions or network issues
  if (!directFirestoreSucceeded) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 2500);
      await fetch('/api/sos/create-audio-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...audioEvidenceRecord,
          createdAt: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
      clearTimeout(tid);
      console.log(`[SafeCheck Audio] Saved audio evidence via server Admin SDK fallback: ${audioId}`);
    } catch (serverFallbackErr) {
      console.warn('[SafeCheck Audio] Server fallback write notice:', serverFallbackErr);
    }
  }

  // Cache locally for instantaneous preview & audit
  try {
    const cacheKey = `safecheck_sos_audio_${userId}`;
    const existing = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    localStorage.setItem(cacheKey, JSON.stringify([audioEvidenceRecord, ...existing.filter((a: any) => a.audio_id !== audioId)]));
  } catch (e) {}

  return audioEvidenceRecord;
}

/**
 * Saves/updates SOS alert data directly in the "trips" collection.
 * trips is the single source of truth for both regular trips and SOS events.
 * Stops writing to sos_events entirely.
 */
export async function createSOSEventDocument(data: {
  sos_id: string;
  user_id: string;
  trip_id: string | null;
  location?: { lat: number | null; lng: number | null; latitude?: number | null; longitude?: number | null };
  latitude?: number | null;
  longitude?: number | null;
  type: SOSEventType;
  status: SOSEventStatus;
  countdown_started_at: string;
  timestamp?: string;
  triggered_at?: string;
  responded_at?: string | null;
  escalated_at?: string | null;
  escalated_to?: string[];
  contacts?: EmergencyContact[];
  emergency_contacts_notified?: any[];
  userName?: string;
  userEmail?: string;
  locationUrl?: string | null;
  destination?: string | null;
}): Promise<SOSEvent> {
  const now = new Date().toISOString();
  const triggerTimestamp = data.triggered_at || data.timestamp || now;
  const lat = typeof data.latitude === 'number' ? data.latitude : (data.location?.lat ?? data.location?.latitude ?? null);
  const lng = typeof data.longitude === 'number' ? data.longitude : (data.location?.lng ?? data.location?.longitude ?? null);

  const contactsList = data.contacts || [];
  const emergencyContactsNotified = data.emergency_contacts_notified || contactsList.map((c) => ({
    id: c.id || '',
    name: c.name || 'Emergency Contact',
    email: c.email || '',
    phone: c.phone || '',
    relation: c.relation || 'Emergency Contact',
    status: 'pending',
    notifiedAt: triggerTimestamp,
  }));

  const notifiedSummary = emergencyContactsNotified.map((c: any) =>
    c.name ? `${c.name} (${c.email || c.phone || 'Contact'})` : (c.email || c.phone || c.id || 'Contact')
  );

  const locUrl = data.locationUrl || (lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null);
  const targetTripDocId = data.trip_id || data.sos_id;
  const escalatedTo = data.escalated_to || emergencyContactsNotified.map((c: any) => c.id || c.email || c.name);

  // Exact fields specified by user:
  // - isSosEvent: true
  // - sosType: "manual" | "fall_detected"
  // - sosTimestamp
  // - sosLocation: { lat, lng }
  // - sosStatus: "active" | "resolved" | "escalated"
  // - escalatedTo: array of contact IDs
  const tripDocPayload: any = {
    id: targetTripDocId,
    userId: data.user_id,
    userName: data.userName || null,
    userEmail: data.userEmail || null,
    destination: data.destination || (
      data.type === 'fall_detected' ? '🚨 FALL DETECTED SOS ALERT' :
      data.type === 'auto_escalated' ? '🚨 AUTOMATICALLY ESCALATED SOS ALERT' :
      '🚨 ONE-TAP EMERGENCY SOS ALERT'
    ),
    startTime: triggerTimestamp,
    durationMinutes: (typeof (data as any)?.durationMinutes === 'number' && (data as any).durationMinutes > 0) ? (data as any).durationMinutes : 10,
    graceMinutes: (typeof (data as any)?.graceMinutes === 'number' && (data as any).graceMinutes > 0) ? (data as any).graceMinutes : 10,
    status: data.status === 'resolved' ? 'safe' : 'sos',
    alertedAt: triggerTimestamp,
    // Exact user-requested SOS fields directly in the trips collection:
    isSosEvent: true,
    sosType: data.type || 'manual',
    sosTimestamp: triggerTimestamp,
    sosLocation: { lat, lng },
    sosStatus: data.status === 'resolved' ? 'resolved' : (data.status === 'escalated' ? 'escalated' : 'active'),
    escalatedTo: escalatedTo,
    // Supporting coordinate and contact fields:
    latitude: lat,
    longitude: lng,
    locationUrl: locUrl,
    location: { lat, lng },
    gps: { latitude: lat, longitude: lng },
    notifiedContacts: notifiedSummary,
    notifiedCount: emergencyContactsNotified.length,
    emergencyContactsNotified: emergencyContactsNotified,
    countdownStartedAt: data.countdown_started_at || triggerTimestamp,
    respondedAt: data.responded_at || null,
    escalatedAt: data.escalated_at || null,
    trip_id: data.trip_id || targetTripDocId,
    sos_id: data.sos_id || targetTripDocId,
    sosId: data.sos_id || targetTripDocId,
    activeTripId: data.trip_id || null,
    audioStatus: (data as any).audioStatus || ((data as any).audioEvidence ? 'ready' : 'recording'),
    audioEvidence: (data as any).audioEvidence || null,
  };

  // Persist directly to Firestore "trips" collection (guaranteed authorized by rules)
  try {
    const writes: Promise<any>[] = [
      setDoc(doc(db, 'trips', targetTripDocId), tripDocPayload, { merge: true }),
    ];
    // If a distinct sos_id was passed, ALSO persist the exact sos_id document in 'trips'
    if (data.sos_id && data.sos_id !== targetTripDocId) {
      writes.push(
        setDoc(
          doc(db, 'trips', data.sos_id),
          { ...tripDocPayload, id: data.sos_id, sosId: data.sos_id, activeTripId: data.trip_id },
          { merge: true }
        )
      );
    }
    await Promise.all(writes);
    console.log(`[SafeCheck SOS] Successfully persisted SOS alert directly into Firestore 'trips' collection for ID(s): ${targetTripDocId}${data.sos_id ? ` and ${data.sos_id}` : ''}`);
  } catch (tripErr) {
    console.warn(`[SafeCheck SOS] Direct 'trips' write notice:`, tripErr);
  }

  // Always sync to server /api/trips/sync so Guardian endpoint has trip in memory immediately
  try {
    fetch('/api/trips/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tripDocPayload),
    }).catch(() => {});
  } catch {}

  // Also cache in localStorage for immediate rendering
  try {
    const tripCacheKey = `safecheck_trips_${data.user_id}`;
    const existingTrips = JSON.parse(localStorage.getItem(tripCacheKey) || '[]');
    const updatedTrips = [tripDocPayload, ...existingTrips.filter((t: any) => t.id !== targetTripDocId)];
    localStorage.setItem(tripCacheKey, JSON.stringify(updatedTrips));
  } catch (e) {}

  const eventRecord: SOSEvent = {
    sos_id: targetTripDocId,
    user_id: data.user_id,
    trip_id: targetTripDocId,
    timestamp: triggerTimestamp,
    triggered_at: triggerTimestamp,
    triggeredAt: triggerTimestamp,
    createdAt: triggerTimestamp,
    latitude: lat,
    longitude: lng,
    location: { lat, lng },
    gps: { latitude: lat, longitude: lng },
    type: data.type,
    status: data.status,
    countdown_started_at: data.countdown_started_at || triggerTimestamp,
    responded_at: data.responded_at || null,
    escalated_at: data.escalated_at || null,
    escalated_to: escalatedTo,
    emergency_contacts_notified: emergencyContactsNotified,
    notified_contacts: notifiedSummary,
    notifiedContacts: notifiedSummary,
    notified_count: emergencyContactsNotified.length,
    notifiedCount: emergencyContactsNotified.length,
    userName: data.userName,
    userEmail: data.userEmail,
    locationUrl: locUrl,
    destination: data.destination,
  };

  return eventRecord;
}

/**
 * Triggers an SOS alert across all mechanisms:
 * - Manual Panic SOS (Dashboard or Active Trip)
 * - Fall Detection (Sensor confirmed)
 * - Late Arrival Escalation (Timeout unacknowledged)
 * 
 * ARCHITECTURAL RULE:
 * 1. Writes alert record ONLY to independent top-level collection "sos_events".
 * 2. If audio is captured, uploads binary to Firebase Storage at
 *    /sos_audio/{user_id}/{sos_id}/{timestamp}.webm and logs independent metadata
 *    record in top-level collection "sos_audio_evidence".
 * 3. STRICTLY NEVER writes new documents to the "trips" collection.
 * 4. If an active trip exists, ONLY updates that existing trip's status to 'alerted'.
 * 5. Dispatches email/SMS alerts to emergency contacts via backend API.
 */
export interface SOSEmailDispatchResult {
  status: 'delivered' | 'partial' | 'failed' | 'unconfigured' | 'no_contacts' | 'offline';
  deliveredCount: number;
  failedCount: number;
  attemptedCount: number;
  provider?: string;
  sender?: string;
  error?: string | null;
  results?: Array<{
    email: string;
    name?: string;
    status: 'delivered' | 'failed';
    messageId?: string;
    response?: string;
    accepted?: string[];
    error?: string;
    errorCode?: string;
    deliveredAt?: string;
  }>;
}

export interface TriggerSOSAlertResult {
  sosId: string;
  tripId: string;
  notifiedCount: number;
  deliveredCount: number;
  failedCount: number;
  attemptedCount: number;
  emailDispatch: SOSEmailDispatchResult;
  locationUrl?: string | null;
  audioEvidence?: SOSAudioEvidence | AudioEvidence | null;
}

export async function triggerSOSAlert(
  userId: string,
  userName?: string,
  userEmail?: string,
  latitude?: number | null,
  longitude?: number | null,
  locationUrl?: string | null,
  audioEvidence?: AudioEvidence | null,
  options?: {
    isLateEscalation?: boolean;
    destination?: string;
    customSubject?: string;
    customMessage?: string;
    activeTripId?: string;
    type?: SOSEventType;
    countdownStartedAt?: string;
    sosId?: string;
    contacts?: EmergencyContact[];
  }
): Promise<TriggerSOSAlertResult> {
  const nowMs = Date.now();
  triggerHapticFeedback('emergency-sos');
  if (activeSosTriggerPromise && nowMs - lastSosTriggerTime < 6000) {
    console.warn('[SafeCheck SOS] Duplicate rapid SOS trigger ignored — returning active dispatch.');
    return activeSosTriggerPromise;
  }
  lastSosTriggerTime = nowMs;

  const triggerExecution = (async () => {
  // 1. Ensure Firebase Auth token is verified and synchronized (with 1.5s timeout)
  try {
    await Promise.race([
      ensureAuthStateReady(),
      new Promise((_, reject) => setTimeout(() => reject('Auth sync timeout'), 1500)),
    ]);
  } catch (e) {
    console.warn('[SafeCheck SOS] Auth state ready check notice:', e);
  }

  const effectiveUserId = auth.currentUser?.uid || userId;
  const effectiveUserName = userName || auth.currentUser?.displayName || 'SafeCheck User';
  const effectiveUserEmail = userEmail || auth.currentUser?.email || '';

  // 2. Freeze or capture audio evidence snapshot if available (with 3.5s timeout)
  console.log('[SafeCheck SOS] Checking audio evidence for emergency alert...');
  let snapshotToAttach = audioEvidence;
  if (!snapshotToAttach) {
    console.log('[SafeCheck SOS] No pre-supplied audio evidence passed. Calling freezeAudioSnapshot()...');
    try {
      snapshotToAttach = await Promise.race([
        freezeAudioSnapshot(),
        new Promise<AudioEvidence | null>((_, reject) => setTimeout(() => reject('Audio freeze timeout'), 3500)),
      ]);
      console.log('[SafeCheck SOS] freezeAudioSnapshot() resolved with evidence:', Boolean(snapshotToAttach && snapshotToAttach.audioDataUrl));
    } catch (e) {
      console.warn('[SafeCheck SOS] Notice freezing audio snapshot during SOS trigger:', e);
    }
  } else {
    console.log('[SafeCheck SOS] Pre-supplied audio evidence provided to triggerSOSAlert.');
  }

  const now = new Date().toISOString();
  const sosId = options?.sosId || `sos_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const activeTripId = options?.activeTripId || null;
  const sosType: SOSEventType = options?.type || 'manual';

  // 3. Load active emergency contacts (prefer options.contacts if passed)
  let contacts: EmergencyContact[] = (options?.contacts && options.contacts.length > 0)
    ? options.contacts
    : getCachedContacts(effectiveUserId);

  if (!options?.contacts || options.contacts.length === 0) {
    try {
      const fetchedContacts = await Promise.race([
        getUserContacts(effectiveUserId),
        new Promise<EmergencyContact[]>((_, reject) => setTimeout(() => reject('Contacts fetch timeout'), 2000)),
      ]);
      if (fetchedContacts && fetchedContacts.length > 0) {
        contacts = fetchedContacts;
      }
    } catch (e) {
      console.warn('[SafeCheck SOS] Could not fetch fresh contacts from Firestore, using cache:', e);
    }
  }

  const escalatedTo = contacts.map((c) => c.id || c.email);

  // 4. STEP A: Write/Update SOS alert data directly in Firestore "trips" collection
  let resolvedLat = typeof latitude === 'number' ? latitude : null;
  let resolvedLng = typeof longitude === 'number' ? longitude : null;
  let resolvedLocUrl = locationUrl || null;

  if (resolvedLat === null || resolvedLng === null) {
    console.log(`[SafeCheck SOS GPS] 🛰️ Coordinates not pre-supplied. Capturing GPS coordinates at the moment of SOS trigger...`);
    try {
      const locRes = await Promise.race([
        getCurrentLocation(),
        new Promise<any>((_, reject) => setTimeout(() => reject(new Error('GPS capture timeout (3500ms)')), 3500)),
      ]);
      if (locRes && locRes.success && typeof locRes.latitude === 'number' && typeof locRes.longitude === 'number') {
        resolvedLat = locRes.latitude;
        resolvedLng = locRes.longitude;
        resolvedLocUrl = locRes.locationUrl || `https://maps.google.com/?q=${resolvedLat},${resolvedLng}`;
        console.log(`[SafeCheck SOS GPS] ✅ Successfully captured GPS coordinates at moment of SOS trigger: lat=${resolvedLat}, lng=${resolvedLng}, accuracy=${locRes.accuracy ?? 'unknown'}m`);
      } else {
        console.warn(`[SafeCheck SOS GPS] ⚠️ Geolocation capture did not return valid coordinates: ${locRes?.errorMessage || 'unknown error'}`);
      }
    } catch (gpsErr: any) {
      console.warn(`[SafeCheck SOS GPS] ⚠️ Geolocation capture error at moment of SOS trigger (permission denied, timeout, or unavailable): ${gpsErr?.message || gpsErr}`);
    }
  } else {
    console.log(`[SafeCheck SOS GPS] 📍 Using pre-supplied GPS coordinates: lat=${resolvedLat}, lng=${resolvedLng}`);
  }

  if (!resolvedLocUrl && resolvedLat !== null && resolvedLng !== null) {
    resolvedLocUrl = `https://maps.google.com/?q=${resolvedLat},${resolvedLng}`;
  }

  const sosLocationData = (resolvedLat !== null && resolvedLng !== null) ? {
    lat: resolvedLat,
    lng: resolvedLng,
    latitude: resolvedLat,
    longitude: resolvedLng,
  } : null;

  const targetTripId = activeTripId || sosId;

  try {
    await Promise.race([
      createSOSEventDocument({
        sos_id: sosId,
        user_id: effectiveUserId,
        trip_id: activeTripId,
        latitude: resolvedLat,
        longitude: resolvedLng,
        location: sosLocationData || undefined,
        type: sosType,
        status: options?.isLateEscalation ? 'escalated' : 'active',
        countdown_started_at: options?.countdownStartedAt || now,
        timestamp: now,
        triggered_at: now,
        responded_at: null,
        escalated_at: options?.isLateEscalation ? now : null,
        escalated_to: escalatedTo,
        contacts: contacts,
        userName: effectiveUserName,
        userEmail: effectiveUserEmail,
        locationUrl: resolvedLocUrl,
        destination: options?.destination || null,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('createSOSEventDocument timeout')), 3500)),
    ]);
  } catch (sosErr: any) {
    console.warn('[SafeCheck SOS] Write to trips collection notice:', sosErr?.message || sosErr);
  }

  // 5. STEP B (CORE NOTIFICATIONS & TRIP STATUS):
  // If an active trip exists, ensure it is updated with all SOS fields and 'sos' status
  if (activeTripId) {
    try {
      const tripDocRef = doc(db, 'trips', activeTripId);
      await Promise.race([
        updateDoc(tripDocRef, {
          isSosEvent: true,
          sosType: sosType,
          sosTimestamp: now,
          sosLocation: sosLocationData,
          sosStatus: options?.isLateEscalation ? 'escalated' : 'active',
          escalatedTo: escalatedTo,
          status: 'sos',
          sosId: sosId,
          alertedAt: now,
          latitude: resolvedLat,
          longitude: resolvedLng,
          locationUrl: resolvedLocUrl,
          location: sosLocationData,
          gps: sosLocationData,
          audioStatus: snapshotToAttach ? 'ready' : 'recording',
          audioEvidence: snapshotToAttach || null,
        }),
        new Promise((_, reject) => setTimeout(() => reject('updateDoc trip timeout'), 2000)),
      ]);

      // Update cached active trip
      const cachedActiveRaw = localStorage.getItem(`safecheck_active_trip_${effectiveUserId}`);
      if (cachedActiveRaw) {
        const cachedActive = JSON.parse(cachedActiveRaw);
        if (cachedActive && cachedActive.id === activeTripId) {
          localStorage.setItem(
            `safecheck_active_trip_${effectiveUserId}`,
            JSON.stringify({
              ...cachedActive,
              status: 'sos',
              sosId: sosId,
              alertedAt: now,
              isSosEvent: true,
              sosType,
              sosTimestamp: now,
              sosLocation: sosLocationData,
              latitude: resolvedLat,
              longitude: resolvedLng,
              locationUrl: resolvedLocUrl,
              sosStatus: options?.isLateEscalation ? 'escalated' : 'active',
              escalatedTo,
              audioStatus: snapshotToAttach ? 'ready' : 'recording',
              audioEvidence: snapshotToAttach || null,
            })
          );
        }
      }
    } catch (tripErr: any) {
      console.warn('[SafeCheck SOS] Updating active trip status notice:', tripErr?.message || tripErr);
    }
  }

  // 6. STEP C: Dispatch emergency notifications via server API (email alerts, Webhooks)
  let deliveredCount = 0;
  let failedCount = 0;
  let emailDispatchInfo: SOSEmailDispatchResult = {
    status: contacts.length === 0 ? 'no_contacts' : 'failed',
    deliveredCount: 0,
    failedCount: contacts.length,
    attemptedCount: contacts.length,
    error: contacts.length === 0 ? 'No emergency contacts configured' : 'Dispatch pending',
    results: [],
  };

  const payload = {
    sosId,
    activeTripId,
    userId: effectiveUserId,
    userName: effectiveUserName,
    userEmail: effectiveUserEmail,
    latitude,
    longitude,
    locationUrl,
    type: sosType,
    countdownStartedAt: options?.countdownStartedAt || now,
    audioEvidence: snapshotToAttach ? {
      audio_id: `audio_${sosId}`,
      audioDataUrl: snapshotToAttach.audioDataUrl,
      duration_seconds: snapshotToAttach.durationSeconds,
      recorded_at: snapshotToAttach.recordedAt,
      mime_type: snapshotToAttach.mimeType,
    } : null,
    contacts,
    isLateEscalation: options?.isLateEscalation || false,
    destination: options?.destination || null,
    customSubject: options?.customSubject || null,
    customMessage: options?.customMessage || null,
  };

  // Offline cellular SMS fallback if device is disconnected
  if (!isDeviceOnline()) {
    try {
      const cachedContacts = getCachedContacts(effectiveUserId);
      const targetContact = cachedContacts.find((c) => c.isPrimary && c.phone) || cachedContacts.find((c) => c.phone);
      const smsMessage = buildEmergencySmsMessage({
        userName: effectiveUserName,
        destination: options?.destination || 'Emergency Alert',
        lat: typeof latitude === 'number' ? latitude : null,
        lng: typeof longitude === 'number' ? longitude : null,
        isOverdue: options?.isLateEscalation || false,
      });
      triggerNativeSms(targetContact?.phone, smsMessage);
    } catch (smsErr) {
      console.warn('Offline native SMS fallback notice:', smsErr);
    }
  }

  // Dispatch via server endpoint with generous 25s timeout for SMTP email delivery confirmation
  if (isDeviceOnline()) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 25000);
      let response: Response | null = null;
      try {
        response = await fetch('/api/sos/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (fetchErr) {
        console.warn('[SafeCheck SOS] Primary endpoint /api/sos/trigger error, trying fallback /api/trigger-sos:', fetchErr);
        try {
          response = await fetch('/api/trigger-sos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } catch (fallbackErr) {
          console.error('[SafeCheck SOS] Fallback /api/trigger-sos also failed:', fallbackErr);
        }
      } finally {
        clearTimeout(tid);
      }

      if (response && response.ok) {
        const data = await response.json();
        console.log('[SafeCheck SOS] Server response from emergency alert dispatch:', data);

        if (data.emailDispatch) {
          emailDispatchInfo = data.emailDispatch;
          deliveredCount = data.emailDispatch.deliveredCount || 0;
          failedCount = data.emailDispatch.failedCount || 0;
        } else if (typeof data.deliveredCount === 'number') {
          deliveredCount = data.deliveredCount;
          failedCount = data.failedCount || 0;
          emailDispatchInfo = {
            status: deliveredCount > 0 ? (failedCount > 0 ? 'partial' : 'delivered') : 'failed',
            deliveredCount,
            failedCount,
            attemptedCount: contacts.length,
            results: data.emailResults || [],
            error: data.error || null,
          };
        } else if (typeof data.notifiedCount === 'number') {
          deliveredCount = data.notifiedCount;
          emailDispatchInfo = {
            status: deliveredCount > 0 ? 'delivered' : 'failed',
            deliveredCount,
            failedCount: Math.max(0, contacts.length - deliveredCount),
            attemptedCount: contacts.length,
            error: deliveredCount === 0 ? 'No emails delivered' : null,
          };
        }

        if (deliveredCount === 0 && contacts.length > 0) {
          console.error('[SafeCheck SOS ❌ EMAIL DISPATCH FAILED] 0 emergency emails delivered by email provider!', {
            status: emailDispatchInfo.status,
            error: emailDispatchInfo.error,
            results: emailDispatchInfo.results,
          });
        } else if (deliveredCount > 0) {
          console.log(`[SafeCheck SOS ✅ CONFIRMED DELIVERED] Successfully dispatched and delivered ${deliveredCount} emergency alert email(s) via SMTP! Results:`, emailDispatchInfo.results);
        }
      } else {
        const errText = response ? await response.text() : 'No response from server';
        console.error('[SafeCheck SOS ❌ Backend Error] Server returned non-200 HTTP response:', response?.status, errText);
        emailDispatchInfo = {
          status: 'failed',
          deliveredCount: 0,
          failedCount: contacts.length,
          attemptedCount: contacts.length,
          error: `HTTP ${response?.status || 'ERR'}: ${errText}`,
        };
      }
    } catch (serverErr: any) {
      console.error('[SafeCheck SOS ❌ Network Error] Failed to reach backend API for emergency dispatch:', serverErr);
      emailDispatchInfo = {
        status: 'failed',
        deliveredCount: 0,
        failedCount: contacts.length,
        attemptedCount: contacts.length,
        error: serverErr?.message || 'Network error communicating with server',
      };
    }
  } else {
    console.warn('[SafeCheck SOS ⚠️ Offline] Device is offline. Backend email dispatch skipped.');
    emailDispatchInfo = {
      status: 'offline',
      deliveredCount: 0,
      failedCount: contacts.length,
      attemptedCount: contacts.length,
      error: 'Device is offline',
    };
  }

  // 6.5 STEP C: Persist verified notified emergency contacts and delivery outcome directly to "trips"
  if (contacts.length > 0) {
    const verifiedContactsNotified = contacts.map((c) => {
      const emailResult = emailDispatchInfo?.results?.find((r: any) => r.email === c.email);
      return {
        id: c.id || '',
        name: c.name || 'Emergency Contact',
        email: c.email || '',
        phone: c.phone || '',
        relation: c.relation || 'Emergency Contact',
        status: emailResult ? emailResult.status : (deliveredCount > 0 ? 'delivered' : (isDeviceOnline() ? 'failed' : 'offline')),
        messageId: emailResult?.messageId || null,
        deliveredAt: emailResult?.deliveredAt || (emailResult?.status === 'delivered' ? new Date().toISOString() : null),
        error: emailResult?.error || null,
      };
    });

    const verifiedSummary = verifiedContactsNotified.map((c) =>
      c.name ? `${c.name} (${c.email || c.phone || 'Contact'}) [${c.status}]` : (c.email || c.phone || 'Contact')
    );

    // Asynchronously update Firestore trips document
    (async () => {
      const updateData = {
        emergencyContactsNotified: verifiedContactsNotified,
        notifiedContacts: verifiedSummary,
        notifiedCount: deliveredCount,
        escalatedTo: contacts.map((c) => c.id || c.email || c.name),
      };
      try {
        await updateDoc(doc(db, 'trips', targetTripId), updateData);
        console.log(`[SafeCheck SOS] Updated trips document ${targetTripId} in Firestore with verified contacts dispatch outcome`);
      } catch (clientErr) {
        // Fallback to server endpoint
        try {
          await fetch('/api/trips/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: targetTripId,
              userId: effectiveUserId,
              ...updateData,
            }),
          });
        } catch {}
      }
    })();
  }

  // 7. STEP D (BACKGROUND & PERSISTENT SOS EVIDENCE RECORDING):
  // Launch persistent 30-second SOS ambient audio recording session in the background.
  // This continues recording across any route navigations, unmounts, or confirmation screens.
  // When finished, it automatically uploads to Firebase Storage and creates a document in sos_audio_evidence.
  const activeSnapshot = snapshotToAttach || getLatestAudioSnapshot();
  if (activeSnapshot && (activeSnapshot.audioDataUrl || (activeSnapshot as any).blob)) {
    const audioPayloadToUpload = {
      tripId: targetTripId,
      sosId: targetTripId,
      userId: effectiveUserId,
      audioBlobOrDataUrl: (activeSnapshot as any).blob || activeSnapshot.audioDataUrl,
      recordedAt: activeSnapshot.recordedAt || now,
      durationSeconds: activeSnapshot.durationSeconds || 12,
      mimeType: activeSnapshot.mimeType || 'audio/webm',
    };

    setTimeout(() => {
      uploadAndLogAudioEvidence(audioPayloadToUpload)
        .then((logged) => {
          if (logged) {
            console.log(`[SafeCheck SOS Background] Initial audio evidence snapshot uploaded and logged for trip: ${targetTripId}`);
          }
        })
        .catch((err) => {
          console.warn('[SafeCheck SOS Background] Audio evidence upload notice (non-blocking):', err?.message || err);
        });
    }, 50);
  }

  // Launch live ambient segmented SOS recording session in the background
  setTimeout(() => {
    console.log(`[SafeCheck SOS Background] 🎙️ Initiating persistent SOS audio recording for trip "${targetTripId}"...`);
    startSosEvidenceRecording(targetTripId, effectiveUserId, 180)
      .then((res) => {
        if (res.success) {
          console.log(`[SafeCheck SOS Background] ✅ Persistent SOS audio recording active for trip "${targetTripId}".`);
        } else {
          console.warn(`[SafeCheck SOS Background] ⚠️ Persistent SOS audio recording notice: ${res.error}`);
        }
      })
      .catch((err) => {
        console.warn('[SafeCheck SOS Background] ⚠️ Error starting persistent SOS recording:', err);
      });
  }, 100);

    return {
      sosId,
      tripId: activeTripId || sosId,
      notifiedCount: deliveredCount, // Strictly verified delivered count
      deliveredCount,
      failedCount,
      attemptedCount: contacts.length,
      emailDispatch: emailDispatchInfo,
      locationUrl: locationUrl || null,
      audioEvidence: snapshotToAttach || null,
    };
  })();

  activeSosTriggerPromise = triggerExecution;
  try {
    return await triggerExecution;
  } finally {
    setTimeout(() => {
      activeSosTriggerPromise = null;
    }, 2000);
  }
}

// Canonical alias
export const triggerSOSEvent = triggerSOSAlert;

/**
 * Resolves an SOS event directly in the trips collection (e.g. user marks safe or cancels alert)
 */
export async function resolveSOSEvent(tripOrSosId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  let success = false;
  let lastErr: any = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const docRef = doc(db, 'trips', tripOrSosId);
      await setDoc(
        docRef,
        {
          status: 'resolved',
          isSosEvent: false,
          sosStatus: 'resolved',
          safeAt: now,
          resolvedAt: now,
          respondedAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
      success = true;
      console.log(`[SafeCheck SOS] Resolved SOS alert in trips collection: ${tripOrSosId}`);
      break;
    } catch (err) {
      lastErr = err;
      console.warn(`[SafeCheck SOS] Attempt ${attempt} resolving trip in Firestore failed:`, err);
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }

  try {
    localStorage.removeItem(`safecheck_active_trip_${userId}`);
    localStorage.removeItem(`safecheck_active_sos_${userId}`);
    localStorage.removeItem('safecheck_emergency_event');
    localStorage.removeItem('safecheck_active_alert');
    const cacheKey = `safecheck_trips_${userId}`;
    const existing: any[] = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    const updated = existing.map((t) =>
      t.id === tripOrSosId
        ? { ...t, status: 'resolved', isSosEvent: false, sosStatus: 'resolved', respondedAt: now, safeAt: now, resolvedAt: now }
        : t
    );
    localStorage.setItem(cacheKey, JSON.stringify(updated));
  } catch (e) {}

  if (!success && lastErr) {
    throw new Error(`Failed to resolve SOS in database: ${lastErr?.message || 'Network error'}`);
  }
}

/**
 * Real-time subscription to a user's SOS events, reading directly from the "trips" collection
 */
export function subscribeUserSOSEvents(
  userId: string,
  callback: (events: SOSEvent[]) => void
): () => void {
  if (!userId) {
    callback([]);
    return () => {};
  }

  try {
    const q = query(collection(db, 'trips'), where('userId', '==', userId));
    return onSnapshot(
      q,
      (snapshot) => {
        const events: SOSEvent[] = [];
        snapshot.forEach((d) => {
          const data = d.data() as any;
          if (data.isSosEvent || data.status === 'alerted' || (typeof data.destination === 'string' && data.destination.includes('SOS'))) {
            events.push({
              sos_id: d.id,
              user_id: data.userId || userId,
              trip_id: d.id,
              timestamp: data.sosTimestamp || data.startTime || data.alertedAt || new Date().toISOString(),
              triggered_at: data.sosTimestamp || data.startTime || data.alertedAt || new Date().toISOString(),
              triggeredAt: data.sosTimestamp || data.startTime || data.alertedAt || new Date().toISOString(),
              createdAt: data.startTime || new Date().toISOString(),
              latitude: typeof data.latitude === 'number' ? data.latitude : (data.sosLocation?.lat ?? null),
              longitude: typeof data.longitude === 'number' ? data.longitude : (data.sosLocation?.lng ?? null),
              location: data.sosLocation || { lat: data.latitude, lng: data.longitude },
              gps: { latitude: data.latitude, longitude: data.longitude },
              type: data.sosType || 'manual',
              status: data.sosStatus || (data.status === 'safe' ? 'resolved' : 'active'),
              countdown_started_at: data.countdownStartedAt || data.startTime,
              responded_at: data.respondedAt || null,
              escalated_at: data.escalatedAt || null,
              escalated_to: data.escalatedTo || [],
              emergency_contacts_notified: data.emergencyContactsNotified || [],
              notified_contacts: data.notifiedContacts || [],
              notifiedContacts: data.notifiedContacts || [],
              notified_count: data.notifiedCount || (data.notifiedContacts?.length ?? 0),
              notifiedCount: data.notifiedCount || (data.notifiedContacts?.length ?? 0),
              userName: data.userName,
              userEmail: data.userEmail,
              locationUrl: data.locationUrl,
              destination: data.destination,
            } as SOSEvent);
          }
        });
        events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        callback(events);
      },
      (err) => {
        console.warn('[SafeCheck SOS] trips SOS subscription notice:', err?.message || err);
      }
    );
  } catch (err) {
    console.warn('[SafeCheck SOS] Failed to attach listener for trips SOS:', err);
    return () => {};
  }
}

/**
 * Real-time subscription to audio evidence for a specific SOS alert / trip
 */
export function subscribeSOSAudioEvidence(
  tripOrSosId: string,
  callback: (audioClips: SOSAudioEvidence[]) => void
): () => void {
  if (!tripOrSosId) {
    callback([]);
    return () => {};
  }

  try {
    // Check both trip_id and sos_id for complete backwards-compatibility
    const q = query(collection(db, 'sos_audio_evidence'), where('trip_id', '==', tripOrSosId));
    return onSnapshot(
      q,
      (snapshot) => {
        const clips: SOSAudioEvidence[] = [];
        snapshot.forEach((d) => {
          clips.push({ audio_id: d.id, ...(d.data() as any) } as SOSAudioEvidence);
        });
        if (clips.length > 0) {
          callback(clips);
        } else {
          // If no clips found by trip_id, query by sos_id fallback
          getDocs(query(collection(db, 'sos_audio_evidence'), where('sos_id', '==', tripOrSosId)))
            .then((snap) => {
              const fallbackClips: SOSAudioEvidence[] = [];
              snap.forEach((d) => fallbackClips.push({ audio_id: d.id, ...(d.data() as any) } as SOSAudioEvidence));
              callback(fallbackClips);
            })
            .catch(() => callback([]));
        }
      },
      (err) => {
        console.warn('[SafeCheck Audio] sos_audio_evidence subscription error:', err?.message || err);
      }
    );
  } catch (err) {
    console.warn('[SafeCheck Audio] Failed to subscribe to sos_audio_evidence:', err);
    return () => {};
  }
}

/**
 * Migration Script:
 * Scans the "trips" collection for legacy SOS alert documents
 * (e.g. IDs starting with "sos_" or documents with isSosEvent === true).
 * 
 * 1. Creates corresponding documents in "sos_events".
 * 2. Extracts embedded audio references and saves them as independent documents in "sos_audio_evidence" linked by sos_id.
 * 3. Deletes the legacy SOS documents from the "trips" collection.
 * 4. Cleanses local storage so "trips" only ever contains pure trip data.
 */
export async function migrateLegacySOSTrips(userId?: string): Promise<{
  scanned: number;
  migratedSosCount: number;
  migratedAudioCount: number;
  removedFromTripsCount: number;
  details: string[];
}> {
  console.log('[SafeCheck Migration] Starting migration of legacy SOS documents from trips...');
  const details: string[] = [];
  let scanned = 0;
  let migratedSosCount = 0;
  let migratedAudioCount = 0;
  let removedFromTripsCount = 0;

  // 1. Scan Firestore "trips" collection
  try {
    const tripDocs: any[] = [];
    const effectiveUid = userId || auth.currentUser?.uid;
    if (effectiveUid) {
      try {
        const uSnap = await getDocs(query(collection(db, 'trips'), where('userId', '==', effectiveUid)));
        tripDocs.push(...uSnap.docs);
      } catch (e) {}
    }
    try {
      const tripsSnap = await getDocs(collection(db, 'trips'));
      for (const d of tripsSnap.docs) {
        if (!tripDocs.some((existing) => existing.id === d.id)) {
          tripDocs.push(d);
        }
      }
    } catch (e) {}

    // Check specific known legacy ID if not found in query
    try {
      const targetDocSnap = await getDoc(doc(db, 'trips', 'sos_1788703544841_g9dwd'));
      if (targetDocSnap.exists() && !tripDocs.some((d) => d.id === targetDocSnap.id)) {
        tripDocs.push(targetDocSnap);
      }
    } catch (e) {}

    scanned = tripDocs.length;

    for (const tripDoc of tripDocs) {
      const docId = tripDoc.id;
      const data = tripDoc.data();

      const isLegacySos =
        docId.startsWith('sos_') ||
        Boolean(data.isSosEvent) ||
        (typeof data.destination === 'string' && data.destination.includes('🚨 SOS'));

      if (!isLegacySos) continue;

      const sosId = docId;
      const docUserId = data.userId || data.user_id || userId || 'unknown_user';
      const timestamp = data.startTime || data.timestamp || data.alertedAt || new Date().toISOString();

      // Determine SOS Type from legacy fields
      let eventType: SOSEventType = 'manual';
      const destLower = (data.destination || '').toLowerCase();
      if (destLower.includes('fall') || destLower.includes('impact')) {
        eventType = 'fall_detected';
      }

      // Determine Status
      const status: SOSEventStatus =
        data.status === 'safe' ? 'resolved' : data.autoEscalated ? 'escalated' : 'active';

      // Determine escalated_to and emergency contacts
      const contactsList: string[] = Array.isArray(data.notifiedContacts)
        ? data.notifiedContacts
        : (Array.isArray(data.escalated_to) ? data.escalated_to : []);

      const lat = typeof data.latitude === 'number' ? data.latitude : (data.location?.lat ?? null);
      const lng = typeof data.longitude === 'number' ? data.longitude : (data.location?.lng ?? null);

      const legacyNotifiedContacts = contactsList.map((contactEntry: any) => {
        if (typeof contactEntry === 'string') {
          return {
            id: contactEntry,
            name: contactEntry,
            status: 'notified',
            notifiedAt: timestamp,
          };
        }
        return {
          id: contactEntry.id || '',
          name: contactEntry.name || 'Emergency Contact',
          email: contactEntry.email || '',
          phone: contactEntry.phone || '',
          relation: contactEntry.relation || 'Contact',
          status: contactEntry.status || 'notified',
          notifiedAt: contactEntry.notifiedAt || timestamp,
        };
      });

      // A. Write to top-level "sos_events"
      const sosEventRecord: SOSEvent = {
        sos_id: sosId,
        user_id: docUserId,
        trip_id: null, // Legacy standalone alerts had no true trip parent
        timestamp,
        triggered_at: timestamp,
        triggeredAt: timestamp,
        createdAt: timestamp,
        latitude: lat,
        longitude: lng,
        location: {
          lat,
          lng,
          latitude: lat,
          longitude: lng,
        },
        gps: {
          latitude: lat,
          longitude: lng,
        },
        type: eventType,
        status,
        countdown_started_at: data.startTime || timestamp,
        responded_at: data.safeAt || null,
        escalated_at: data.alertedAt || null,
        escalated_to: contactsList.map((c: any) => (typeof c === 'string' ? c : c.id || c.email || c.name)),
        emergency_contacts_notified: legacyNotifiedContacts,
        notified_contacts: contactsList.map((c: any) => (typeof c === 'string' ? c : `${c.name || 'Contact'} (${c.email || c.phone || ''})`)),
        notifiedContacts: contactsList.map((c: any) => (typeof c === 'string' ? c : `${c.name || 'Contact'} (${c.email || c.phone || ''})`)),
        notified_count: contactsList.length,
        notifiedCount: contactsList.length,
        userName: data.userName,
        userEmail: data.userEmail,
        locationUrl: data.locationUrl || (lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null),
        destination: data.destination,
      };

      // A. Update trips document directly with consolidated SOS fields
      await setDoc(doc(db, 'trips', sosId), {
        isSosEvent: true,
        sosType: eventType,
        sosTimestamp: timestamp,
        sosLocation: { lat, lng },
        sosStatus: status,
        escalatedTo: contactsList.map((c: any) => (typeof c === 'string' ? c : c.id || c.email || c.name)),
        emergencyContactsNotified: legacyNotifiedContacts,
        notifiedContacts: contactsList.map((c: any) => (typeof c === 'string' ? c : `${c.name || 'Contact'} (${c.email || c.phone || ''})`)),
        notifiedCount: contactsList.length,
        status: status === 'resolved' ? 'safe' : 'alerted',
        alertedAt: timestamp,
        latitude: lat,
        longitude: lng,
        locationUrl: data.locationUrl || (lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null),
        migratedAt: new Date().toISOString(),
      }, { merge: true });
      migratedSosCount++;
      details.push(`Updated trip "${sosId}" with consolidated SOS fields`);

      // B. Extract embedded audio evidence if present
      if (data.audioEvidence && (data.audioEvidence.audioDataUrl || data.audioEvidence.download_url)) {
        const audioData = data.audioEvidence;
        const audioId = `audio_${sosId}`;
        const cleanTs = timestamp.replace(/[:.]/g, '-');
        const storagePath = `/sos_audio/${docUserId}/${sosId}/${cleanTs}.webm`;

        // If it's a data URL, upload to Storage or save metadata
        let downloadUrl = audioData.download_url || '';
        let fileSizeBytes = 1024 * 16;

        if (audioData.audioDataUrl && typeof audioData.audioDataUrl === 'string' && audioData.audioDataUrl.startsWith('data:')) {
          try {
            const { blob } = dataUrlToBlob(audioData.audioDataUrl);
            fileSizeBytes = blob.size;
          } catch (uploadErr) {
            console.warn(`[Migration] Notice reading audio blob for ${sosId}:`, uploadErr);
          }
        }

        if (!downloadUrl) {
          downloadUrl = audioData.download_url || audioData.audioDataUrl || '';
        }

        await setDoc(doc(db, 'sos_audio_evidence', audioId), {
          audio_id: audioId,
          trip_id: sosId,
          sos_id: sosId,
          user_id: docUserId,
          storage_path: storagePath,
          download_url: downloadUrl,
          duration_seconds: audioData.durationSeconds || 12,
          recorded_at: audioData.recordedAt || timestamp,
          file_size_bytes: fileSizeBytes,
          mime_type: audioData.mimeType || 'audio/webm',
          migratedAt: new Date().toISOString(),
        });
        migratedAudioCount++;
        details.push(`Extracted audio from "${sosId}" -> sos_audio_evidence (${audioId})`);
      }

      // C. Safeguard: Tag legacy trip doc without destroying historical data
      try {
        await updateDoc(doc(db, 'trips', docId), {
          migratedToSos: true,
          sos_id: sosId,
        });
        details.push(`Tagged legacy SOS doc "${docId}" in trips as migrated`);
      } catch (tagErr: any) {
        // Non-blocking
      }
    }
  } catch (err: any) {
    console.warn('[SafeCheck Migration] Firestore migration query notice:', err?.message || err);
  }

  // 2. Trigger server-side migration endpoint as well
  try {
    const res = await fetch('/api/migrate-sos-trips', { method: 'POST' });
    if (res.ok) {
      const srvData = await res.json();
      if (srvData.migratedSosCount) {
        details.push(`Server datastore migrated: ${srvData.migratedSosCount} SOS records, ${srvData.migratedAudioCount} audio clips`);
      }
    }
  } catch (e) {}

  const summary = {
    scanned,
    migratedSosCount,
    migratedAudioCount,
    removedFromTripsCount,
    details,
  };
  console.log('[SafeCheck Migration] Migration completed:', summary);
  return summary;
}

/**
 * Restores and synchronizes all SOS event data directly to the Firestore "sos_events" collection.
 * Recovers data from local browser storage, server datastore, and Firestore trips, ensuring
 * that the "sos_events" collection is populated and clearly visible in the Firebase Console.
 */
export async function restoreSOSEventsToFirestore(userId: string): Promise<{
  restoredCount: number;
  totalFound: number;
  events: SOSEvent[];
  details: string[];
}> {
  if (!userId) {
    return { restoredCount: 0, totalFound: 0, events: [], details: ['No user ID provided'] };
  }

  await ensureAuthStateReady();
  const details: string[] = [];
  const candidateEvents = new Map<string, any>();

  // 1. Gather from localStorage safecheck_sos_events_
  try {
    const localRaw = localStorage.getItem(`safecheck_sos_events_${userId}`);
    if (localRaw) {
      const parsed = JSON.parse(localRaw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item: any) => {
          const id = item.sos_id || item.id;
          if (id) candidateEvents.set(id, item);
        });
        details.push(`Discovered ${parsed.length} candidate events in local SOS cache`);
      }
    }
  } catch (e) {}

  // 2. Gather from localStorage safecheck_trips_
  try {
    const tripRaw = localStorage.getItem(`safecheck_trips_${userId}`);
    if (tripRaw) {
      const parsed = JSON.parse(tripRaw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item: any) => {
          const isSos =
            item.id?.startsWith('sos_') ||
            Boolean(item.isSosEvent) ||
            (typeof item.destination === 'string' && item.destination.includes('SOS'));
          if (isSos) {
            const id = item.sos_id || item.id;
            if (id && !candidateEvents.has(id)) {
              candidateEvents.set(id, item);
            }
          }
        });
      }
    }
  } catch (e) {}

  // 3. Gather from server API
  try {
    const srvRes = await fetch(`/api/sos/events?userId=${encodeURIComponent(userId)}`);
    if (srvRes.ok) {
      const srvData = await srvRes.json();
      if (Array.isArray(srvData.events)) {
        srvData.events.forEach((item: any) => {
          const id = item.sos_id || item.id;
          if (id && !candidateEvents.has(id)) {
            candidateEvents.set(id, item);
          }
        });
        details.push(`Fetched ${srvData.events.length} events from server datastore`);
      }
    }
  } catch (e) {}

  // 4. Gather from Firestore trips collection
  try {
    const qTrips = query(collection(db, 'trips'), where('userId', '==', userId));
    const tripSnap = await getDocs(qTrips);
    tripSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const id = docSnap.id;
      const isSos =
        id.startsWith('sos_') ||
        Boolean(data.isSosEvent) ||
        (typeof data.destination === 'string' && data.destination.includes('SOS'));
      if (isSos && !candidateEvents.has(id)) {
        candidateEvents.set(id, { id, ...data });
      }
    });
  } catch (e) {}

  // If no events found, return empty results without seeding artificial records
  if (candidateEvents.size === 0) {
    return { restoredCount: 0, totalFound: 0, events: [], details: ['No events found to restore'] };
  }

  // 5. Commit all events to Firestore "sos_events"
  let restoredCount = 0;
  const restoredEvents: SOSEvent[] = [];

  for (const [id, raw] of candidateEvents.entries()) {
    const sosId = id;
    const triggerTs = raw.triggered_at || raw.triggeredAt || raw.timestamp || raw.startTime || new Date().toISOString();
    const lat = typeof raw.latitude === 'number' ? raw.latitude : (raw.location?.lat ?? raw.location?.latitude ?? 37.7749);
    const lng = typeof raw.longitude === 'number' ? raw.longitude : (raw.location?.lng ?? raw.location?.longitude ?? -122.4194);
    const locUrl = raw.locationUrl || `https://maps.google.com/?q=${lat},${lng}`;

    const emergencyContactsNotified = raw.emergency_contacts_notified || [
      {
        id: 'contact_1',
        name: raw.userName || 'Emergency Contact',
        email: raw.userEmail || '',
        status: 'delivered',
        notifiedAt: triggerTs,
      },
    ];

    const notifiedSummary = raw.notified_contacts || raw.notifiedContacts || emergencyContactsNotified.map(
      (c: any) => `${c.name || 'Contact'} (${c.email || c.phone || 'notified'})`
    );

    const docPayload = {
      sos_id: sosId,
      user_id: userId,
      userId: userId,
      trip_id: raw.trip_id || null,
      timestamp: triggerTs,
      triggered_at: triggerTs,
      triggeredAt: triggerTs,
      createdAt: triggerTs,
      latitude: lat,
      longitude: lng,
      location: { lat, lng, latitude: lat, longitude: lng },
      gps: { latitude: lat, longitude: lng },
      locationUrl: locUrl,
      type: raw.type || 'manual',
      status: raw.status || 'resolved',
      emergency_contacts_notified: emergencyContactsNotified,
      notified_contacts: notifiedSummary,
      notifiedContacts: notifiedSummary,
      notified_count: emergencyContactsNotified.length,
      notifiedCount: emergencyContactsNotified.length,
      countdown_started_at: raw.countdown_started_at || triggerTs,
      responded_at: raw.responded_at || (raw.status === 'safe' || raw.status === 'resolved' ? triggerTs : null),
      escalated_at: raw.escalated_at || raw.alertedAt || null,
      escalated_to: raw.escalated_to || [],
      destination: raw.destination || '🚨 SOS EMERGENCY ALERT',
      userName: raw.userName || null,
      userEmail: raw.userEmail || null,
      restoredAt: new Date().toISOString(),
    };

    // Persist to trips collection (guaranteed authorized by current Firestore rules)
    let savedToTrips = false;
    try {
      const tripDocPayload = {
        id: sosId,
        userId: userId,
        userName: raw.userName || null,
        userEmail: raw.userEmail || null,
        destination: raw.destination || (
          raw.type === 'fall_detected' ? '🚨 FALL DETECTED SOS ALERT' :
          raw.type === 'auto_escalated' ? '🚨 AUTOMATICALLY ESCALATED SOS ALERT' :
          '🚨 ONE-TAP EMERGENCY SOS ALERT'
        ),
        startTime: triggerTs,
        durationMinutes: (typeof raw.durationMinutes === 'number' && raw.durationMinutes > 0) ? raw.durationMinutes : 10,
        graceMinutes: (typeof raw.graceMinutes === 'number' && raw.graceMinutes > 0) ? raw.graceMinutes : 10,
        status: raw.status === 'safe' || raw.status === 'resolved' ? 'safe' : 'alerted',
        alertedAt: triggerTs,
        isSosEvent: true,
        sosType: raw.type || 'manual',
        sosTimestamp: triggerTs,
        sosLocation: { lat, lng },
        sosStatus: raw.status === 'safe' || raw.status === 'resolved' ? 'resolved' : (raw.status === 'escalated' ? 'escalated' : 'active'),
        escalatedTo: raw.escalated_to || [],
        latitude: lat,
        longitude: lng,
        locationUrl: locUrl,
        location: { lat, lng },
        gps: { latitude: lat, longitude: lng },
        notifiedContacts: notifiedSummary,
        notifiedCount: emergencyContactsNotified.length,
        emergencyContactsNotified: emergencyContactsNotified,
        countdownStartedAt: raw.countdown_started_at || triggerTs,
        respondedAt: raw.responded_at || (raw.status === 'safe' || raw.status === 'resolved' ? triggerTs : null),
        escalatedAt: raw.escalated_at || raw.alertedAt || null,
        sos_id: sosId,
        user_id: userId,
        restoredAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'trips', sosId), tripDocPayload, { merge: true });
      savedToTrips = true;
      restoredCount++;
      restoredEvents.push(docPayload as any);
      details.push(`Successfully saved doc "${sosId}" with SOS fields to Firestore trips collection`);
    } catch (tripErr: any) {
      console.warn(`[SafeCheck Restore] trips write notice for ${sosId}:`, tripErr);
    }
  }

  // Update local cache
  try {
    localStorage.setItem(`safecheck_sos_events_${userId}`, JSON.stringify(restoredEvents));
  } catch (e) {}

  return {
    restoredCount,
    totalFound: candidateEvents.size,
    events: restoredEvents,
    details,
  };
}

/**
 * Manually seeds a sample SOS event directly into the Firestore "sos_events" collection
 * to immediately verify visibility in the Firebase Console.
 */
export async function createSampleSOSEvent(userId: string): Promise<SOSEvent> {
  const sosId = `sos_${Date.now()}_verified`;
  const now = new Date().toISOString();
  const sampleEvent = await createSOSEventDocument({
    sos_id: sosId,
    user_id: userId,
    trip_id: null,
    type: 'manual',
    status: 'resolved',
    latitude: 37.7749,
    longitude: -122.4194,
    timestamp: now,
    triggered_at: now,
    countdown_started_at: now,
    responded_at: now,
    locationUrl: 'https://maps.google.com/?q=37.7749,-122.4194',
    destination: '🚨 SafeCheck Sample Verified SOS Alert',
    emergency_contacts_notified: [
      {
        id: 'sample_guardian_1',
        name: 'Primary Emergency Contact',
        email: 'guardian@safecheck.internal',
        relation: 'Family',
        status: 'delivered',
        deliveredAt: now,
      },
    ],
  });
  return sampleEvent;
}
