import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';

import { middleware } from './middleware';

function makeRequest(pathname: string, hasSession = false): NextRequest {
  const url = new URL(`https://example.com${pathname}`);
  const cookies = new Map<string, { name: string; value: string }>();
  if (hasSession) {
    cookies.set('libertasian-session', { name: 'libertasian-session', value: '1' });
  }
  return {
    nextUrl: url,
    url: url.toString(),
    cookies: {
      has: (n: string) => cookies.has(n),
      get: (n: string) => cookies.get(n),
    },
  } as unknown as NextRequest;
}

function isRedirectToLogin(response: Response): boolean {
  if (response.status !== 307 && response.status !== 308) return false;
  const location = response.headers.get('location');
  return Boolean(location && location.includes('/login'));
}

describe('middleware — public-path allowlist', () => {
  describe('without session cookie', () => {
    const publicPaths = [
      '/',
      '/pricing',
      '/terms',
      '/privacy',
      '/blog/some-slug',
      '/shared/abc',
      '/.well-known/apple-app-site-association',
      '/.well-known/assetlinks.json',
      '/billing/mobile/success',
      '/billing/mobile/cancel',
      '/email/logo.png',
      // Business-identity pages. A payment gateway's KYC audit fetches these
      // unauthenticated during merchant activation; a /login redirect reads as
      // "the business proof does not exist".
      '/about',
      '/contact',
      '/refund-policy',
      // The favicon is fetched cookie-less on every public page load.
      '/icon.svg',
      // Store-required deletion surfaces. The restore link is emailed to an
      // account that CANNOT sign in, so a redirect here would make the
      // published 30-day window unreachable — the same bug /account-deletion
      // hit in PR #305.
      '/account-deletion',
      '/restore-account',
      '/restore-account?token=abc',
    ];

    for (const path of publicPaths) {
      it(`allows ${path} through (no /login redirect)`, () => {
        const res = middleware(makeRequest(path));
        expect(isRedirectToLogin(res)).toBe(false);
        // NextResponse.next() carries no Location header and a 2xx status by default.
        expect(res.headers.get('location')).toBeNull();
      });
    }

    const protectedPaths = [
      '/admin',
      '/search',
      '/digests',
      '/some-unknown-page',
      '/bar-exams',
      '/bar-exams/2022',
      '/billing',
      '/billing/history',
    ];
    for (const path of protectedPaths) {
      it(`redirects ${path} → /login?from=${path}`, () => {
        const res = middleware(makeRequest(path));
        expect(res.status).toBe(307);
        const location = res.headers.get('location');
        expect(location).toBeTruthy();
        const target = new URL(location as string);
        expect(target.pathname).toBe('/login');
        expect(target.searchParams.get('from')).toBe(path);
      });
    }
  });

  describe('with session cookie', () => {
    it('redirects /login → /search for authenticated users', () => {
      const res = middleware(makeRequest('/login', true));
      expect(res.status).toBe(307);
      const target = new URL(res.headers.get('location') as string);
      expect(target.pathname).toBe('/search');
    });

    it('redirects /register → /search for authenticated users', () => {
      const res = middleware(makeRequest('/register', true));
      expect(res.status).toBe(307);
      const target = new URL(res.headers.get('location') as string);
      expect(target.pathname).toBe('/search');
    });

    it('allows /admin through when authenticated (no redirect)', () => {
      const res = middleware(makeRequest('/admin', true));
      expect(isRedirectToLogin(res)).toBe(false);
      expect(res.headers.get('location')).toBeNull();
    });

    // The reset link is emailed to ONE account but opened in whatever browser
    // the person has to hand. Redirecting a signed-in request to /search showed
    // them somebody else's dashboard and no form at all, so the emailed token
    // could not be redeemed from any signed-in browser.
    it('allows /reset-password through when a DIFFERENT account is signed in', () => {
      const res = middleware(makeRequest('/reset-password', true));
      expect(res.status).not.toBe(307);
      expect(res.headers.get('location')).toBeNull();
    });

    it('allows /reset-password?token= through when authenticated', () => {
      const res = middleware(makeRequest('/reset-password?token=abc', true));
      expect(res.status).not.toBe(307);
      expect(res.headers.get('location')).toBeNull();
    });

    // /forgot-password is a self-service entry point with nothing
    // account-specific in the URL, so it keeps the redirect.
    it('still redirects /forgot-password → /search for authenticated users', () => {
      const res = middleware(makeRequest('/forgot-password', true));
      expect(res.status).toBe(307);
      const target = new URL(res.headers.get('location') as string);
      expect(target.pathname).toBe('/search');
    });
  });

  // Removing /reset-password from AUTH_PAGES must not remove it from the
  // public allowlist — a signed-out user opening the emailed link is the
  // ordinary case, and it has to keep returning 200.
  describe('/reset-password without a session', () => {
    it('is still public (no /login redirect)', () => {
      const res = middleware(makeRequest('/reset-password?token=abc'));
      expect(isRedirectToLogin(res)).toBe(false);
      expect(res.headers.get('location')).toBeNull();
    });
  });
});
