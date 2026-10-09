/**
 * Resolves an audio evidence URL to be fully playable in the current browser session.
 * 
 * Rules:
 * 1. If the URL is already a relative path starting with '/', resolves it against window.location.origin.
 * 2. If the URL starts with http://localhost or https://localhost (with optional port), replaces the localhost origin with window.location.origin.
 * 3. Preserves data: and blob: URLs without modification.
 * 4. Ensures old localhost links already stored in Firestore/localStorage play seamlessly.
 */
export function resolveAudioEvidenceUrl(url?: string | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  // Leave data: and blob: URLs untouched
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  if (typeof window === 'undefined') {
    return trimmed;
  }

  const origin = window.location.origin;

  // Replace any http://localhost(:port), https://localhost(:port), or 127.0.0.1 with current window.location.origin
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(trimmed)) {
    return trimmed.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, origin);
  }

  // Handle bare localhost(:port) or 127.0.0.1(:port)
  if (/^(localhost|127\.0\.0\.1)(:\d+)?/i.test(trimmed)) {
    return `${origin}${trimmed.replace(/^(localhost|127\.0\.0\.1)(:\d+)?/i, '')}`;
  }

  // If it's a relative path (e.g. "/api/sos/audio/...")
  if (trimmed.startsWith('/')) {
    return `${origin}${trimmed}`;
  }

  // If it does not start with http:// or https://, treat as relative path
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return `${origin}/${trimmed}`;
  }

  return trimmed;
}
