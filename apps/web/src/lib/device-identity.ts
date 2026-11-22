/**
 * Browser identity sent with every API request.
 *
 * `X-Device-Id` is a random UUID generated once per browser profile and kept
 * in localStorage. It is never derived from hardware or fingerprinting:
 * clearing site data produces a new one. The API uses it to tell a re-login in
 * the same browser from a sign-in on a new device, and to count an account's
 * signed-in devices against its plan's limit.
 *
 * `X-Device-Name` is a short human label ("Chrome on Windows") parsed from
 * navigator.userAgent, shown back to the user when they review where they are
 * signed in.
 *
 * Server-side (SSR / route handlers) there is no browser, so no headers.
 */

const STORAGE_KEY = 'libertasian-device-id';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cachedId: string | null = null;

/** RFC 4122 v4 UUID from the browser CSPRNG. */
export function generateUuidV4(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // randomUUID needs a secure context; plain-http dev hosts fall back here.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** This browser's device id, created and persisted on first use. Never throws. */
export function getDeviceId(): string {
  if (cachedId) return cachedId;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && UUID_SHAPE.test(stored)) {
      cachedId = stored;
      return stored;
    }
    const fresh = generateUuidV4();
    window.localStorage.setItem(STORAGE_KEY, fresh);
    cachedId = fresh;
    return fresh;
  } catch {
    // Storage blocked (private mode, disabled site data): keep a per-tab id.
    cachedId = generateUuidV4();
    return cachedId;
  }
}

/** Test-only: forget the memoised id so the next call re-reads storage. */
export function resetDeviceIdCacheForTests(): void {
  cachedId = null;
}

function browserName(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Browser';
}

function osName(ua: string): string | null {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

/** Short label such as "Chrome on Windows" or "Safari on iPhone". */
export function describeUserAgent(ua: string): string {
  const os = osName(ua);
  const browser = browserName(ua);
  return os ? `${browser} on ${os}` : browser;
}

/** Headers identifying this browser to the API; empty outside a browser. */
export function deviceHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return {
    'X-Device-Id': getDeviceId(),
    'X-Device-Name': describeUserAgent(ua),
  };
}
