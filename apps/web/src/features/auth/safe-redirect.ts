/**
 * Post-login return paths.
 *
 * A return path rides through `/login?from=` (middleware, auth guard, 401
 * handler) and through the Google OAuth round trip (sessionStorage, because
 * the flow leaves the app for the API and Google). It is untrusted input on
 * every hop, so it is re-validated wherever it is consumed.
 *
 * Only same-origin relative paths are accepted: a single leading `/`, then
 * anything. The path and query are preserved (`/research?q=…` must survive).
 */

const LOGIN_PATH = '/login';
const MAX_RETURN_PATH_LENGTH = 2048;
/** Placeholder origin for the URL-parser check; never navigated to. */
const PROBE_ORIGIN = 'https://same-origin.invalid';
/** How many layers of percent-encoding are peeled off the path. */
const MAX_DECODE_PASSES = 3;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/** A path START is safe: one `/`, not `//` or `/\`, no control characters. */
function hasSafeStart(path: string): boolean {
  if (!path.startsWith('/')) return false; // "https://", "javascript:", "evil.com"
  if (path.startsWith('//') || path.startsWith('/\\')) return false; // protocol-relative
  return !CONTROL_CHARS.test(path);
}

/**
 * True when `value` is a same-origin relative path that is safe to navigate
 * to. Rejects protocol-relative (`//evil`, `/\evil`), absolute URLs, schemes
 * (`javascript:`), control characters (`/\t/evil` parses as `//evil`) and the
 * percent-encoded forms of all of these (`/%2F%2Fevil`, `/%5Cevil`,
 * `/%252F%252Fevil`).
 */
export function isSafeReturnPath(value: string | null | undefined): value is string {
  if (!value || value.length > MAX_RETURN_PATH_LENGTH) return false;
  if (!hasSafeStart(value)) return false;

  // Encoded variants: peel percent-encoding off the PATH (not the query, whose
  // encoded `%` / `&` are legitimate) and re-check the start after each pass.
  let path = value.split(/[?#]/, 1)[0] as string;
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return false; // malformed escape in the path: not a path we produced
    }
    if (decoded === path) break;
    if (!hasSafeStart(decoded)) return false;
    path = decoded;
  }

  // Belt and braces: the browser's own parser must keep it on this origin.
  try {
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Resolve a post-login redirect target from an untrusted `?from=` value.
 * Returns `from` unchanged (path + query) when it is a safe same-origin
 * relative path, else `fallback`.
 */
export function resolveSafeRedirect(from: string | null | undefined, fallback: string): string {
  return isSafeReturnPath(from) ? from : fallback;
}

/**
 * `/login`, carrying `returnTo` (path + search) as `?from=` when it is a safe
 * path worth returning to. The login page itself is never a return target.
 */
export function loginHref(returnTo: string | null | undefined): string {
  if (!isSafeReturnPath(returnTo)) return LOGIN_PATH;
  const path = returnTo.split(/[?#]/, 1)[0];
  if (path === '/' || path === LOGIN_PATH) return LOGIN_PATH;
  return `${LOGIN_PATH}?from=${encodeURIComponent(returnTo)}`;
}

/**
 * The OAuth round trip leaves the app (web → API → Google → API →
 * /auth/callback), so `?from=` cannot ride along in the URL without API
 * changes. It is parked in sessionStorage (per tab, survives the cross-origin
 * redirects) and re-validated when it is read back.
 */
export const OAUTH_RETURN_KEY = 'libertasian:oauth-return-to';

export function stashOAuthReturnPath(from: string | null | undefined): void {
  try {
    if (isSafeReturnPath(from)) window.sessionStorage.setItem(OAUTH_RETURN_KEY, from);
    else window.sessionStorage.removeItem(OAUTH_RETURN_KEY);
  } catch {
    // Storage blocked (private mode, policy): fall back to the default landing.
  }
}

/** Read and clear the parked return path. Null when absent or unsafe. */
export function takeOAuthReturnPath(): string | null {
  try {
    const value = window.sessionStorage.getItem(OAUTH_RETURN_KEY);
    window.sessionStorage.removeItem(OAUTH_RETURN_KEY);
    return isSafeReturnPath(value) ? value : null;
  } catch {
    return null;
  }
}
