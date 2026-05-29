/**
 * Resolve a post-login redirect target from an untrusted ?from= value.
 * Accepts only same-origin absolute paths (a single leading slash). Rejects
 * protocol-relative ("//host", "/\\host"), absolute URLs, schemes, and control
 * characters — guards against open redirects. Falls back otherwise.
 */
export function resolveSafeRedirect(
  from: string | null | undefined,
  fallback: string,
): string {
  if (!from) return fallback;
  if (!from.startsWith('/')) return fallback; // rejects "https://", "javascript:", etc.
  if (from.startsWith('//') || from.startsWith('/\\')) return fallback; // protocol-relative
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(from)) return fallback; // control chars
  return from;
}
