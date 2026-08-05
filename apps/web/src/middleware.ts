import { type NextRequest, NextResponse } from 'next/server';

/**
 * Next.js Edge middleware for route protection.
 *
 * Since the app stores JWT tokens in localStorage (Zustand persist),
 * the Edge middleware cannot validate the actual token. Instead, we
 * check for a lightweight session cookie (`libertasian-session`) that
 * is set client-side when the user authenticates.
 *
 * This is a UX gate — prevents unauthenticated users from seeing
 * dashboard chrome before the client-side AuthProvider kicks in.
 * Real security is enforced API-side by NestJS JWT guards.
 */

const SESSION_COOKIE = 'libertasian-session';

/** Routes that should be accessible without authentication. */
const PUBLIC_PATHS = [
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
// /restore-account is listed as a prefix too, not only an exact path: the
// emailed link always carries `?token=`, and any future sub-path must stay
// reachable without a session for the same reason.
const PUBLIC_PREFIXES = [
  '/shared/',
  '/blog',
  '/.well-known/',
  '/billing/mobile',
  '/email/',
  '/restore-account',
];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Auth pages where authenticated users should be redirected to dashboard. */
const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];

function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.includes(pathname);
}

/** Apply security headers to a response. */
function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  // Authenticated user trying to visit auth pages → redirect to search (main dashboard)
  if (hasSession && isAuthPage(pathname)) {
    return withSecurityHeaders(NextResponse.redirect(new URL('/search', request.url)));
  }

  // Public route → allow through
  if (isPublicRoute(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  // Protected route without session → redirect to login with return URL
  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  return withSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - .well-known (deep-link verification files — must return 200, no redirect)
     * - email (static assets referenced by transactional emails — must return 200, no redirect)
     * - API routes (handled by NestJS)
     * - Public assets
     */
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|\\.well-known/|email/|api/|metrics).*)',
  ],
};
