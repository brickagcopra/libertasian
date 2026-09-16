import { type NextRequest, NextResponse } from 'next/server';

import { isPublicRoute } from '@/lib/public-routes';

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
 *
 * The public-route allowlist lives in `@/lib/public-routes` because the
 * client-side 401 handler in `providers/auth-provider.tsx` has to answer the
 * same question. When the two lists were maintained separately, this file
 * served the landing page and the auth provider bounced the visitor off it a
 * moment later. Add new public routes THERE, not here.
 */

const SESSION_COOKIE = 'libertasian-session';

/**
 * Auth pages where authenticated users should be redirected to dashboard.
 *
 * `/reset-password` is deliberately NOT here. The reset link is emailed to one
 * specific account, but it is opened in whatever browser the person happens to
 * be using — often one already signed in as somebody else (a shared laptop, an
 * admin's own session). Bouncing that request to /search showed them the
 * signed-in account's dashboard and no reset form at all, so the emailed token
 * could never be redeemed from any signed-in browser. The page itself says
 * whose session is open; see apps/web/src/app/(auth)/reset-password.
 *
 * The other three stay: they are self-service entry points with nothing
 * account-specific in the URL, so an already-signed-in user has no business on
 * them and /search is the right answer.
 */
const AUTH_PAGES = ['/login', '/register', '/forgot-password'];

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
     * - team (management-team headshots on the public About page)
     * - API routes (handled by NestJS)
     * - Public assets
     */
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|\\.well-known/|email/|team/|api/|metrics).*)',
  ],
};
