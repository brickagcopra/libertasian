import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  ANALYTICS_SURFACES,
  ROUTE_SEGMENT_SURFACES,
  surfaceForPath,
  routePatternForPath,
  pageViewProperties,
} from '@/lib/analytics-surfaces';

/**
 * CI-lock, in the shape of `apps/web/src/features/admin/budget-scopes.test.ts`.
 * `apps/web/src/lib/analytics-surfaces.ts` is the canonical copy; mobile cannot
 * import it, so the locked region of each file is compared byte-for-byte. A
 * drift would file the same screen under two surface names and split its row
 * on the admin "where users go" panel.
 */
const MOBILE_SOURCE = resolve(__dirname, '../../lib/analytics-surfaces.ts');
const WEB_SOURCE = resolve(
  __dirname,
  '../../../../web/src/lib/analytics-surfaces.ts',
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
  it('matches the web copy byte-for-byte', () => {
    expect(lockedRegion(MOBILE_SOURCE)).toEqual(lockedRegion(WEB_SOURCE));
  });
});

describe('surfaceForPath — every mobile route group', () => {
  /**
   * One row per route group the mobile app can navigate to, spelled the way
   * Expo Router's segments spell it (group segments included, dynamic
   * segments in `[param]` form).
   */
  const cases: Array<[string, string]> = [
    ['/(tabs)/digests', 'digests'],
    ['/(tabs)/library', 'library'],
    ['/(tabs)/library/collections', 'library'],
    ['/(tabs)/feed', 'feed'],
    ['/(tabs)/feed/[id]', 'feed'],
    ['/(tabs)/scan', 'scans'],
    ['/(tabs)/search', 'search'],
    ['/(tabs)/study', 'study'],
    ['/(tabs)/workspace', 'workspace'],
    ['/bar-exams', 'bar_exams'],
    ['/bar-exams/[id]', 'bar_exams'],
    ['/codals', 'codals'],
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
    expect(surfaceForPath('/notifications')).toBe('other');
    expect(surfaceForPath('/(tabs)')).toBe('other');
    expect(surfaceForPath('/')).toBe('other');
  });

  it('only ever returns a declared surface', () => {
    for (const [path] of cases) {
      expect(ANALYTICS_SURFACES).toContain(surfaceForPath(path));
    }
    for (const surface of Object.values(ROUTE_SEGMENT_SURFACES)) {
      expect(ANALYTICS_SURFACES).toContain(surface);
    }
  });
});

describe('routePatternForPath', () => {
  it('keeps a router-supplied [param] as written', () => {
    expect(routePatternForPath('/digest/[id]')).toBe('/digest/[id]');
    expect(routePatternForPath('/(tabs)/feed/[id]')).toBe('/feed/[id]');
  });

  it('redacts a concrete id, should a screen ever hand us one', () => {
    expect(routePatternForPath('/digest/8f1c2b64-0f2a-4c7e-9a1d-1b2c3d4e5f60')).toBe(
      '/digest/[id]',
    );
    expect(routePatternForPath('/reader/214986')).toBe('/reader/[id]');
  });
});

describe('pageViewProperties', () => {
  it('carries the route pattern and surface, and nothing else', () => {
    expect(pageViewProperties('/digest/[id]')).toEqual({
      path: '/digest/[id]',
      surface: 'digests',
    });
  });
});
