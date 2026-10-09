/**
 * SafeCheck Battery Service
 * Uses the browser's Battery Status API (navigator.getBattery()) to monitor
 * the device's battery level while a trip/check-in is active.
 *
 * When the battery level drops below 15% during an active trip, automatically
 * dispatches an email alert to all saved emergency contacts reusing the existing
 * emergency email alert system with the message:
 * "Purva's phone battery is low ([X]%) during an active trip. Last known location: [GPS link]."
 *
 * Strict single-dispatch per trip session guaranteed via trip ID session flags.
 * Fails gracefully if Battery Status API is unsupported in the current browser.
 */

import { Trip, UserProfile, EmergencyContact } from '../types';
import { getCurrentLocation } from './locationService';
import { getCachedContacts, getUserContacts } from './contactService';
import { isDeviceOnline } from './offlineSyncService';
import { updateDoc, doc } from 'firebase/firestore';
import { db } from './firebase';

export interface BatteryStatus {
  supported: boolean;
  level: number; // 0.0 to 1.0
  percentage: number; // 0 to 100
  charging: boolean;
}

/**
 * Checks if the Battery Status API is supported in the current environment
 */
export function isBatteryStatusSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof (navigator as any).getBattery === 'function'
  );
}

/**
 * Safely fetches the current battery status if supported.
 * Fails gracefully with console warning if unsupported.
 */
export async function getBatteryStatus(): Promise<BatteryStatus | null> {
  if (!isBatteryStatusSupported()) {
    console.warn(
      '[SafeCheck Battery] Battery Status API (navigator.getBattery) is not supported in this browser. Low battery monitoring is inactive.'
    );
    return null;
  }

  try {
    const battery = await (navigator as any).getBattery();
    const rawLevel = typeof battery?.level === 'number' ? battery.level : 1;
    const percentage = Math.round(rawLevel * 100);
    const charging = Boolean(battery?.charging);

    return {
      supported: true,
      level: rawLevel,
      percentage,
      charging,
    };
  } catch (err) {
    console.warn('[SafeCheck Battery] Notice reading Battery Status API:', err);
    return null;
  }
}

/**
 * Session storage key to guarantee only ONE alert is sent per active trip
 */
export function getTripBatteryAlertKey(tripId: string): string {
  return `safecheck_low_battery_alert_sent_${tripId}`;
}

/**
 * Checks if a low battery alert was already sent for this trip session
 */
export function hasLowBatteryAlertBeenSent(trip: Trip): boolean {
  if (!trip?.id) return false;
  if (trip.lowBatteryAlertSent) return true;
  if (typeof window !== 'undefined') {
    return localStorage.getItem(getTripBatteryAlertKey(trip.id)) === 'true';
  }
  return false;
}

/**
 * Marks low battery alert as sent for a trip session
 */
export function markLowBatteryAlertSent(tripId: string): void {
  if (!tripId || typeof window === 'undefined') return;
  try {
    localStorage.setItem(getTripBatteryAlertKey(tripId), 'true');
  } catch (e) {
    console.warn('[SafeCheck Battery] Could not set localStorage flag:', e);
  }
}

/**
 * Resets low battery alert tracking for a given trip ID
 */
export function resetTripBatteryAlert(tripId: string): void {
  if (!tripId || typeof window === 'undefined') return;
  try {
    localStorage.removeItem(getTripBatteryAlertKey(tripId));
  } catch {}
}

/**
 * Resolves user display name with fallback to "Purva"
 */
export function resolveAlertUserName(user?: UserProfile | null): string {
  if (user?.name && user.name.trim().length > 0 && user.name !== 'SafeCheck User') {
    return user.name.trim();
  }
  return 'Purva';
}

/**
 * Dispatches the Low Battery Auto-Alert to contacts reusing the existing
 * emergency email alert system (/api/sos/trigger & /api/trigger-sos)
 */
export async function sendLowBatteryAutoAlert(
  trip: Trip,
  user: UserProfile,
  batteryLevel: number,
  providedContacts?: EmergencyContact[]
): Promise<{ success: boolean; deliveredCount: number; message: string }> {
  const tripId = trip.id;

  // 1. Guard against duplicate alert within the same trip session
  if (hasLowBatteryAlertBeenSent(trip)) {
    console.log(`[SafeCheck Battery] Low battery alert already dispatched for trip session "${tripId}". Skipping duplicate.`);
    return {
      success: true,
      deliveredCount: 0,
      message: 'Alert already dispatched for current trip',
    };
  }

  // Immediately set session flag to prevent race conditions during async GPS/email ops
  markLowBatteryAlertSent(tripId);

  const batteryPct = Math.round(batteryLevel * 100);
  const userName = resolveAlertUserName(user);

  // 2. Resolve GPS coordinates
  let lat = trip.lastKnownLatitude ?? trip.startLatitude ?? trip.latitude ?? null;
  let lng = trip.lastKnownLongitude ?? trip.startLongitude ?? trip.longitude ?? null;
  let locationUrl = trip.locationUrl || trip.startLocationUrl || null;

  try {
    const freshCoords = await Promise.race([
      getCurrentLocation(),
      new Promise<{ latitude: number; longitude: number } | null>((res) =>
        setTimeout(() => res(null), 3000)
      ),
    ]);
    if (
      freshCoords &&
      typeof freshCoords.latitude === 'number' &&
      typeof freshCoords.longitude === 'number'
    ) {
      lat = freshCoords.latitude;
      lng = freshCoords.longitude;
      locationUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    }
  } catch (locErr) {
    console.warn('[SafeCheck Battery] Notice fetching current location for battery alert:', locErr);
  }

  const gpsLink =
    locationUrl ||
    (lat != null && lng != null
      ? `https://www.google.com/maps?q=${lat},${lng}`
      : 'https://maps.google.com');

  // Exact required message format:
  // "Purva's phone battery is low ([X]%) during an active trip. Last known location: [GPS link]."
  const alertMessage = `${userName}'s phone battery is low (${batteryPct}%) during an active trip. Last known location: ${gpsLink}.`;
  const customSubject = `🔋 Low Battery Alert: ${userName}'s phone battery is low (${batteryPct}%) during an active trip`;

  // 3. Resolve emergency contacts
  let contactsList: EmergencyContact[] =
    providedContacts && providedContacts.length > 0
      ? providedContacts
      : getCachedContacts(user.uid);

  if (contactsList.length === 0) {
    try {
      contactsList = await getUserContacts(user.uid);
    } catch (cErr) {
      console.warn('[SafeCheck Battery] Notice fetching contacts:', cErr);
    }
  }

  console.log(
    `[SafeCheck Battery] 🔋 Dispatching Low Battery Auto-Alert (${batteryPct}%) for trip "${trip.destination}" to ${contactsList.length} contact(s)...`
  );

  const payload = {
    userId: user.uid,
    userName,
    userEmail: user.email,
    activeTripId: trip.id,
    destination: trip.destination,
    latitude: lat,
    longitude: lng,
    locationUrl: gpsLink,
    customSubject,
    customMessage: alertMessage,
    type: 'low_battery',
    batteryLevel,
    batteryPct,
    contacts: contactsList,
  };

  let deliveredCount = 0;

  // 4. Send via existing emergency email alert system
  if (isDeviceOnline()) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 20000);
      let response: Response | null = null;
      try {
        response = await fetch('/api/sos/trigger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (err1) {
        console.warn(
          '[SafeCheck Battery] Primary /api/sos/trigger failed, trying fallback /api/trigger-sos:',
          err1
        );
        try {
          response = await fetch('/api/trigger-sos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } catch (err2) {
          console.error('[SafeCheck Battery] Fallback /api/trigger-sos failed:', err2);
        }
      } finally {
        clearTimeout(tid);
      }

      if (response && response.ok) {
        const data = await response.json();
        deliveredCount =
          data.emailDispatch?.deliveredCount ?? data.deliveredCount ?? 0;
        console.log(
          `[SafeCheck Battery] Low battery email alert successfully sent. Delivered: ${deliveredCount}`,
          data
        );
      }
    } catch (dispatchErr) {
      console.error('[SafeCheck Battery] Low battery email dispatch failed:', dispatchErr);
    }
  } else {
    console.warn('[SafeCheck Battery] Device offline; low battery alert recorded locally.');
  }

  // 5. Update local trip and Firestore trip document
  try {
    const nowIso = new Date().toISOString();

    // Update active trip in local storage
    if (typeof window !== 'undefined') {
      const cachedActiveRaw = localStorage.getItem(`safecheck_active_trip_${user.uid}`);
      if (cachedActiveRaw) {
        try {
          const parsed = JSON.parse(cachedActiveRaw);
          if (parsed.id === trip.id) {
            localStorage.setItem(
              `safecheck_active_trip_${user.uid}`,
              JSON.stringify({
                ...parsed,
                lowBatteryAlertSent: true,
                lowBatteryAlertSentAt: nowIso,
                lowBatteryLevel: batteryPct,
              })
            );
          }
        } catch {}
      }
    }

    // Update Firestore trip doc if online
    if (isDeviceOnline() && !trip.id.startsWith('trip_offline_') && !trip.id.startsWith('trip_local_')) {
      const tripDocRef = doc(db, 'trips', trip.id);
      await updateDoc(tripDocRef, {
        lowBatteryAlertSent: true,
        lowBatteryAlertSentAt: nowIso,
        lowBatteryLevel: batteryPct,
      }).catch((e) => console.warn('[SafeCheck Battery] Notice updating Firestore trip:', e));
    }
  } catch (updateErr) {
    console.warn('[SafeCheck Battery] Error updating trip document with lowBatteryAlertSent:', updateErr);
  }

  return {
    success: true,
    deliveredCount,
    message: alertMessage,
  };
}
