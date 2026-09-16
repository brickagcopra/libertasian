/**
 * The single source of truth for "can an anonymous visitor be on this path?".
 *
 * Two independent layers ask that question and they must never disagree:
 *
 *  - `src/middleware.ts` (Edge) decides whether to 307 a cookie-less request
 *    to /login.
 *  - `src/providers/auth-provider.tsx` decides whether a 401 from any API call
 *    should hard-redirect the browser to /login.
 *
 * When those two lists drifted, the middleware correctly served the public
 * landing page and then the client ejected the visitor from it seconds later,
 * because the auth provider only knew about /login and /register. Commit
 * 6a19554 patched that for the login page alone and the same class of bug came
 * straight back on every other public route. Keep both importers reading THIS
 * file — do not re-declare either array anywhere else.
 *
 * This module is imported by Edge middleware: keep it free of React, browser
 * globals and Node built-ins.
 */

/** Routes that should be accessible without authentication. */
export const PUBLIC_PATHS: readonly string[] = [
  '/',
  '/pricing',
  '/terms',
  '/privacy',
  // Business-identity pages. Payment gateways audit these during merchant
  // activation and fetch them unauthenticated — a redirect to /login here
  // reads as "the business proof does not exist".
  '/about',
  '/contact',
  '/refund-policy',
  '/account-deletion',
  // The restore link is emailed to an account that CANNOT sign in — a redirect
  // to /login here would make the published 30-day window unreachable.
  '/restore-account',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  // The invite link is emailed to someone who may have no account at all. A
  // redirect to /login here would hide the organization and role they are
  // being offered, and strip the ?token= the accept call needs.
  '/accept-invite',
  '/auth/callback',
  '/onboarding',
  // app/icon.svg is served at /icon.svg. Browsers request the favicon with no
  // session cookie on every public page, so without this the site's own icon
  // 307s to /login for every anonymous visitor — including a payment gateway's
  // KYC reviewer, whose browser silently fails to load our branding.
  '/icon.svg',
];

/** Path prefixes that should be accessible without authentication. */
// /.well-known/ hosts apple-app-site-association + assetlinks.json —
// Apple/Google deep-link verifiers require a direct 200, never a redirect.
// /billing/mobile hosts the Xendit → mobile-app bounce pages; the user
// arrives from the system browser without a web session cookie.
// /email/ hosts static assets referenced by outgoing transactional emails
// (logo etc.) — email clients fetch with no session cookie and must get a
// direct 200, never a redirect.
// /team/ hosts the management-team headshots on the public About page. A
// payment gateway's KYC reviewer loads /about unauthenticated; without this
// the officer photos backing the business-identity proof 307 to /login.
// /restore-account is listed as a prefix too, not only an exact path: the
// emailed link always carries `?token=`, and any future sub-path must stay
// reachable without a session for the same reason.
export const PUBLIC_PREFIXES: readonly string[] = [
  '/shared/',
  '/blog',
  '/.well-known/',
  '/billing/mobile',
  '/email/',
  '/team/',
  '/restore-account',
];

/**
 * True when `pathname` is reachable without a session.
 *
 * Accepts a raw `window.location.pathname` or a Next.js `nextUrl.pathname`.
 * A query string or hash is stripped first so `/restore-account?token=…`
 * matches the exact path entry, and a trailing slash is normalised away so
 * `/about/` is not treated as a protected route.
 */
export function isPublicRoute(pathname: string): boolean {
  const path = normalizePathname(pathname);
  if (PUBLIC_PATHS.includes(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function normalizePathname(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/)[0] ?? '';
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}
