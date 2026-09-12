/**
 * Fall / Impact Detection Service using DeviceMotionEvent API
 * Detects sudden, sharp acceleration spikes consistent with falls, vehicle impacts, or violent drops.
 * Includes explicit iOS Safari Permission handling via DeviceMotionEvent.requestPermission().
 */

export interface FallDetectionOptions {
  sensitivity?: 'low' | 'medium' | 'high';
  onFallDetected: (magnitude: number, timestamp: string) => void;
  onMotionUpdate?: (currentMagnitude: number) => void;
  onError?: (error: string) => void;
}

let motionListener: ((e: DeviceMotionEvent) => void) | null = null;
let lastTriggerTime = 0;
const COOLDOWN_MS = 6000; // 6s cooldown between triggers

export function isMobileDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera || '';
  const isTouchScreen = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
  const isMobileUA = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i.test(userAgent);
  return isMobileUA || (isTouchScreen && window.innerWidth <= 1024);
}

export function isDeviceMotionSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
}

export function getDeviceMotionStatus(): {
  supported: boolean;
  isMobile: boolean;
  statusText: string;
} {
  const isMobile = isMobileDevice();
  const supported = isDeviceMotionSupported();

  if (!isMobile) {
    return {
      supported: false,
      isMobile: false,
      statusText: 'Desktop detected: Physical accelerometer is not available. Use the simulation button below to test.',
    };
  }

  if (!supported) {
    return {
      supported: false,
      isMobile: true,
      statusText: 'Device motion sensor API is not supported on this mobile browser.',
    };
  }

  if (needsIOSMotionPermission()) {
    return {
      supported: true,
      isMobile: true,
      statusText: 'iOS device detected: Motion permission required from user tap.',
    };
  }

  return {
    supported: true,
    isMobile: true,
    statusText: 'Accelerometer sensor is active and ready on this device.',
  };
}

export function needsIOSMotionPermission(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    typeof (window as any).DeviceMotionEvent !== 'undefined' &&
    typeof (window as any).DeviceMotionEvent.requestPermission === 'function'
  );
}

/**
 * Explicitly requests Device Motion permission for iOS Safari.
 * NOTE: Must be invoked directly from a user tap/click gesture!
 */
export async function requestIOSMotionPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!needsIOSMotionPermission()) {
    return isDeviceMotionSupported() ? 'granted' : 'unsupported';
  }

  try {
    const permissionState = await (window as any).DeviceMotionEvent.requestPermission();
    return permissionState === 'granted' ? 'granted' : 'denied';
  } catch (err) {
    console.warn('iOS DeviceMotionEvent permission request failed:', err);
    return 'denied';
  }
}

export async function requestMotionPermissionIOS(): Promise<boolean> {
  const result = await requestIOSMotionPermission();
  return result === 'granted';
}

/**
 * Determines threshold based on sensitivity setting.
 * Acceleration in m/s^2 (Standard gravity ~9.8 m/s^2)
 */
function getThresholdForSensitivity(sensitivity: 'low' | 'medium' | 'high' = 'medium'): number {
  switch (sensitivity) {
    case 'high':
      return 22; // ~2.2g
    case 'low':
      return 36; // ~3.6g
    case 'medium':
    default:
      return 28; // ~2.8g
  }
}

/**
 * Starts listening to accelerometer motion spikes.
 */
export function startFallDetection(options: FallDetectionOptions): () => void {
  stopFallDetection();

  if (!isDeviceMotionSupported()) {
    if (options.onError) {
      options.onError('Device motion sensor is not supported on this device/browser.');
    }
    return () => {};
  }

  const threshold = getThresholdForSensitivity(options.sensitivity);

  motionListener = (event: DeviceMotionEvent) => {
    // Prefer pure acceleration (without gravity), fallback to accelerationIncludingGravity
    const acc = event.acceleration || event.accelerationIncludingGravity;
    if (!acc) return;

    const x = acc.x || 0;
    const y = acc.y || 0;
    const z = acc.z || 0;

    // Calculate total 3D acceleration vector magnitude
    const magnitude = Math.sqrt(x * x + y * y + z * z);

    if (options.onMotionUpdate) {
      options.onMotionUpdate(Math.round(magnitude * 10) / 10);
    }

    const now = Date.now();
    if (magnitude >= threshold && now - lastTriggerTime > COOLDOWN_MS) {
      lastTriggerTime = now;
      options.onFallDetected(magnitude, new Date().toISOString());
    }
  };

  try {
    window.addEventListener('devicemotion', motionListener, true);
  } catch (err: any) {
    if (options.onError) options.onError(err.message || 'Failed to bind motion listener');
  }

  return () => {
    stopFallDetection();
  };
}

export function stopFallDetection(): void {
  if (motionListener && typeof window !== 'undefined') {
    window.removeEventListener('devicemotion', motionListener, true);
    motionListener = null;
  }
}
