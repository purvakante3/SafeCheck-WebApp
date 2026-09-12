/**
 * Formats travel duration consistently across the SafeCheck app:
 * - 60 minutes or more: formatted in hours and minutes (e.g., "5h 49m", "1h", "2h 15m")
 * - Under 60 minutes: formatted in minutes only (e.g., "45 mins")
 *
 * The underlying stored duration value in database/state remains in minutes.
 */
export function formatDuration(totalMinutes: number): string {
  if (typeof totalMinutes !== 'number' || isNaN(totalMinutes) || totalMinutes < 0) {
    return '0 mins';
  }

  const rounded = Math.round(totalMinutes);
  if (rounded < 60) {
    return `${rounded} mins`;
  }

  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}m`;
}
