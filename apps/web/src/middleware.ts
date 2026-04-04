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
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/auth/callback',
];

/** Path prefixes that should be accessible without authentication. */
const PUBLIC_PREFIXES = ['/shared/'];

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Auth pages where authenticated users should be redirected to dashboard. */
const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password'];

function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.includes(pathname);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  // Authenticated user trying to visit auth pages → redirect to search (main dashboard)
  if (hasSession && isAuthPage(pathname)) {
    return NextResponse.redirect(new URL('/search', request.url));
  }

  // Public route → allow through
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }

  // Protected route without session → redirect to login with return URL
  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico, sitemap.xml, robots.txt
     * - API routes (handled by NestJS)
     * - Public assets
     */
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|api/).*)',
  ],
};
