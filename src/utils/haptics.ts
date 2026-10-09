/**
 * SafeCheck Haptic Feedback Engine
 * Triggers navigator.vibrate() vibration patterns for critical actions like
 * 'Start Check-In' or 'Emergency SOS'.
 */
export function triggerHapticFeedback(pattern: 'start-checkin' | 'emergency-sos' | 'success' | 'warning' | number | number[]): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !('vibrate' in navigator)) {
    return;
  }
  try {
    let vibPattern: number | number[];
    if (pattern === 'start-checkin') {
      // Distinct double pulse acknowledging trip timer has started safely
      vibPattern = [80, 50, 120];
    } else if (pattern === 'emergency-sos') {
      // Urgent, unmistakable SOS pattern (··· ——— ···)
      vibPattern = [150, 80, 150, 80, 150, 150, 350, 100, 350, 100, 350, 150, 150, 80, 150, 80, 150];
    } else if (pattern === 'success') {
      vibPattern = [60, 40, 80];
    } else if (pattern === 'warning') {
      vibPattern = [120, 60, 120];
    } else {
      vibPattern = pattern;
    }
    navigator.vibrate(vibPattern);
  } catch {
    // Gracefully ignore if device restricts vibration
  }
}
