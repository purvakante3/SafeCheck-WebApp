import { doc, getDoc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { Trip } from '../types';

/**
 * Generates a unique, shareable public guardian link for a specific trip.
 * Anyone with this link can view the traveler's live status without login.
 */
export function getGuardianUrl(tripId: string): string {
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    const pathname = window.location.pathname === '/' ? '' : window.location.pathname;
    return `${origin}${pathname}?guardian=${encodeURIComponent(tripId)}`;
  }
  return `https://safecheck.app/?guardian=${encodeURIComponent(tripId)}`;
}

/**
 * Generates a persistent guardian link for a specific user profile.
 */
export function getGuardianUserUrl(userId: string): string {
  if (typeof window !== 'undefined') {
    const origin = window.location.origin;
    const pathname = window.location.pathname === '/' ? '' : window.location.pathname;
    return `${origin}${pathname}?guardianUser=${encodeURIComponent(userId)}`;
  }
  return `https://safecheck.app/?guardianUser=${encodeURIComponent(userId)}`;
}

/**
 * Fetches guardian trip data once from server, Firestore, or fallback storage.
 * Rigorously queries and joins both the trip document's sosLocation and linked sos_audio_evidence.
 */
export async function fetchGuardianTrip(tripId: string): Promise<Trip | null> {
  console.log(`[SafeCheck Guardian Fetch] 🔎 Starting Guardian data fetch for trip_id="${tripId}" at ${new Date().toISOString()}...`);

  let tripData: Trip | null = null;

  // 1. Try server API
  try {
    const res = await fetch(`/api/guardian/${encodeURIComponent(tripId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.trip) {
        tripData = data.trip as Trip;
        console.log(`[SafeCheck Guardian Fetch] ✅ Server returned trip for "${tripId}": status="${tripData.status}", isSosEvent=${Boolean(tripData.isSosEvent)}, hasAudio=${Boolean(tripData.audioEvidence)}, hasLocation=${Boolean(tripData.latitude || tripData.sosLocation)}`);
      }
    }
  } catch (e) {
    console.warn('[SafeCheck Guardian Fetch] Server endpoint fetch notice:', e);
  }

  // 2. Try Firestore trips collection if not found or needs enrichment
  if (!tripData) {
    try {
      const docRef = doc(db, 'trips', tripId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        tripData = { id: docSnap.id, ...docSnap.data() } as Trip;
        console.log(`[SafeCheck Guardian Fetch] ✅ Retrieved trip from Firestore 'trips' collection for "${tripId}": status="${tripData.status}"`);
      }
    } catch (e) {
      console.warn('[SafeCheck Guardian Fetch] Firestore trips fetch notice:', e);
    }
  }

  // 3. Fallback to localStorage if still not found
  if (!tripData && typeof localStorage !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('safecheck_trips_') || key.startsWith('safecheck_active_trip_'))) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const match = parsed.find((t: Trip) => t.id === tripId);
              if (match) {
                tripData = match;
                console.log(`[SafeCheck Guardian Fetch] 💾 Found trip "${tripId}" in localStorage (${key})`);
                break;
              }
            } else if (parsed && parsed.id === tripId) {
              tripData = parsed;
              console.log(`[SafeCheck Guardian Fetch] 💾 Found trip "${tripId}" in localStorage (${key})`);
              break;
            }
          }
        }
      }
    } catch (e) {}
  }

  if (!tripData) {
    console.warn(`[SafeCheck Guardian Fetch] ⚠️ Trip "${tripId}" not found across server, Firestore, and local storage.`);
    return null;
  }

  // 4. Ensure linked audio evidence is queried from independent "sos_audio_evidence" collection
  if (!tripData.audioEvidence) {
    console.log(`[SafeCheck Guardian Fetch] 🎵 Querying Firestore 'sos_audio_evidence' collection where trip_id == "${tripId}"...`);
    try {
      let audioSnap = await getDocs(query(collection(db, 'sos_audio_evidence'), where('trip_id', '==', tripId)));
      if (audioSnap.empty) {
        // Fallback check where sos_id matches
        audioSnap = await getDocs(query(collection(db, 'sos_audio_evidence'), where('sos_id', '==', tripId)));
      }

      if (!audioSnap.empty) {
        const aDoc = audioSnap.docs[0].data();
        console.log(`[SafeCheck Guardian Fetch] ✅ Found ${audioSnap.docs.length} audio evidence document(s) in 'sos_audio_evidence' for trip_id="${tripId}". Audio ID: "${aDoc.audio_id}", Download URL: ${aDoc.download_url}`);
        tripData.audioEvidence = {
          id: aDoc.audio_id,
          tripId: tripId,
          alertId: tripId,
          userId: aDoc.user_id,
          audioDataUrl: aDoc.download_url,
          download_url: aDoc.download_url,
          storage_path: aDoc.storage_path,
          recordedAt: aDoc.recorded_at,
          durationSeconds: aDoc.duration_seconds,
          mimeType: aDoc.mime_type,
        };
      } else {
        console.log(`[SafeCheck Guardian Fetch] ℹ️ No audio evidence documents found in 'sos_audio_evidence' for trip_id="${tripId}" yet.`);
      }
    } catch (aErr) {
      console.warn('[SafeCheck Guardian Fetch] Notice querying sos_audio_evidence:', aErr);
    }
  }

  // 5. Normalization of GPS coordinates:
  // If sosLocation was recorded at SOS trigger, ensure latitude and longitude are fully mapped
  if (tripData.sosLocation) {
    const sLat = tripData.sosLocation.lat ?? (tripData.sosLocation as any).latitude;
    const sLng = tripData.sosLocation.lng ?? (tripData.sosLocation as any).longitude;
    if (typeof sLat === 'number' && typeof sLng === 'number' && !isNaN(sLat) && !isNaN(sLng)) {
      tripData.latitude = tripData.latitude ?? sLat;
      tripData.longitude = tripData.longitude ?? sLng;
      if (!tripData.locationUrl) {
        tripData.locationUrl = `https://maps.google.com/?q=${sLat},${sLng}`;
      }
    }
  }

  console.log(`[SafeCheck Guardian Fetch] 📍 Resolved trip "${tripId}": status="${tripData.status}", coordinates=${tripData.latitude && tripData.longitude ? `${tripData.latitude.toFixed(5)}, ${tripData.longitude.toFixed(5)}` : 'None'}, hasSosLocation=${Boolean(tripData.sosLocation)}, hasAudioEvidence=${Boolean(tripData.audioEvidence)}`);

  return tripData;
}

/**
 * Subscribes to near-real-time updates (every 15s polling + Firestore live listener).
 * Actively listens to both the trips document AND the sos_audio_evidence collection
 * so that when audio finishes uploading in the background, Guardian View updates instantly.
 */
export function subscribeGuardianTrip(
  tripId: string,
  callback: (trip: Trip | null, lastSync: Date) => void
): () => void {
  let isSubscribed = true;
  let currentTrip: Trip | null = null;
  let currentAudioEvidence: any = null;

  const emitUpdatedTrip = () => {
    if (!isSubscribed || !currentTrip) return;
    const merged: Trip = { ...currentTrip };
    if (currentAudioEvidence) {
      merged.audioEvidence = currentAudioEvidence;
    }
    // Normalize coordinates from sosLocation if needed
    if (merged.sosLocation) {
      const sLat = merged.sosLocation.lat ?? (merged.sosLocation as any).latitude;
      const sLng = merged.sosLocation.lng ?? (merged.sosLocation as any).longitude;
      if (typeof sLat === 'number' && typeof sLng === 'number' && !isNaN(sLat) && !isNaN(sLng)) {
        merged.latitude = merged.latitude ?? sLat;
        merged.longitude = merged.longitude ?? sLng;
        if (!merged.locationUrl) {
          merged.locationUrl = `https://maps.google.com/?q=${sLat},${sLng}`;
        }
      }
    }
    console.log(`[SafeCheck Guardian Realtime] 🔄 Dispatched live update for trip "${tripId}": status="${merged.status}", hasAudioEvidence=${Boolean(merged.audioEvidence)}, hasGPS=${Boolean(merged.latitude && merged.longitude)}`);
    callback(merged, new Date());
  };

  // Immediate fetch
  fetchGuardianTrip(tripId).then((trip) => {
    if (isSubscribed && trip) {
      currentTrip = trip;
      if (trip.audioEvidence) currentAudioEvidence = trip.audioEvidence;
      emitUpdatedTrip();
    } else if (isSubscribed) {
      callback(null, new Date());
    }
  });

  // Polling every 15 seconds
  const intervalId = setInterval(async () => {
    const trip = await fetchGuardianTrip(tripId);
    if (isSubscribed && trip) {
      currentTrip = trip;
      if (trip.audioEvidence) currentAudioEvidence = trip.audioEvidence;
      emitUpdatedTrip();
    }
  }, 15000);

  // Real-time Firestore snapshot listener on the trip document
  let unsubFirestoreTrip = () => {};
  try {
    const docRef = doc(db, 'trips', tripId);
    unsubFirestoreTrip = onSnapshot(
      docRef,
      (snapshot) => {
        if (!isSubscribed) return;
        if (snapshot.exists()) {
          currentTrip = { id: snapshot.id, ...snapshot.data() } as Trip;
          emitUpdatedTrip();
        }
      },
      (err) => {
        console.warn('[SafeCheck Guardian] Firestore trip listener notice:', err);
      }
    );
  } catch (e) {}

  // Real-time Firestore snapshot listener on the sos_audio_evidence collection
  let unsubFirestoreAudio = () => {};
  try {
    const audioQuery = query(collection(db, 'sos_audio_evidence'), where('trip_id', '==', tripId));
    unsubFirestoreAudio = onSnapshot(
      audioQuery,
      (snapshot) => {
        if (!isSubscribed) return;
        if (!snapshot.empty) {
          const aDoc = snapshot.docs[0].data();
          console.log(`[SafeCheck Guardian Realtime] 🎵 Realtime audio evidence arrival for trip_id="${tripId}"! Audio ID: "${aDoc.audio_id}", Download URL: ${aDoc.download_url}`);
          currentAudioEvidence = {
            id: aDoc.audio_id,
            tripId: tripId,
            alertId: tripId,
            userId: aDoc.user_id,
            audioDataUrl: aDoc.download_url,
            download_url: aDoc.download_url,
            storage_path: aDoc.storage_path,
            recordedAt: aDoc.recorded_at,
            durationSeconds: aDoc.duration_seconds,
            mimeType: aDoc.mime_type,
          };
          emitUpdatedTrip();
        }
      },
      (err) => {
        console.warn('[SafeCheck Guardian] Firestore audio listener notice:', err);
      }
    );
  } catch (e) {}

  return () => {
    isSubscribed = false;
    clearInterval(intervalId);
    unsubFirestoreTrip();
    unsubFirestoreAudio();
  };
}

/**
 * Subscribes to the latest trip of a user (when opened via ?guardianUser=userId)
 */
export function subscribeGuardianUser(
  userId: string,
  callback: (trip: Trip | null, lastSync: Date) => void
): () => void {
  let isSubscribed = true;

  const fetchUserTrip = async () => {
    try {
      const res = await fetch(`/api/guardian/user/${encodeURIComponent(userId)}`);
      if (res.ok) {
        const data = await res.json();
        if (isSubscribed) {
          callback(data.trip || null, new Date());
          return;
        }
      }
    } catch (e) {}

    // Firestore fallback
    try {
      const q = query(collection(db, 'trips'), where('userId', '==', userId));
      const snap = await getDocs(q);
      const trips: Trip[] = [];
      snap.forEach((d) => trips.push({ id: d.id, ...d.data() } as Trip));
      trips.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
      if (isSubscribed) {
        callback(trips[0] || null, new Date());
      }
    } catch (e) {}
  };

  fetchUserTrip();
  const intervalId = setInterval(fetchUserTrip, 15000);

  return () => {
    isSubscribed = false;
    clearInterval(intervalId);
  };
}

/**
 * Computes a human-readable "Last Seen Safe" description and relative timestamp.
 */
export function computeLastSeenSafe(trip: Trip | null): {
  label: string;
  timeAgoText: string;
  statusType: 'safe' | 'active' | 'warning' | 'alert' | 'unknown';
  formattedTime: string;
} {
  if (!trip) {
    return {
      label: 'Status Unknown',
      timeAgoText: 'No active data',
      statusType: 'unknown',
      formattedTime: '',
    };
  }

  const now = Date.now();

  // Find latest safe event or start timestamp
  let latestSafeDate = new Date(trip.startTime);
  let referenceLabel = 'Trip Started';

  if (trip.checkInEvents && trip.checkInEvents.length > 0) {
    const safeEvents = trip.checkInEvents.filter(
      (e) => e.type === 'manual_check_in' || e.type === 'scheduled_check_in'
    );
    if (safeEvents.length > 0) {
      const last = safeEvents[safeEvents.length - 1];
      latestSafeDate = new Date(last.timestamp);
      referenceLabel = 'Confirmed Safe';
    }
  }

  if (trip.status === 'safe' && trip.safeAt) {
    latestSafeDate = new Date(trip.safeAt);
    referenceLabel = 'Arrived Safely';
  }

  const diffMs = Math.max(0, now - latestSafeDate.getTime());
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);

  let timeAgoText = '';
  if (diffMins < 1) {
    timeAgoText = 'Just now';
  } else if (diffMins < 60) {
    timeAgoText = `${diffMins} min${diffMins === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    timeAgoText = `${diffHours} hr${diffHours === 1 ? '' : 's'} ago`;
  } else {
    timeAgoText = `${Math.floor(diffHours / 24)} day(s) ago`;
  }

  const formattedTime = latestSafeDate.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  let statusType: 'safe' | 'active' | 'warning' | 'alert' = 'active';
  if (trip.status === 'alerted') {
    statusType = 'alert';
  } else if (trip.status === 'reminded') {
    statusType = 'warning';
  } else if (trip.status === 'safe') {
    statusType = 'safe';
  }

  return {
    label: referenceLabel,
    timeAgoText,
    statusType,
    formattedTime,
  };
}
