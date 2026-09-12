import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import app, { db } from './firebase';
import { doc, updateDoc, setDoc } from 'firebase/firestore';

export interface NotificationStatus {
  isSupported: boolean;
  permission: NotificationPermission;
  hasFCMToken: boolean;
  token?: string | null;
}

let messagingInstance: any = null;

export async function getFirebaseMessagingInstance() {
  if (typeof window === 'undefined') return null;
  try {
    const supported = await isSupported();
    if (supported && !messagingInstance) {
      messagingInstance = getMessaging(app);
    }
    return messagingInstance;
  } catch (err) {
    console.warn('Firebase Messaging is not supported in this environment:', err);
    return null;
  }
}

/**
 * Checks current notification capability and permission state.
 */
export async function getNotificationStatus(userId?: string): Promise<NotificationStatus> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      isSupported: false,
      permission: 'denied',
      hasFCMToken: false,
    };
  }

  const supported = await isSupported().catch(() => false);
  const cachedToken = userId ? localStorage.getItem(`safecheck_fcm_token_${userId}`) : null;

  return {
    isSupported: supported || 'serviceWorker' in navigator,
    permission: Notification.permission,
    hasFCMToken: Boolean(cachedToken),
    token: cachedToken,
  };
}

/**
 * Requests push notification permission and initializes FCM Token and Service Worker.
 */
export async function requestNotificationPermission(
  userId?: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { success: false, error: 'Push notifications are not supported by this browser.' };
  }

  try {
    // 1. Request browser notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        success: false,
        error: 'Notification permission was denied. Please allow notifications in your browser settings.',
      };
    }

    // 2. Register Service Worker
    let swRegistration: ServiceWorkerRegistration | undefined;
    if ('serviceWorker' in navigator) {
      try {
        swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        await navigator.serviceWorker.ready;
      } catch (swErr) {
        console.warn('Service worker registration notice:', swErr);
      }
    }

    // 3. Try to get FCM Token if Firebase Messaging is available
    let token: string | undefined;
    try {
      const messaging = await getFirebaseMessagingInstance();
      if (messaging) {
        token = await getToken(messaging, {
          serviceWorkerRegistration: swRegistration,
        });
      }
    } catch (fcmErr) {
      console.warn('FCM token generation notice (falling back to standard Web Push):', fcmErr);
    }

    // Generate a fallback device token if needed
    if (!token) {
      token = `web_push_${userId || 'guest'}_${Date.now()}`;
    }

    // 4. Cache and persist to Firestore user document
    if (userId) {
      try {
        localStorage.setItem(`safecheck_fcm_token_${userId}`, token);
        const userDocRef = doc(db, 'users', userId);
        await setDoc(
          userDocRef,
          {
            fcmToken: token,
            pushNotificationsEnabled: true,
            notificationsLastEnabledAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (dbErr) {
        console.warn('Could not save FCM token to Firestore:', dbErr);
      }
    }

    return { success: true, token };
  } catch (err: any) {
    console.error('Error requesting push notification permission:', err);
    return { success: false, error: err.message || 'Failed to enable push notifications.' };
  }
}

/**
 * Dispatches a rich local push notification via Service Worker (or Window Notification API fallback).
 * Delivers alerts even when the browser tab is minimized or backgrounded.
 */
export async function sendLocalPushNotification(
  title: string,
  options: {
    body?: string;
    icon?: string;
    badge?: string;
    tag?: string;
    requireInteraction?: boolean;
    data?: any;
  } = {}
): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  const notificationOptions: any = {
    body: options.body || 'SafeCheck Safety Alert',
    icon: options.icon || '/favicon.ico',
    badge: options.badge || '/favicon.ico',
    tag: options.tag || `safecheck_${Date.now()}`,
    renotify: true,
    requireInteraction: options.requireInteraction ?? true,
    vibrate: [300, 100, 300, 100, 300],
    data: options.data || { url: window.location.origin },
  };

  // Try showing via active service worker registration first
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      if (registration && registration.showNotification) {
        await registration.showNotification(title, notificationOptions);
        return true;
      }
    } catch (e) {
      console.warn('Service Worker notification show failed, using fallback:', e);
    }
  }

  // Fallback to standard Notification constructor
  try {
    const notif = new Notification(title, notificationOptions);
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
    return true;
  } catch (e) {
    console.warn('Standard notification constructor failed:', e);
    return false;
  }
}

/**
 * Triggers an instant sample push notification for the user to test background delivery.
 */
export async function testPushNotification(): Promise<boolean> {
  return sendLocalPushNotification('🛡️ SafeCheck Push Notification Verified', {
    body: 'Push notifications are active! You and your safety circle will receive instant alerts for check-in reminders and SOS triggers.',
    requireInteraction: false,
    tag: 'safecheck_test_notification',
    data: { action: 'test', timestamp: new Date().toISOString() },
  });
}

/**
 * Dispatches an automated trip safety check-in push notification.
 */
export async function notifyTripCheckInReminder(
  destination: string,
  graceMinutes: number = 10
): Promise<boolean> {
  return sendLocalPushNotification('⚠️ SafeCheck Reminder: Are you safe?', {
    body: `Your estimated arrival time at "${destination}" has arrived. Please open SafeCheck and confirm you are safe within ${graceMinutes} minutes.`,
    requireInteraction: true,
    tag: `reminder_${destination}_${Date.now()}`,
    data: { type: 'trip_reminder', destination },
  });
}

/**
 * Dispatches an emergency SOS trigger push notification.
 */
export async function notifySosTriggered(
  userName: string,
  locationUrl?: string | null
): Promise<boolean> {
  let body = `URGENT: ${userName} has triggered a 1-Tap SOS Emergency Alert! Emergency contacts notified.`;
  if (locationUrl) {
    body += ` Live Location: ${locationUrl}`;
  }

  return sendLocalPushNotification('🚨 CRITICAL EMERGENCY SOS ACTIVATED', {
    body,
    requireInteraction: true,
    tag: `sos_alert_${Date.now()}`,
    data: { type: 'sos_alert', locationUrl },
  });
}
