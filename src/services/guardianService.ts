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
 */
export async function fetchGuardianTrip(tripId: string): Promise<Trip | null> {
  // 1. Try server API
  try {
    const res = await fetch(`/api/guardian/${encodeURIComponent(tripId)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.trip) {
        return data.trip as Trip;
      }
    }
  } catch (e) {}

  // 2. Try Firestore trips collection
  try {
    const docRef = doc(db, 'trips', tripId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const tripData = { id: docSnap.id, ...docSnap.data() } as Trip;
      if (!tripData.audioEvidence) {
        try {
          const audioQ = query(collection(db, 'sos_audio_evidence'), where('trip_id', '==', tripId));
          const audioSnap = await getDocs(audioQ);
          if (!audioSnap.empty) {
            const aDoc = audioSnap.docs[0].data();
            tripData.audioEvidence = {
              id: aDoc.audio_id,
              tripId,
              alertId: tripId,
              userId: aDoc.user_id,
              audioDataUrl: aDoc.download_url,
              download_url: aDoc.download_url,
              storage_path: aDoc.storage_path,
              recordedAt: aDoc.recorded_at,
              durationSeconds: aDoc.duration_seconds,
              mimeType: aDoc.mime_type,
            };
          }
        } catch (aErr) {}
      }
      return tripData;
    }
  } catch (e) {}

  // 3. Fallback to localStorage
  if (typeof localStorage !== 'undefined') {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('safecheck_trips_') || key.startsWith('safecheck_active_trip_'))) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const match = parsed.find((t: Trip) => t.id === tripId);
              if (match) return match;
            } else if (parsed && parsed.id === tripId) {
              return parsed;
            }
          }
        }
      }
    } catch (e) {}
  }

  return null;
}

/**
 * Subscribes to near-real-time updates (every 15s polling + Firestore live listener).
 */
export function subscribeGuardianTrip(
  tripId: string,
  callback: (trip: Trip | null, lastSync: Date) => void
): () => void {
  let isSubscribed = true;

  // Immediate fetch
  fetchGuardianTrip(tripId).then((trip) => {
    if (isSubscribed) callback(trip, new Date());
  });

  // Polling every 15 seconds
  const intervalId = setInterval(async () => {
    const trip = await fetchGuardianTrip(tripId);
    if (isSubscribed) {
      callback(trip, new Date());
    }
  }, 15000);

  // Real-time Firestore snapshot listener
  let unsubFirestore = () => {};
  try {
    const docRef = doc(db, 'trips', tripId);
    unsubFirestore = onSnapshot(
      docRef,
      (snapshot) => {
        if (!isSubscribed) return;
        if (snapshot.exists()) {
          const trip = { id: snapshot.id, ...snapshot.data() } as Trip;
          callback(trip, new Date());
        }
      },
      (err) => {
        console.warn('Guardian Firestore listener notice:', err);
      }
    );
  } catch (e) {}

  return () => {
    isSubscribed = false;
    clearInterval(intervalId);
    unsubFirestore();
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
