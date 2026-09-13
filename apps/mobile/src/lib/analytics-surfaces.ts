/**
 * Navigation → analytics surface mapping (mobile).
 *
 * Mirror of `apps/web/src/lib/analytics-surfaces.ts`. The locked region below
 * is byte-for-byte identical to the web copy and is pinned by
 * `analytics-surfaces.lock.test.ts`; edit both files together.
 */

// ─────────────────────── LOCKED REGION START ───────────────────────
// Everything between the LOCKED REGION markers is duplicated verbatim in
// apps/web/src/lib/analytics-surfaces.ts and
// apps/mobile/src/lib/analytics-surfaces.ts, and both copies are compared
// byte-for-byte by analytics-surfaces.lock.test.* in each app. Edit both.

/**
 * The product surfaces the dashboard groups navigation by.
 *
 * `other` is not a failure mode — it is the bucket for any route that has no
 * mapping yet. A view is never dropped, because a surface list that silently
 * omits routes reads as "nobody goes there" rather than "we never mapped it",
 * which is the same class of bug as a dashboard that cannot tell zero from
 * never-ran.
 */
export const ANALYTICS_SURFACES = [
  'digests',
  'bar_exams',
  'library',
  'codals',
  'scans',
  'feed',
  'search',
  'study',
  'workspace',
  'admin',
  'other',
] as const;

export type AnalyticsSurface = (typeof ANALYTICS_SURFACES)[number];

/**
 * First meaningful path segment → surface.
 *
 * Keyed on the segment rather than the full path so one table serves both
 * clients: web routes it as `/digests`, `/reader/<id>`, `/scans`; mobile as
 * `/(tabs)/digests`, `/reader/[id]`, `/scan`. Expo Router group segments —
 * `(tabs)`, `(auth)` — are stripped before the lookup, so the two route trees
 * reduce to the same keys. Both spellings of the pairs that differ between
 * the apps (`digest`/`digests`, `scan`/`scans`) are listed.
 *
 * Kept in alphabetical order: the byte-for-byte CI lock makes any reordering
 * a test failure, so there needs to be one obvious place to insert a key.
 */
export const ROUTE_SEGMENT_SURFACES: Record<string, AnalyticsSurface> = {
  admin: 'admin',
  'bar-exams': 'bar_exams',
  codals: 'codals',
  digest: 'digests',
  digests: 'digests',
  feed: 'feed',
  library: 'library',
  reader: 'codals',
  scan: 'scans',
  scans: 'scans',
  search: 'search',
  study: 'study',
  workspace: 'workspace',
};

/** A uuid in any of the casings either client produces. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when a path segment looks like a record identifier rather than a static
 * route name.
 *
 * Deliberately biased toward redaction. This is a legal-research product: a
 * route carrying a case id is a record of what a named user researched, so a
 * false positive costs us a slightly vaguer route pattern while a false
 * negative puts a subject's research history in the analytics table. The
 * digit test catches citation-shaped slugs (`gr-no-214986`) that no static
 * route name in either app would trip.
 */
function looksLikeIdentifier(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (UUID_RE.test(segment)) return true;
  if (segment.length > 24) return true;
  return segment.length >= 8 && /\d/.test(segment);
}

/** Strip Expo Router group segments — `(tabs)`, `(auth)`, `(onboarding)`. */
function isGroupSegment(segment: string): boolean {
  return segment.startsWith('(') && segment.endsWith(')');
}

function segmentsOf(path: string): string[] {
  const withoutQuery = path.split('?')[0] ?? '';
  return withoutQuery.split('/').filter((s) => s.length > 0 && !isGroupSegment(s));
}

/**
 * The surface a path belongs to. Unmapped paths — and `/` — are `other`,
 * never dropped.
 */
export function surfaceForPath(path: string): AnalyticsSurface {
  const first = segmentsOf(path)[0];
  if (!first) return 'other';
  return ROUTE_SEGMENT_SURFACES[first] ?? 'other';
}

/**
 * The route *pattern* for a path, with identifier segments replaced by
 * `[id]`: `/digest/8f1c…` → `/digest/[id]`.
 *
 * A segment the router already gave us in `[param]` form is kept as written —
 * Expo Router's `useSegments()` yields those directly, and the param name is
 * route structure, not user data. Everything else goes through
 * `looksLikeIdentifier`, so a client that hands us a concrete id (Next.js
 * `usePathname()` always does) is redacted here rather than at the call site.
 */
export function routePatternForPath(path: string): string {
  const segments = segmentsOf(path).map((segment) => {
    if (segment.startsWith('[') && segment.endsWith(']')) return segment;
    return looksLikeIdentifier(segment) ? '[id]' : segment;
  });
  return segments.length > 0 ? `/${segments.join('/')}` : '/';
}

/** The `page_viewed` properties for a path: route pattern and surface only. */
export function pageViewProperties(path: string): { path: string; surface: AnalyticsSurface } {
  return { path: routePatternForPath(path), surface: surfaceForPath(path) };
}
// ──────────────────────── LOCKED REGION END ────────────────────────
