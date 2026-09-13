import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ANALYTICS_SURFACES,
  ROUTE_SEGMENT_SURFACES,
  surfaceForPath,
  routePatternForPath,
  pageViewProperties,
} from './analytics-surfaces';

/**
 * CI-lock, in the shape of `features/admin/budget-scopes.test.ts`: the mobile
 * copy of the surface map cannot import the web one, so the locked region of
 * each file is compared byte-for-byte. A drift would file the same screen
 * under two surface names and split its row on the "where users go" panel.
 */
const WEB_SOURCE = resolve(__dirname, './analytics-surfaces.ts');
const MOBILE_SOURCE = resolve(
  __dirname,
  '../../../mobile/src/lib/analytics-surfaces.ts',
);

const START = '// ─────────────────────── LOCKED REGION START ───────────────────────';
const END = '// ──────────────────────── LOCKED REGION END ────────────────────────';

function lockedRegion(path: string): string {
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error(`Locked region markers not found in ${path}`);
  }
  return text.slice(start + START.length, end);
}

describe('analytics surface map mirror', () => {
  it('matches the mobile copy byte-for-byte', () => {
    expect(lockedRegion(MOBILE_SOURCE)).toEqual(lockedRegion(WEB_SOURCE));
  });
});

describe('surfaceForPath', () => {
  /**
   * Every route group in either app, with the surface it must report. These
   * are the literal paths the clients produce: Next.js `usePathname()` for the
   * web rows, Expo Router segments (groups included) for the mobile rows.
   */
  const cases: Array<[string, string]> = [
    // web
    ['/digests', 'digests'],
    ['/digests/8f1c2b64-0f2a-4c7e-9a1d-1b2c3d4e5f60', 'digests'],
    ['/bar-exams', 'bar_exams'],
    ['/bar-exams/practice', 'bar_exams'],
    ['/library', 'library'],
    ['/reader/8f1c2b64-0f2a-4c7e-9a1d-1b2c3d4e5f60', 'codals'],
    ['/scans', 'scans'],
    ['/feed', 'feed'],
    ['/search', 'search'],
    ['/study', 'study'],
    ['/workspace', 'workspace'],
    ['/admin', 'admin'],
    ['/admin/analytics', 'admin'],
    // mobile — group segments are stripped before the lookup
    ['/(tabs)/digests', 'digests'],
    ['/(tabs)/library/collections', 'library'],
    ['/(tabs)/feed/[id]', 'feed'],
    ['/(tabs)/scan', 'scans'],
    ['/(tabs)/search', 'search'],
    ['/(tabs)/study', 'study'],
    ['/(tabs)/workspace', 'workspace'],
    ['/bar-exams/[id]', 'bar_exams'],
    ['/codals/[slug]', 'codals'],
    ['/digest/[id]', 'digests'],
    ['/reader/[id]', 'codals'],
    ['/scan/review', 'scans'],
  ];

  it.each(cases)('maps %s to %s', (path, surface) => {
    expect(surfaceForPath(path)).toBe(surface);
  });

  it('falls back to other rather than dropping an unmapped route', () => {
    expect(surfaceForPath('/settings')).toBe('other');
    expect(surfaceForPath('/community/threads')).toBe('other');
    expect(surfaceForPath('/(tabs)')).toBe('other');
    expect(surfaceForPath('/')).toBe('other');
    expect(surfaceForPath('')).toBe('other');
  });

  it('only ever returns a declared surface', () => {
    for (const [path] of cases) {
      expect(ANALYTICS_SURFACES).toContain(surfaceForPath(path));
    }
    expect(ANALYTICS_SURFACES).toContain(surfaceForPath('/nothing-here'));
  });

  it('maps every segment in the table to a declared surface', () => {
    for (const surface of Object.values(ROUTE_SEGMENT_SURFACES)) {
      expect(ANALYTICS_SURFACES).toContain(surface);
    }
  });
});

describe('routePatternForPath', () => {
  it('redacts a concrete id to [id]', () => {
    expect(routePatternForPath('/digest/8f1c2b64-0f2a-4c7e-9a1d-1b2c3d4e5f60')).toBe(
      '/digest/[id]',
    );
    expect(routePatternForPath('/reader/214986')).toBe('/reader/[id]');
    expect(routePatternForPath('/bar-exams/gr-no-214986')).toBe('/bar-exams/[id]');
  });

  it('keeps a router-supplied [param] as written', () => {
    expect(routePatternForPath('/(tabs)/feed/[id]')).toBe('/feed/[id]');
    expect(routePatternForPath('/codals/[slug]')).toBe('/codals/[slug]');
  });

  it('keeps static route names', () => {
    expect(routePatternForPath('/admin/analytics')).toBe('/admin/analytics');
    expect(routePatternForPath('/(tabs)/library/collections')).toBe('/library/collections');
    expect(routePatternForPath('/scan/review')).toBe('/scan/review');
  });

  it('drops a query string — it can carry the search text', () => {
    expect(routePatternForPath('/search?q=people+v+dela+cruz')).toBe('/search');
  });

  it('normalises the root', () => {
    expect(routePatternForPath('/')).toBe('/');
    expect(routePatternForPath('/(tabs)')).toBe('/');
  });
});

describe('pageViewProperties', () => {
  it('carries the route pattern and surface, and nothing else', () => {
    const props = pageViewProperties('/digest/8f1c2b64-0f2a-4c7e-9a1d-1b2c3d4e5f60');
    expect(props).toEqual({ path: '/digest/[id]', surface: 'digests' });
    expect(Object.keys(props).sort()).toEqual(['path', 'surface']);
  });
});
