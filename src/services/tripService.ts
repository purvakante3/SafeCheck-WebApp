import {
  collection,
  addDoc,
  setDoc,
  doc,
  updateDoc,
  query,
  where,
  getDocs,
  onSnapshot,
  arrayUnion,
  increment,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { Trip, AudioEvidence, LocationTrailPoint, LateTripResponse, UserProfile, SOSEvent, SOSAudioEvidence, SOSEventType } from '../types';
import { freezeAudioSnapshot, purgeAudioSnapshots, getLatestAudioSnapshot } from './audioSnapshotService';
import { ensureAuthStateReady } from './authService';
import { getUserContacts, getCachedContacts } from './contactService';
import {
  createSOSEventDocument,
  uploadAndLogAudioEvidence,
  migrateLegacySOSTrips,
  subscribeUserSOSEvents,
  subscribeSOSAudioEvidence,
  resolveSOSEvent,
  triggerSOSAlert,
  triggerSOSEvent,
  restoreSOSEventsToFirestore,
  createSampleSOSEvent,
} from './sosService';
import {
  isDeviceOnline,
  enqueueOfflineAction,
  syncOfflineTripData,
  buildEmergencySmsUrl,
  buildEmergencySmsMessage,
  triggerNativeSms,
} from './offlineSyncService';

import { triggerHapticFeedback } from '../utils/haptics';

export {
  isDeviceOnline,
  syncOfflineTripData,
  buildEmergencySmsUrl,
  buildEmergencySmsMessage,
  triggerNativeSms,
  migrateLegacySOSTrips,
  subscribeUserSOSEvents,
  subscribeSOSAudioEvidence,
  resolveSOSEvent,
  triggerSOSAlert,
  triggerSOSEvent,
  restoreSOSEventsToFirestore,
  createSampleSOSEvent,
};

const ACTIVE_TRIP_CACHE_PREFIX = 'safecheck_active_trip_';
const TRIPS_CACHE_PREFIX = 'safecheck_trips_';

export function getCachedActiveTrip(userId: string): Trip | null {
  try {
    const raw = localStorage.getItem(`${ACTIVE_TRIP_CACHE_PREFIX}${userId}`);
    if (raw) {
      return JSON.parse(raw) as Trip;
    }
  } catch (e) {
    console.error('Error reading cached active trip:', e);
  }
  return null;
}

export function setCachedActiveTrip(userId: string, trip: Trip | null): void {
  try {
    if (trip) {
      localStorage.setItem(`${ACTIVE_TRIP_CACHE_PREFIX}${userId}`, JSON.stringify(trip));
    } else {
      localStorage.removeItem(`${ACTIVE_TRIP_CACHE_PREFIX}${userId}`);
    }
  } catch (e) {
    console.error('Error setting cached active trip:', e);
  }
}

export function getCachedTrips(userId: string): Trip[] {
  try {
    const raw = localStorage.getItem(`${TRIPS_CACHE_PREFIX}${userId}`);
    if (raw) {
      return JSON.parse(raw) as Trip[];
    }
  } catch (e) {
    console.error('Error reading cached trips:', e);
  }
  return [];
}

export function setCachedTrips(userId: string, trips: Trip[]): void {
  try {
    localStorage.setItem(`${TRIPS_CACHE_PREFIX}${userId}`, JSON.stringify(trips));
  } catch (e) {
    console.error('Error setting cached trips:', e);
  }
}

/**
 * Checks if a status string represents an ongoing active, reminded, or emergency state.
 */
export function isTripActiveStatus(status?: string): boolean {
  return status === 'active' || status === 'reminded' || status === 'sos' || status === 'alerted';
}

/**
 * Evaluates whether a trip is stale or expired:
 * 1. Already marked resolved, cancelled, or safe
 * 2. Older than its scheduled duration plus 24 hours
 */
export function isTripStaleOrExpired(trip: Partial<Trip> | null | undefined): boolean {
  if (!trip) return true;
  if (trip.status === 'resolved' || trip.status === 'cancelled' || trip.status === 'safe') {
    return true;
  }
  if (!trip.startTime) return false;
  const startMs = new Date(trip.startTime).getTime();
  if (isNaN(startMs)) return true;
  const durationMin = typeof trip.durationMinutes === 'number' && trip.durationMinutes > 0 ? trip.durationMinutes : 15;
  const expirationThresholdMs = startMs + durationMin * 60 * 1000 + 24 * 60 * 60 * 1000;
  return Date.now() > expirationThresholdMs;
}

/**
 * Rule 5: Only one active trip at a time.
 * Starting a new trip auto-resolves any leftover active trip in Firestore first.
 */
export async function autoResolveLeftoverTrips(userId: string): Promise<void> {
  if (!userId) return;
  const nowIso = new Date().toISOString();
  if (db && isDeviceOnline()) {
    try {
      const q = query(collection(db, 'trips'), where('userId', '==', userId));
      const snap = await getDocs(q);
      const updates: Promise<any>[] = [];
      snap.forEach((d) => {
        const data = d.data() as Trip;
        if (isTripActiveStatus(data.status)) {
          console.log(`[SafeCheck] Auto-resolving leftover active trip "${d.id}" before starting new trip`);
          updates.push(
            setDoc(
              doc(db, 'trips', d.id),
              {
                status: 'resolved',
                resolvedAt: nowIso,
                safeAt: nowIso,
                isSosEvent: false,
                sosStatus: 'resolved',
                autoResolvedReason: 'Superseded by new trip',
                updatedAt: nowIso,
              },
              { merge: true }
            ).catch((e) => console.warn('Notice auto-resolving leftover trip:', d.id, e))
          );
        }
      });
      await Promise.all(updates);
    } catch (err) {
      console.warn('Notice querying leftover trips for auto-resolve:', err);
    }
  }
  setCachedActiveTrip(userId, null);
  try {
    localStorage.removeItem(`${ACTIVE_TRIP_CACHE_PREFIX}${userId}`);
    localStorage.removeItem(`safecheck_active_sos_${userId}`);
    localStorage.removeItem('safecheck_emergency_event');
  } catch {}
}

/**
 * Rule 3 & 4: Auto-expire stale trips.
 * Checks active trips on load and every 60s. If older than duration + 24h or resolved/cancelled in Firestore,
 * closes it in Firestore and deletes stale local copies.
 */
export async function checkAndExpireStaleTrips(userId: string): Promise<void> {
  if (!userId) return;
  const nowIso = new Date().toISOString();

  // 1. Inspect local cached trip
  const cached = getCachedActiveTrip(userId);
  if (cached) {
    if (isTripStaleOrExpired(cached)) {
      console.log(`[SafeCheck] Clearing stale active trip from local cache: ${cached.id}`);
      setCachedActiveTrip(userId, null);
    }
  }

  // 2. Cross-verify with Firestore: server is the single source of truth
  if (db && isDeviceOnline()) {
    try {
      const q = query(collection(db, 'trips'), where('userId', '==', userId));
      const snap = await getDocs(q);
      const updates: Promise<any>[] = [];
      let foundMatchingCached = false;
      let cachedIsDead = false;

      snap.forEach((d) => {
        const data = d.data() as Trip;
        const tripObj: Trip = { id: d.id, ...data };

        if (cached && cached.id === d.id) {
          foundMatchingCached = true;
          if (
            tripObj.status === 'resolved' ||
            tripObj.status === 'cancelled' ||
            tripObj.status === 'safe' ||
            isTripStaleOrExpired(tripObj)
          ) {
            cachedIsDead = true;
          }
        }

        if (isTripActiveStatus(tripObj.status) && isTripStaleOrExpired(tripObj)) {
          console.log(`[SafeCheck] Auto-expiring stale active trip in Firestore: "${d.id}"`);
          updates.push(
            setDoc(
              doc(db, 'trips', d.id),
              {
                status: 'resolved',
                resolvedAt: nowIso,
                safeAt: nowIso,
                isSosEvent: false,
                sosStatus: 'resolved',
                autoExpired: true,
                updatedAt: nowIso,
              },
              { merge: true }
            ).catch((e) => console.warn('Notice auto-expiring trip:', d.id, e))
          );
        }
      });

      // If cached active trip doesn't exist on server or is resolved, delete local copy
      if (cached && (!foundMatchingCached || cachedIsDead)) {
        console.log(`[SafeCheck] Deleting local active trip cache because server is resolved or doc not found`);
        setCachedActiveTrip(userId, null);
      }

      await Promise.all(updates);
    } catch (err) {
      console.warn('Notice checking stale trips in Firestore:', err);
    }
  }
}

export interface CreateTripOptions {
  userId: string;
  destination: string;
  durationMinutes: number;
  graceMinutes: number;
  userName?: string;
  userEmail?: string;
  latitude?: number | null;
  longitude?: number | null;
  locationUrl?: string | null;
  // Trip Safety Check options
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
}

export async function createTrip(
  userIdOrOptions: string | CreateTripOptions,
  destination?: string,
  durationMinutes?: number,
  graceMinutes?: number,
  userName?: string,
  userEmail?: string,
  latitude?: number | null,
  longitude?: number | null,
  locationUrl?: string | null
): Promise<string> {
  let options: CreateTripOptions;

  if (typeof userIdOrOptions === 'object') {
    options = userIdOrOptions;
  } else {
    options = {
      userId: userIdOrOptions,
      destination: destination || '',
      durationMinutes: durationMinutes || 15,
      graceMinutes: graceMinutes || 10,
      userName: userName || '',
      userEmail: userEmail || '',
      latitude: latitude || null,
      longitude: longitude || null,
      locationUrl: locationUrl || null,
    };
  }

  const now = new Date().toISOString();

  // Initialize location trail with starting point if available
  const initialTrail: LocationTrailPoint[] = options.locationTrail ? [...options.locationTrail] : [];
  if (
    initialTrail.length === 0 &&
    typeof options.startLatitude === 'number' &&
    typeof options.startLongitude === 'number'
  ) {
    initialTrail.push({
      id: `trail_${Date.now()}`,
      latitude: options.startLatitude,
      longitude: options.startLongitude,
      timestamp: now,
      locationUrl: options.startLocationUrl || `https://maps.google.com/?q=${options.startLatitude},${options.startLongitude}`,
      address: options.startAddress || undefined,
    });
  } else if (
    initialTrail.length === 0 &&
    typeof options.latitude === 'number' &&
    typeof options.longitude === 'number'
  ) {
    initialTrail.push({
      id: `trail_${Date.now()}`,
      latitude: options.latitude,
      longitude: options.longitude,
      timestamp: now,
      locationUrl: options.locationUrl || `https://maps.google.com/?q=${options.latitude},${options.longitude}`,
    });
  }

  const tripData: Omit<Trip, 'id'> = {
    userId: options.userId,
    destination: options.destination,
    durationMinutes: options.durationMinutes,
    graceMinutes: options.graceMinutes,
    userName: options.userName || '',
    userEmail: options.userEmail || '',
    latitude: options.latitude || options.startLatitude || null,
    longitude: options.longitude || options.startLongitude || null,
    locationUrl: options.locationUrl || options.startLocationUrl || null,
    startTime: now,
    status: 'active',
    reminderSentAt: null,
    // Safety check specific fields
    startLatitude: options.startLatitude || options.latitude || null,
    startLongitude: options.startLongitude || options.longitude || null,
    startLocationUrl: options.startLocationUrl || options.locationUrl || null,
    startAddress: options.startAddress || null,
    destinationLatitude: options.destinationLatitude || null,
    destinationLongitude: options.destinationLongitude || null,
    destinationAddress: options.destinationAddress || options.destination,
    durationMode: options.durationMode || 'manual',
    travelMode: options.travelMode || 'walking',
    estimatedDistanceMeters: options.estimatedDistanceMeters || undefined,
    locationTrail: initialTrail,
    lastKnownLatitude: options.startLatitude || options.latitude || null,
    lastKnownLongitude: options.startLongitude || options.longitude || null,
    lastKnownAddress: options.startAddress || null,
    lastLocationUpdate: now,
    lowBatteryAlertSent: false,
    lowBatteryAlertSentAt: null,
    lowBatteryLevel: null,
  };

  // Rule 5: Only one active trip at a time. Starting a new trip auto-resolves any leftover active trip first.
  await autoResolveLeftoverTrips(options.userId);

  let createdTripId = '';

  // 1. PRIMARY: Write directly to Firestore if online
  if (isDeviceOnline()) {
    try {
      const docRef = await addDoc(collection(db, 'trips'), tripData);
      createdTripId = docRef.id;
    } catch (firestoreErr) {
      console.error('Error creating trip in Firestore:', firestoreErr);
    }
  }

  // Fallback ID if offline / Firestore write failed
  const isOfflineTrip = !createdTripId;
  if (!createdTripId) {
    createdTripId = `trip_offline_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }

  const newTrip: Trip = { id: createdTripId, ...tripData };
  setCachedActiveTrip(options.userId, newTrip);
  const cachedTrips = getCachedTrips(options.userId);
  setCachedTrips(options.userId, [newTrip, ...cachedTrips]);

  // If offline, queue for sync when back online
  if (isOfflineTrip || !isDeviceOnline()) {
    enqueueOfflineAction({
      type: 'create_trip',
      userId: options.userId,
      tripId: createdTripId,
      payload: newTrip,
    });
  }

  // 2. SECONDARY: Sync to server in background if online (non-blocking)
  if (isDeviceOnline()) {
    try {
      await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...tripData,
          id: createdTripId,
        }),
      });
    } catch (serverErr) {
      console.error('Error syncing created trip to backup server endpoint:', serverErr);
    }
  }

  triggerHapticFeedback('start-checkin');

  return createdTripId;
}

/**
 * Appends a new GPS breadcrumb to the active trip's location trail
 */
export async function appendTripLocationTrail(
  tripId: string,
  userId: string,
  point: LocationTrailPoint
): Promise<void> {
  if (!tripId || !userId) return;

  // 1. Update local active trip cache immediately
  const cachedActive = getCachedActiveTrip(userId);
  if (cachedActive && cachedActive.id === tripId) {
    const trail = cachedActive.locationTrail || [];
    const updated: Trip = {
      ...cachedActive,
      locationTrail: [...trail, point],
      lastKnownLatitude: point.latitude,
      lastKnownLongitude: point.longitude,
      lastKnownAddress: point.address || cachedActive.lastKnownAddress,
      lastLocationUpdate: point.timestamp,
      latitude: point.latitude,
      longitude: point.longitude,
      locationUrl: point.locationUrl || cachedActive.locationUrl,
    };
    setCachedActiveTrip(userId, updated);
  }

  const cachedTrips = getCachedTrips(userId);
  const updatedTrips = cachedTrips.map((t) => {
    if (t.id === tripId) {
      const trail = t.locationTrail || [];
      return {
        ...t,
        locationTrail: [...trail, point],
        lastKnownLatitude: point.latitude,
        lastKnownLongitude: point.longitude,
        lastKnownAddress: point.address || t.lastKnownAddress,
        lastLocationUpdate: point.timestamp,
        latitude: point.latitude,
        longitude: point.longitude,
        locationUrl: point.locationUrl || t.locationUrl,
      };
    }
    return t;
  });
  setCachedTrips(userId, updatedTrips);

  // 2. PRIMARY: Update Firestore doc with arrayUnion
  let firestoreSuccess = false;
  let documentMissing = false;
  if (isDeviceOnline()) {
    try {
      if (!tripId.startsWith('trip_offline_') && !tripId.startsWith('trip_local_')) {
        const docRef = doc(db, 'trips', tripId);
        await updateDoc(docRef, {
          locationTrail: arrayUnion(point),
          lastKnownLatitude: point.latitude,
          lastKnownLongitude: point.longitude,
          lastKnownAddress: point.address || null,
          lastLocationUpdate: point.timestamp,
          latitude: point.latitude,
          longitude: point.longitude,
          locationUrl: point.locationUrl || null,
        });
        firestoreSuccess = true;
      }
    } catch (firestoreErr: any) {
      const isNotFound = firestoreErr?.code === 'not-found' || firestoreErr?.message?.includes('No document to update');
      if (isNotFound) {
        documentMissing = true;
        console.warn(`[SafeCheck Trip Trail] 🛑 Document "${tripId}" was deleted from Firestore. Halting trail tracking and clearing active session.`);
        setCachedActiveTrip(userId, null);
        const currentCached = getCachedTrips(userId);
        setCachedTrips(userId, currentCached.filter((t) => t.id !== tripId));
        return;
      }
      console.warn('Firestore update for location trail notice:', firestoreErr);
    }

    // Also update linked sosId record in Firestore if exists so guardian sees live location
    const linkedSosId = cachedActive?.sosId || cachedTrips.find((t) => t.id === tripId)?.sosId;
    if (linkedSosId && linkedSosId !== tripId) {
      try {
        await updateDoc(doc(db, 'trips', linkedSosId), {
          locationTrail: arrayUnion(point),
          lastKnownLatitude: point.latitude,
          lastKnownLongitude: point.longitude,
          lastKnownAddress: point.address || null,
          lastLocationUpdate: point.timestamp,
          latitude: point.latitude,
          longitude: point.longitude,
          locationUrl: point.locationUrl || null,
        });
      } catch (err) {
        console.warn('Linked SOS doc trail update notice:', err);
      }
    }
  }

  // If offline or write failed (and document was not deleted), enqueue for sync on reconnect
  if (!documentMissing && (!isDeviceOnline() || !firestoreSuccess)) {
    enqueueOfflineAction({
      type: 'trail_point',
      userId,
      tripId,
      payload: point,
    });
  }

  // 3. SECONDARY: Sync to server if online
  if (isDeviceOnline()) {
    try {
      await fetch(`/api/trips/${tripId}/trail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ point }),
      });
    } catch {}
  }
}

/**
 * Logs a late trip popup response ("Stuck in traffic", "Running late", etc.)
 */
export async function recordLateTripResponse(
  tripId: string,
  userId: string,
  response: LateTripResponse
): Promise<void> {
  // 1. Update local cache
  const cachedActive = getCachedActiveTrip(userId);
  if (cachedActive && cachedActive.id === tripId) {
    const responses = cachedActive.lateResponses || [];
    const newDuration = response.extendedMinutes
      ? cachedActive.durationMinutes + response.extendedMinutes
      : cachedActive.durationMinutes;
    const updated: Trip = {
      ...cachedActive,
      lateResponses: [...responses, response],
      durationMinutes: newDuration,
    };
    setCachedActiveTrip(userId, updated);
  }

  // 2. PRIMARY: Update Firestore
  let firestoreSuccess = false;
  if (isDeviceOnline()) {
    try {
      if (!tripId.startsWith('trip_offline_') && !tripId.startsWith('trip_local_')) {
        const docRef = doc(db, 'trips', tripId);
        const updates: any = {
          lateResponses: arrayUnion(response),
        };
        if (response.extendedMinutes && response.extendedMinutes > 0) {
          updates.durationMinutes = increment(response.extendedMinutes);
        }
        await updateDoc(docRef, updates);
        firestoreSuccess = true;
      }
    } catch (err) {
      console.warn('Error saving late trip response to Firestore:', err);
    }
  }

  if (!isDeviceOnline() || !firestoreSuccess) {
    enqueueOfflineAction({
      type: 'late_response',
      userId,
      tripId,
      payload: response,
    });
  }

  // 3. Record check-in event
  await recordTripCheckInEvent(tripId, userId, {
    type: 'manual_check_in',
    message: `Late check-in response: "${response.reason}"${response.note ? ` (${response.note})` : ''}${
      response.extendedMinutes ? ` [Extended +${response.extendedMinutes}m]` : ''
    }`,
  });
}

export async function recordTripCheckInEvent(
  tripId: string,
  userId: string,
  event: { type: 'scheduled_check_in' | 'manual_check_in' | 'reminder_sent' | 'emergency_alert'; message: string }
): Promise<void> {
  const newEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  if (userId) {
    const cachedActive = getCachedActiveTrip(userId);
    if (cachedActive && cachedActive.id === tripId) {
      const events = cachedActive.checkInEvents || [];
      const updated = { ...cachedActive, checkInEvents: [...events, newEvent] };
      setCachedActiveTrip(userId, updated);
    }

    const cachedTrips = getCachedTrips(userId);
    const updatedTrips = cachedTrips.map((t) => {
      if (t.id === tripId) {
        const events = t.checkInEvents || [];
        return { ...t, checkInEvents: [...events, newEvent] };
      }
      return t;
    });
    setCachedTrips(userId, updatedTrips);
  }

  if (!isDeviceOnline()) {
    enqueueOfflineAction({
      type: 'check_in_event',
      userId,
      tripId,
      payload: newEvent,
    });
  }
}

export async function markTripSafe(tripId: string, userId?: string): Promise<void> {
  // Purge any temporary rolling audio snapshots on safe arrival
  purgeAudioSnapshots();
  const now = new Date().toISOString();

  let linkedSosId: string | undefined;

  // Rule 2: Clear local cache immediately so UI and banner remove immediately
  if (userId) {
    const cachedActive = getCachedActiveTrip(userId);
    linkedSosId = cachedActive?.id === tripId ? cachedActive?.sosId : undefined;
    setCachedActiveTrip(userId, null);
    try {
      localStorage.removeItem(`${ACTIVE_TRIP_CACHE_PREFIX}${userId}`);
      localStorage.removeItem(`safecheck_active_sos_${userId}`);
      localStorage.removeItem('safecheck_emergency_event');
      localStorage.removeItem('safecheck_active_alert');
    } catch {}

    const cached = getCachedTrips(userId);
    const updated = cached.map((t) => {
      if (t.id === tripId) {
        if (!linkedSosId) linkedSosId = t.sosId;
        return {
          ...t,
          status: 'resolved' as const,
          safeAt: now,
          resolvedAt: now,
          isSosEvent: false,
          sosStatus: 'resolved' as const,
        };
      }
      return t;
    });
    setCachedTrips(userId, updated);
  }

  let firestoreSuccess = false;
  let lastError: any = null;

  // 1. PRIMARY: Update Firestore with automatic retries (Rule 2: Never fail silently)
  if (isDeviceOnline() && db) {
    const isOfflineTrip = tripId.startsWith('trip_offline_') || tripId.startsWith('trip_local_');
    if (!isOfflineTrip) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const docRef = doc(db, 'trips', tripId);
          await setDoc(
            docRef,
            {
              status: 'resolved',
              isSosEvent: false,
              sosStatus: 'resolved',
              safeAt: now,
              resolvedAt: now,
              updatedAt: now,
            },
            { merge: true }
          );

          // Also update linked sosId document in Firestore
          if (linkedSosId && linkedSosId !== tripId) {
            try {
              await setDoc(
                doc(db, 'trips', linkedSosId),
                {
                  status: 'resolved',
                  isSosEvent: false,
                  sosStatus: 'resolved',
                  safeAt: now,
                  resolvedAt: now,
                  updatedAt: now,
                },
                { merge: true }
              );
            } catch {}
          }

          firestoreSuccess = true;
          break;
        } catch (firestoreErr) {
          lastError = firestoreErr;
          console.warn(`[SafeCheck] Attempt ${attempt} marking trip ${tripId} safe failed:`, firestoreErr);
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 400 * attempt));
          }
        }
      }

      if (!firestoreSuccess) {
        console.error(`[SafeCheck] All attempts to mark trip ${tripId} safe in Firestore failed:`, lastError);
        enqueueOfflineAction({
          type: 'trip_status',
          userId: userId || '',
          tripId,
          payload: { status: 'resolved', safeAt: now, resolvedAt: now, timestamp: now },
        });
        throw new Error(
          `Failed to update safety status on server: ${lastError?.message || 'Network error'}. Changes stored locally; please retry.`
        );
      }
    }
  }

  if (!isDeviceOnline() || !firestoreSuccess) {
    enqueueOfflineAction({
      type: 'trip_status',
      userId: userId || '',
      tripId,
      payload: { status: 'resolved', safeAt: now, resolvedAt: now, timestamp: now },
    });
  }

  // 2. SECONDARY: Update server in background
  if (isDeviceOnline()) {
    try {
      await fetch(`/api/trips/${encodeURIComponent(tripId)}/safe`, { method: 'POST' });
    } catch (serverErr) {
      console.warn(`Notice updating backup server for trip ${tripId} safe:`, serverErr);
    }
  }
}

export async function endSOS(tripOrSosId: string, userId: string): Promise<void> {
  return markTripSafe(tripOrSosId, userId);
}

export async function cancelTrip(tripId: string, userId?: string): Promise<void> {
  // Purge any temporary rolling audio snapshots on cancel
  purgeAudioSnapshots();
  const now = new Date().toISOString();

  let linkedSosId: string | undefined;

  // Rule 2: Clear local cache immediately so UI and banner remove immediately
  if (userId) {
    const cachedActive = getCachedActiveTrip(userId);
    linkedSosId = cachedActive?.id === tripId ? cachedActive?.sosId : undefined;
    setCachedActiveTrip(userId, null);
    try {
      localStorage.removeItem(`${ACTIVE_TRIP_CACHE_PREFIX}${userId}`);
      localStorage.removeItem(`safecheck_active_sos_${userId}`);
      localStorage.removeItem('safecheck_emergency_event');
      localStorage.removeItem('safecheck_active_alert');
    } catch {}

    const cached = getCachedTrips(userId);
    const updated = cached.map((t) => {
      if (t.id === tripId) {
        if (!linkedSosId) linkedSosId = t.sosId;
        return {
          ...t,
          status: 'cancelled' as const,
          cancelledAt: now,
          isSosEvent: false,
          sosStatus: 'cancelled' as const,
        };
      }
      return t;
    });
    setCachedTrips(userId, updated);
  }

  let firestoreSuccess = false;
  let lastError: any = null;

  // 1. PRIMARY: Update Firestore with automatic retries
  if (isDeviceOnline() && db) {
    const isOfflineTrip = tripId.startsWith('trip_offline_') || tripId.startsWith('trip_local_');
    if (!isOfflineTrip) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const docRef = doc(db, 'trips', tripId);
          await setDoc(
            docRef,
            {
              status: 'cancelled',
              isSosEvent: false,
              sosStatus: 'cancelled',
              cancelledAt: now,
              updatedAt: now,
            },
            { merge: true }
          );

          if (linkedSosId && linkedSosId !== tripId) {
            try {
              await setDoc(
                doc(db, 'trips', linkedSosId),
                {
                  status: 'cancelled',
                  isSosEvent: false,
                  sosStatus: 'cancelled',
                  cancelledAt: now,
                  updatedAt: now,
                },
                { merge: true }
              );
            } catch {}
          }

          firestoreSuccess = true;
          break;
        } catch (firestoreErr) {
          lastError = firestoreErr;
          console.warn(`[SafeCheck] Attempt ${attempt} cancelling trip ${tripId} failed:`, firestoreErr);
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 400 * attempt));
          }
        }
      }

      if (!firestoreSuccess) {
        console.error(`[SafeCheck] All attempts to cancel trip ${tripId} in Firestore failed:`, lastError);
        enqueueOfflineAction({
          type: 'trip_status',
          userId: userId || '',
          tripId,
          payload: { status: 'cancelled', cancelledAt: now, timestamp: now },
        });
        throw new Error(
          `Failed to cancel trip on server: ${lastError?.message || 'Network error'}. Changes stored locally; please retry.`
        );
      }
    }
  }

  if (!isDeviceOnline() || !firestoreSuccess) {
    enqueueOfflineAction({
      type: 'trip_status',
      userId: userId || '',
      tripId,
      payload: { status: 'cancelled', cancelledAt: now, timestamp: now },
    });
  }

  // 2. SECONDARY: Update server in background
  if (isDeviceOnline()) {
    try {
      await fetch(`/api/trips/${encodeURIComponent(tripId)}/cancel`, { method: 'POST' });
    } catch (serverErr) {
      console.warn(`Notice updating backup server for trip ${tripId} cancel:`, serverErr);
    }
  }
}

export async function getUserTrips(userId: string): Promise<Trip[]> {
  // 1. PRIMARY: Query Firestore
  try {
    const q = query(collection(db, 'trips'), where('userId', '==', userId));
    const querySnapshot = await getDocs(q);
    const trips: Trip[] = [];
    querySnapshot.forEach((d) => {
      const data = d.data();
      trips.push({ id: d.id, ...data } as Trip);
    });

    if (trips.length > 0) {
      trips.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
      setCachedTrips(userId, trips);
      return trips;
    }
  } catch (firestoreErr) {
    console.error('Error fetching trips from Firestore in getUserTrips:', firestoreErr);
  }

  // 2. SECONDARY: Try server API if Firestore had no records or threw error
  try {
    const res = await fetch(`/api/trips?userId=${encodeURIComponent(userId)}`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.trips) && data.trips.length > 0) {
        setCachedTrips(userId, data.trips);
        return data.trips;
      }
    }
  } catch (serverErr) {
    console.error('Error fetching trips from server API:', serverErr);
  }

  // 3. Fallback: Return cached trips
  return getCachedTrips(userId);
}

export function subscribeUserTrips(userId: string, callback: (trips: Trip[]) => void) {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    callback([]);
    return () => {};
  }

  // 1. Emit cached trips immediately for instant render
  const cached = getCachedTrips(userId);
  if (cached && cached.length > 0) {
    callback(cached);
  }

  // 2. PRIMARY: Real-time Firestore snapshot listener
  let unsubFirestore = () => {};
  try {
    const q = query(collection(db, 'trips'), where('userId', '==', userId));
    unsubFirestore = onSnapshot(
      q,
      (snapshot) => {
        const trips: Trip[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          trips.push({ id: d.id, ...data } as Trip);
        });
        trips.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
        setCachedTrips(userId, trips);
        callback(trips);
      },
      (error) => {
        console.warn('Firestore snapshot notice for user trips (using cached/server data):', error?.message || error);
        getUserTrips(userId).then((trips) => {
          if (trips && trips.length > 0) callback(trips);
        }).catch(() => {});
      }
    );
  } catch (snapshotErr) {
    console.warn('Failed to attach Firestore snapshot listener for user trips, falling back to server:', snapshotErr);
    getUserTrips(userId).then((trips) => {
      if (trips && trips.length > 0) callback(trips);
    }).catch(() => {});
  }

  return () => {
    unsubFirestore();
  };
}

export function subscribeActiveTrip(userId: string, callback: (trip: Trip | null) => void) {
  if (!userId || typeof userId !== 'string' || userId.trim() === '') {
    callback(null);
    return () => {};
  }

  // 1. Emit cached active trip only if valid and not stale/expired
  const cached = getCachedActiveTrip(userId);
  if (cached && isTripActiveStatus(cached.status) && !isTripStaleOrExpired(cached)) {
    callback(cached);
  } else if (cached) {
    setCachedActiveTrip(userId, null);
  }

  // 2. PRIMARY: Real-time Firestore snapshot listener (Single source of truth)
  let unsubFirestore = () => {};
  try {
    const q = query(collection(db, 'trips'), where('userId', '==', userId));
    unsubFirestore = onSnapshot(
      q,
      (snapshot) => {
        let activeTripDoc: Trip | null = null;
        const staleDocIds: string[] = [];

        snapshot.forEach((d) => {
          const data = d.data() as Omit<Trip, 'id'>;
          const fullTrip: Trip = { id: d.id, ...data };

          if (isTripActiveStatus(data.status)) {
            if (isTripStaleOrExpired(fullTrip)) {
              staleDocIds.push(d.id);
            } else {
              // Pick active trip: prefer full scheduled trip with duration > 0, latest startTime
              const isFullTrip = typeof data.durationMinutes === 'number' && data.durationMinutes > 0;
              const currentIsFullTrip =
                activeTripDoc &&
                typeof activeTripDoc.durationMinutes === 'number' &&
                activeTripDoc.durationMinutes > 0;

              if (!activeTripDoc) {
                activeTripDoc = fullTrip;
              } else if (isFullTrip && !currentIsFullTrip) {
                activeTripDoc = fullTrip;
              } else if (isFullTrip === currentIsFullTrip && new Date(data.startTime) > new Date(activeTripDoc.startTime)) {
                activeTripDoc = fullTrip;
              }
            }
          }
        });

        // Auto-expire any stale trips detected in snapshot
        if (staleDocIds.length > 0) {
          const nowIso = new Date().toISOString();
          staleDocIds.forEach((id) => {
            setDoc(
              doc(db, 'trips', id),
              {
                status: 'resolved',
                resolvedAt: nowIso,
                safeAt: nowIso,
                isSosEvent: false,
                sosStatus: 'resolved',
                autoExpired: true,
                updatedAt: nowIso,
              },
              { merge: true }
            ).catch(() => {});
          });
        }

        // Rule 4: Firestore is single source of truth. Always sync local cache with server.
        setCachedActiveTrip(userId, activeTripDoc);
        callback(activeTripDoc);
      },
      (error) => {
        console.warn('Firestore snapshot notice for active trip (using cached/server data):', error?.message || error);
        getUserTrips(userId).then((trips) => {
          const active = trips.find((t) => isTripActiveStatus(t.status) && !isTripStaleOrExpired(t)) || null;
          setCachedActiveTrip(userId, active);
          callback(active);
        }).catch(() => {
          const c = getCachedActiveTrip(userId);
          if (c && !isTripStaleOrExpired(c)) {
            callback(c);
          } else {
            setCachedActiveTrip(userId, null);
            callback(null);
          }
        });
      }
    );
  } catch (snapshotErr) {
    console.warn('Failed to attach Firestore snapshot listener for active trip, falling back to server:', snapshotErr);
    getUserTrips(userId).then((trips) => {
      const active = trips.find((t) => isTripActiveStatus(t.status) && !isTripStaleOrExpired(t)) || null;
      setCachedActiveTrip(userId, active);
      callback(active);
    }).catch(() => {
      const c = getCachedActiveTrip(userId);
      if (c && !isTripStaleOrExpired(c)) {
        callback(c);
      } else {
        setCachedActiveTrip(userId, null);
        callback(null);
      }
    });
  }

  return () => {
    unsubFirestore();
  };
}

/**
 * Triggers automated SOS alert when a user fails to respond to the 2-minute late arrival popup
 */
export async function triggerLateTripAutoEscalation(
  trip: Trip,
  user: UserProfile,
  currentLocation?: { latitude: number | null; longitude: number | null; locationUrl?: string | null; address?: string | null }
): Promise<void> {
  const lat = currentLocation?.latitude ?? trip.lastKnownLatitude ?? trip.latitude ?? null;
  const lng = currentLocation?.longitude ?? trip.lastKnownLongitude ?? trip.longitude ?? null;
  const locUrl = currentLocation?.locationUrl ?? trip.locationUrl ?? (lat && lng ? `https://maps.google.com/?q=${lat},${lng}` : null);

  // If offline, trigger native cellular SMS fallback immediately
  if (!isDeviceOnline()) {
    try {
      const cachedContacts = getCachedContacts(user.uid);
      const targetContact = cachedContacts.find((c) => c.isPrimary && c.phone) || cachedContacts.find((c) => c.phone);
      const smsMessage = buildEmergencySmsMessage({
        userName: user.name,
        destination: trip.destination,
        lat,
        lng,
        address: currentLocation?.address || trip.lastKnownAddress,
        isOverdue: true,
      });
      triggerNativeSms(targetContact?.phone, smsMessage);
    } catch (smsErr) {
      console.warn('Offline native SMS fallback in auto-escalation notice:', smsErr);
    }
  }

  // Mark trip as alerted & auto-escalated
  try {
    if (isDeviceOnline() && !trip.id.startsWith('trip_offline_') && !trip.id.startsWith('trip_local_')) {
      const docRef = doc(db, 'trips', trip.id);
      await updateDoc(docRef, {
        status: 'alerted',
        alertedAt: new Date().toISOString(),
        autoEscalated: true,
      });
    }
  } catch (e) {}

  await triggerSOSAlert(
    user.uid,
    user.name,
    user.email,
    lat,
    lng,
    locUrl,
    null,
    {
      isLateEscalation: true,
      destination: trip.destination,
      activeTripId: trip.id,
      customSubject: `⚠️ AUTOMATED SAFETY CHECK ALERT: ${user.name || 'User'} overdue for arrival at "${trip.destination}"`,
      customMessage: `AUTOMATED ARRIVAL SAFETY CHECK TIMEOUT: ${user.name || 'User'} scheduled a safety check-in for a trip to "${trip.destination}". The arrival time was reached, the user did not mark themselves as arrived, and did not respond within the 2-minute safety check alert window. Most recent GPS tracking coordinates are attached below.`,
    }
  );

  await recordTripCheckInEvent(trip.id, user.uid, {
    type: 'emergency_alert',
    message: `Automated SOS Escalation: User reached expected arrival time for "${trip.destination}", did not mark arrived, and did not respond within 2 minutes.${!isDeviceOnline() ? ' (Triggered via Native Cellular SMS fallback)' : ''}`,
  });
}

export async function getActiveTrip(userId: string): Promise<Trip | null> {
  if (!userId) return null;
  const isTripActiveStatus = (status?: string) => {
    return status === 'active' || status === 'reminded' || status === 'sos' || status === 'alerted';
  };
  const cached = getCachedActiveTrip(userId);
  if (cached && isTripActiveStatus(cached.status)) {
    return cached;
  }
  try {
    const trips = await getUserTrips(userId);
    return trips.find((t) => isTripActiveStatus(t.status)) || null;
  } catch {
    return cached && isTripActiveStatus(cached.status) ? cached : null;
  }
}
