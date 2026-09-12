import { Trip, LocationTrailPoint, LateTripResponse, EmergencyContact } from '../types';
import { db } from './firebase';
import {
  doc,
  setDoc,
  updateDoc,
  arrayUnion,
  increment,
} from 'firebase/firestore';

const OFFLINE_QUEUE_STORAGE_KEY = 'safecheck_offline_sync_queue';
const OFFLINE_LAST_SYNC_KEY = 'safecheck_last_offline_sync';

export interface OfflineQueueItem {
  id: string;
  type: 'create_trip' | 'trail_point' | 'late_response' | 'trip_status' | 'check_in_event';
  timestamp: string;
  userId: string;
  tripId: string;
  payload: any;
}

/**
 * Returns whether browser currently has internet connectivity
 */
export function isDeviceOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/**
 * Subscribes to real-time online/offline connection events
 */
export function subscribeOnlineStatus(onChange: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleOnline = () => onChange(true);
  const handleOffline = () => onChange(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Initial notify
  onChange(navigator.onLine);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

/**
 * Retrieves the pending offline sync queue
 */
export function getOfflineQueue(): OfflineQueueItem[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as OfflineQueueItem[];
    }
  } catch (e) {
    console.error('Error reading offline queue:', e);
  }
  return [];
}

/**
 * Saves items to the offline sync queue
 */
export function setOfflineQueue(items: OfflineQueueItem[]): void {
  try {
    localStorage.setItem(OFFLINE_QUEUE_STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('Error writing offline queue:', e);
  }
}

/**
 * Appends an action to the offline sync queue
 */
export function enqueueOfflineAction(action: Omit<OfflineQueueItem, 'id' | 'timestamp'>): void {
  const item: OfflineQueueItem = {
    ...action,
    id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
  };

  const current = getOfflineQueue();
  current.push(item);
  setOfflineQueue(current);
}

/**
 * Syncs all pending offline actions to Firestore and the server backend when connection returns
 */
export async function syncOfflineTripData(userId: string): Promise<{ syncedCount: number; errorCount: number }> {
  if (!isDeviceOnline() || !userId) {
    return { syncedCount: 0, errorCount: 0 };
  }

  const queue = getOfflineQueue();
  if (queue.length === 0) {
    return { syncedCount: 0, errorCount: 0 };
  }

  const userItems = queue.filter((item) => item.userId === userId || !item.userId);
  const remainingItems: OfflineQueueItem[] = queue.filter((item) => item.userId && item.userId !== userId);

  let syncedCount = 0;
  let errorCount = 0;
  const failedItems: OfflineQueueItem[] = [];

  for (const item of userItems) {
    try {
      if (item.type === 'create_trip') {
        const tripData = item.payload as Trip;
        try {
          await setDoc(doc(db, 'trips', tripData.id), tripData, { merge: true });
        } catch {}
        try {
          await fetch('/api/trips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tripData),
          });
        } catch {}
        syncedCount++;
      } else if (item.type === 'trail_point') {
        const point = item.payload as LocationTrailPoint;
        if (!item.tripId.startsWith('offline_')) {
          try {
            await updateDoc(doc(db, 'trips', item.tripId), {
              locationTrail: arrayUnion(point),
              lastKnownLatitude: point.latitude,
              lastKnownLongitude: point.longitude,
              lastKnownAddress: point.address || null,
              lastLocationUpdate: point.timestamp,
              latitude: point.latitude,
              longitude: point.longitude,
              locationUrl: point.locationUrl || null,
            });
          } catch {}
          try {
            await fetch(`/api/trips/${item.tripId}/trail`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ point }),
            });
          } catch {}
        }
        syncedCount++;
      } else if (item.type === 'late_response') {
        const resp = item.payload as LateTripResponse;
        if (!item.tripId.startsWith('offline_')) {
          try {
            const updates: any = { lateResponses: arrayUnion(resp) };
            if (resp.extendedMinutes && resp.extendedMinutes > 0) {
              updates.durationMinutes = increment(resp.extendedMinutes);
            }
            await updateDoc(doc(db, 'trips', item.tripId), updates);
          } catch {}
        }
        syncedCount++;
      } else if (item.type === 'trip_status') {
        const { status, timestamp } = item.payload;
        if (!item.tripId.startsWith('offline_')) {
          try {
            const updates: any = { status };
            if (status === 'safe') updates.safeAt = timestamp;
            if (status === 'cancelled') updates.cancelledAt = timestamp;
            if (status === 'alerted') updates.alertedAt = timestamp;
            await updateDoc(doc(db, 'trips', item.tripId), updates);
          } catch {}
          try {
            if (status === 'safe') {
              await fetch(`/api/trips/${item.tripId}/safe`, { method: 'POST' });
            } else if (status === 'cancelled') {
              await fetch(`/api/trips/${item.tripId}/cancel`, { method: 'POST' });
            }
          } catch {}
        }
        syncedCount++;
      } else if (item.type === 'check_in_event') {
        const event = item.payload;
        if (!item.tripId.startsWith('offline_')) {
          try {
            await updateDoc(doc(db, 'trips', item.tripId), {
              checkInEvents: arrayUnion(event),
            });
          } catch {}
        }
        syncedCount++;
      }
    } catch (err) {
      console.warn('Error syncing offline queue item:', item, err);
      errorCount++;
      failedItems.push(item);
    }
  }

  // Update offline queue with failed items and remaining items
  setOfflineQueue([...remainingItems, ...failedItems]);
  localStorage.setItem(OFFLINE_LAST_SYNC_KEY, new Date().toISOString());

  return { syncedCount, errorCount };
}

/**
 * Builds pre-filled SMS URL for native messaging apps.
 * Works without mobile internet or WiFi via cellular network!
 */
export function buildEmergencySmsUrl(phone: string | undefined, message: string): string {
  const cleanPhone = phone ? phone.replace(/[^\d+]/g, '') : '';
  const isIos =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent || '');

  const separator = isIos ? '&' : '?';
  if (cleanPhone) {
    return `sms:${cleanPhone}${separator}body=${encodeURIComponent(message)}`;
  }
  return `sms:${separator}body=${encodeURIComponent(message)}`;
}

/**
 * Generates clear, urgent emergency SMS text with coordinates and timestamp
 */
export function buildEmergencySmsMessage(params: {
  userName: string;
  destination: string;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  timeStr?: string;
  isOverdue?: boolean;
}): string {
  const { userName, destination, lat, lng, address, timeStr, isOverdue } = params;
  const nowTime = timeStr || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const hasCoords = typeof lat === 'number' && typeof lng === 'number';
  const mapsLink = hasCoords ? `https://maps.google.com/?q=${lat.toFixed(5)},${lng.toFixed(5)}` : '';

  if (isOverdue) {
    let msg = `🚨 EMERGENCY ALERT from SafeCheck: ${userName || 'User'} has NOT checked in safely for trip to "${destination}".`;
    if (hasCoords) {
      msg += `\n\n📍 Last GPS Location: ${lat?.toFixed(5)}, ${lng?.toFixed(5)}`;
      if (address) msg += ` (${address})`;
      msg += `\n🗺️ Map: ${mapsLink}`;
    }
    msg += `\n⏰ Time: ${nowTime}. Please call or check on them immediately!`;
    return msg;
  }

  let msg = `🚨 EMERGENCY SOS from SafeCheck: ${userName || 'User'} triggered an emergency safety alert during trip to "${destination}".`;
  if (hasCoords) {
    msg += `\n\n📍 GPS Location: ${lat?.toFixed(5)}, ${lng?.toFixed(5)}`;
    if (address) msg += ` (${address})`;
    msg += `\n🗺️ Map: ${mapsLink}`;
  }
  msg += `\n⏰ Time: ${nowTime}. Please reach out immediately!`;
  return msg;
}

/**
 * Triggers the device's native SMS application with pre-filled emergency coordinates
 */
export function triggerNativeSms(phone: string | undefined, message: string): boolean {
  try {
    const url = buildEmergencySmsUrl(phone, message);
    if (typeof window !== 'undefined') {
      window.location.href = url;
      return true;
    }
  } catch (e) {
    console.error('Failed to trigger native SMS:', e);
  }
  return false;
}
