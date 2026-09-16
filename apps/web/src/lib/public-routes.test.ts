import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PUBLIC_PATHS, PUBLIC_PREFIXES, isPublicRoute } from './public-routes';

/**
 * Drift lock, in the shape of `analytics-surfaces.lock.test.ts`.
 *
 * Two layers decide whether an anonymous visitor may stand on a path: the Edge
 * middleware (does this cookie-less request get a 307?) and the client 401
 * handler (does this 401 hard-navigate the browser to /login?). While they kept
 * separate lists, the middleware served the public landing page and the client
 * ejected the visitor from it seconds later. Whoever adds the next public route
 * will add it to one file; this test makes sure there is only one file to add
 * it to.
 */
const MIDDLEWARE_SOURCE = resolve(__dirname, '../middleware.ts');
const AUTH_PROVIDER_SOURCE = resolve(__dirname, '../providers/auth-provider.tsx');

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('public-route source of truth', () => {
  it('is imported by the Edge middleware', () => {
    expect(read(MIDDLEWARE_SOURCE)).toMatch(
      /import\s*\{[^}]*isPublicRoute[^}]*\}\s*from\s*'@\/lib\/public-routes'/,
    );
  });

  it('is imported by the client 401 handler', () => {
    expect(read(AUTH_PROVIDER_SOURCE)).toMatch(
      /import\s*\{[^}]*isPublicRoute[^}]*\}\s*from\s*'@\/lib\/public-routes'/,
    );
  });

  it('is consulted by onUnauthorized rather than an ad-hoc path check', () => {
    const source = read(AUTH_PROVIDER_SOURCE);
    const handler = source.slice(
      source.indexOf('onUnauthorized:'),
      source.indexOf('refreshAccessToken:'),
    );

    expect(handler).toContain('isPublicRoute(window.location.pathname)');
    // The exemption that failed twice: a hand-rolled list of one or two paths.
    expect(handler).not.toMatch(/startsWith\(\s*'\/login'/);
    expect(handler).not.toMatch(/startsWith\(\s*'\/register'/);
  });

  for (const [label, path] of [
    ['middleware', MIDDLEWARE_SOURCE],
    ['auth provider', AUTH_PROVIDER_SOURCE],
  ] as const) {
    it(`does not let the ${label} declare its own copy of the list`, () => {
      const source = read(path);
      expect(source).not.toMatch(/const\s+PUBLIC_PATHS\s*[:=]/);
      expect(source).not.toMatch(/const\s+PUBLIC_PREFIXES\s*[:=]/);
    });
  }
});

describe('isPublicRoute', () => {
  for (const path of PUBLIC_PATHS) {
    it(`treats the listed path ${path} as public`, () => {
      expect(isPublicRoute(path)).toBe(true);
    });
  }

  for (const prefix of PUBLIC_PREFIXES) {
    it(`treats a path under ${prefix} as public`, () => {
      expect(isPublicRoute(`${prefix}anything/deeper`)).toBe(true);
    });
  }

  it.each([
    ['/search'],
    ['/digests'],
    ['/digests/8f1c2b64-0f2a-4c7e-9a1d-1b2c3d4e5f60'],
    ['/settings/billing'],
    ['/admin'],
    ['/workspace'],
  ])('treats the protected route %s as private', (path) => {
    expect(isPublicRoute(path)).toBe(false);
  });

  it('strips a query string before matching', () => {
    // The emailed restore link always carries ?token=…
    expect(isPublicRoute('/restore-account?token=abc')).toBe(true);
    expect(isPublicRoute('/search?q=people+v+dela+cruz')).toBe(false);
  });

  it('normalises a trailing slash', () => {
    expect(isPublicRoute('/about/')).toBe(true);
    expect(isPublicRoute('/')).toBe(true);
  });
});
