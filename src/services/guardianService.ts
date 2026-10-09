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

  // 2. Try Firestore trips collection if not found or if audio status is pending/missing
  if (!tripData || (!tripData.audioEvidence && tripData.audioStatus !== 'ready')) {
    try {
      const docRef = doc(db, 'trips', tripId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const fsTrip = { id: docSnap.id, ...docSnap.data() } as Trip;
        if (!tripData) {
          tripData = fsTrip;
          console.log(`[SafeCheck Guardian Fetch] ✅ Retrieved trip from Firestore 'trips' collection for "${tripId}": status="${tripData.status}"`);
        } else {
          // Enrich with audio evidence from trips document if available
          if (fsTrip.audioEvidence && !tripData.audioEvidence) {
            tripData.audioEvidence = fsTrip.audioEvidence;
          }
          if (fsTrip.audioEvidenceUrl && !tripData.audioEvidenceUrl) {
            tripData.audioEvidenceUrl = fsTrip.audioEvidenceUrl;
          }
          if (fsTrip.audioStatus && fsTrip.audioStatus !== 'recording' && tripData.audioStatus !== 'ready') {
            tripData.audioStatus = fsTrip.audioStatus;
          }
        }
      } else {
        // Query by sosId or sos_id in case document was stored under original trip id
        const sosQ = query(collection(db, 'trips'), where('sosId', '==', tripId));
        const sosSnap = await getDocs(sosQ);
        if (!sosSnap.empty) {
          const match = sosSnap.docs[0];
          const fsTrip = { id: match.id, ...match.data() } as Trip;
          if (!tripData) {
            tripData = fsTrip;
            console.log(`[SafeCheck Guardian Fetch] ✅ Retrieved trip by sosId in Firestore for "${tripId}": status="${tripData.status}"`);
          } else {
            if (fsTrip.audioEvidence && !tripData.audioEvidence) tripData.audioEvidence = fsTrip.audioEvidence;
            if (fsTrip.audioEvidenceUrl && !tripData.audioEvidenceUrl) tripData.audioEvidenceUrl = fsTrip.audioEvidenceUrl;
            if (fsTrip.audioStatus && tripData.audioStatus !== 'ready') tripData.audioStatus = fsTrip.audioStatus;
          }
        } else {
          const sosQ2 = query(collection(db, 'trips'), where('sos_id', '==', tripId));
          const sosSnap2 = await getDocs(sosQ2);
          if (!sosSnap2.empty) {
            const match2 = sosSnap2.docs[0];
            const fsTrip2 = { id: match2.id, ...match2.data() } as Trip;
            if (!tripData) {
              tripData = fsTrip2;
              console.log(`[SafeCheck Guardian Fetch] ✅ Retrieved trip by sos_id in Firestore for "${tripId}": status="${tripData.status}"`);
            } else {
              if (fsTrip2.audioEvidence && !tripData.audioEvidence) tripData.audioEvidence = fsTrip2.audioEvidence;
              if (fsTrip2.audioEvidenceUrl && !tripData.audioEvidenceUrl) tripData.audioEvidenceUrl = fsTrip2.audioEvidenceUrl;
              if (fsTrip2.audioStatus && tripData.audioStatus !== 'ready') tripData.audioStatus = fsTrip2.audioStatus;
            }
          }
        }
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

  // 4. If tripData has audioEvidenceUrl but no audioEvidence object, reconstruct it
  if (tripData && !tripData.audioEvidence && tripData.audioEvidenceUrl) {
    tripData.audioEvidence = {
      id: `audio_${tripId}`,
      tripId: tripId,
      alertId: tripId,
      userId: tripData.userId || 'traveler',
      audioDataUrl: tripData.audioEvidenceUrl,
      download_url: tripData.audioEvidenceUrl,
      storage_path: `/sos_audio/${tripId}.webm`,
      recordedAt: tripData.audioCapturedAt || tripData.alertedAt || tripData.startTime || new Date().toISOString(),
      durationSeconds: tripData.audioDurationSec || 30,
      mimeType: 'audio/webm',
      syncedAt: tripData.audioStatusUpdatedAt || tripData.syncedAt || new Date().toISOString(),
    };
    tripData.audioStatus = 'ready';
    tripData.audioError = null;
  }

  // 4b. Status consistency and audio evidence mapping
  if (tripData.audioEvidence) {
    tripData.audioStatus = 'ready';
    tripData.audioError = null;
    if (!tripData.syncedAt) {
      tripData.syncedAt = tripData.audioEvidence.syncedAt || tripData.audioEvidence.recordedAt || new Date().toISOString();
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
    if (merged.audioEvidence) {
      merged.audioStatus = 'ready';
      merged.audioError = null;
      if (!merged.syncedAt) {
        merged.syncedAt = merged.audioEvidence.syncedAt || merged.audioEvidence.recordedAt || new Date().toISOString();
      }
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

  // Polling every 4 seconds during active monitoring so audio evidence updates promptly
  const intervalId = setInterval(async () => {
    const trip = await fetchGuardianTrip(tripId);
    if (isSubscribed && trip) {
      currentTrip = trip;
      if (trip.audioEvidence) currentAudioEvidence = trip.audioEvidence;
      emitUpdatedTrip();
    }
  }, 4000);

  // Real-time Firestore snapshot listener on the trip document
  let unsubFirestoreTrip = () => {};
  let unsubFirestoreQuery = () => {};
  try {
    const docRef = doc(db, 'trips', tripId);
    unsubFirestoreTrip = onSnapshot(
      docRef,
      (snapshot) => {
        if (!isSubscribed) return;
        if (snapshot.exists()) {
          const fresh = { id: snapshot.id, ...snapshot.data() } as Trip;
          currentTrip = fresh;
          if (fresh.audioEvidence && (fresh.audioEvidence.audioDataUrl || fresh.audioEvidence.download_url)) {
            currentAudioEvidence = fresh.audioEvidence;
          } else if (fresh.audioUrl || fresh.audioEvidenceUrl) {
            const audioUrl = fresh.audioUrl || fresh.audioEvidenceUrl;
            currentAudioEvidence = {
              id: `audio_${fresh.id}`,
              tripId: fresh.id,
              alertId: fresh.id,
              userId: fresh.userId || 'traveler',
              audioDataUrl: audioUrl,
              download_url: audioUrl,
              storage_path: `/sos-audio/${fresh.id}.${fresh.audioExtension || 'webm'}`,
              recordedAt: fresh.audioCapturedAt || fresh.alertedAt || fresh.startTime || new Date().toISOString(),
              durationSeconds: fresh.audioDurationSec || 30,
              mimeType: fresh.audioMimeType || 'audio/webm',
              syncedAt: fresh.audioStatusUpdatedAt || fresh.syncedAt || new Date().toISOString(),
            };
          }
          emitUpdatedTrip();
        } else if (!currentTrip) {
          // If direct document was not found, also listen by sosId query
          try {
            const qSos = query(collection(db, 'trips'), where('sosId', '==', tripId));
            unsubFirestoreQuery = onSnapshot(qSos, (qSnap) => {
              if (!isSubscribed) return;
              if (!qSnap.empty) {
                const freshDoc = qSnap.docs[0];
                const fresh = { id: freshDoc.id, ...freshDoc.data() } as Trip;
                currentTrip = fresh;
                if (fresh.audioEvidence && (fresh.audioEvidence.audioDataUrl || fresh.audioEvidence.download_url)) {
                  currentAudioEvidence = fresh.audioEvidence;
                } else if (fresh.audioUrl || fresh.audioEvidenceUrl) {
                  const audioUrl = fresh.audioUrl || fresh.audioEvidenceUrl;
                  currentAudioEvidence = {
                    id: `audio_${fresh.id}`,
                    tripId: fresh.id,
                    alertId: fresh.id,
                    userId: fresh.userId || 'traveler',
                    audioDataUrl: audioUrl,
                    download_url: audioUrl,
                    storage_path: `/sos-audio/${fresh.id}.${fresh.audioExtension || 'webm'}`,
                    recordedAt: fresh.audioCapturedAt || fresh.alertedAt || fresh.startTime || new Date().toISOString(),
                    durationSeconds: fresh.audioDurationSec || 30,
                    mimeType: fresh.audioMimeType || 'audio/webm',
                    syncedAt: fresh.audioStatusUpdatedAt || fresh.syncedAt || new Date().toISOString(),
                  };
                }
                emitUpdatedTrip();
              }
            });
          } catch {}
        }
      },
      (err) => {
        console.warn('[SafeCheck Guardian] Firestore trip listener notice:', err);
      }
    );
  } catch (e) {}

  return () => {
    isSubscribed = false;
    clearInterval(intervalId);
    unsubFirestoreTrip();
    unsubFirestoreQuery();
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

  if ((trip.status === 'safe' || trip.status === 'resolved') && (trip.safeAt || trip.resolvedAt)) {
    latestSafeDate = new Date(trip.resolvedAt || trip.safeAt!);
    referenceLabel = 'Resolved ✅';
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
  if (trip.status === 'alerted' || trip.status === 'sos') {
    statusType = 'alert';
  } else if (trip.status === 'reminded') {
    statusType = 'warning';
  } else if (trip.status === 'safe' || trip.status === 'resolved') {
    statusType = 'safe';
  }

  return {
    label: referenceLabel,
    timeAgoText,
    statusType,
    formattedTime,
  };
}
