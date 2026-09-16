import * as fs from 'fs';
import * as path from 'path';

/**
 * Guard: every URL that NotificationsService puts into an outgoing email must
 * resolve to a route that actually exists.
 *
 * Three transactional emails shipped links to routes that were never there
 * (`/auth/reset-password`, `/auth/forgot-password`, `/organizations/accept-invite`),
 * plus a `/dashboard` link in the subscription confirmation. Each 307'd to
 * /login, which reads as a session problem rather than a broken link, so all
 * four survived in production. The recurring trap is Next.js route GROUPS:
 * `apps/web/src/app/(auth)/reset-password` is served at `/reset-password` —
 * the `(auth)` folder contributes NO url segment.
 *
 * This spec reads the real source of both apps, so it fails on a link to a
 * route that does not exist and on a route that is later renamed or deleted.
 */

const API_SRC = path.resolve(__dirname, '../../..', 'src');
const MONOREPO_ROOT = path.resolve(__dirname, '../../../../..');
const NOTIFICATIONS_SERVICE = path.join(
  API_SRC,
  'modules/notifications/notifications.service.ts',
);
const WEB_APP_DIR = path.join(MONOREPO_ROOT, 'apps/web/src/app');
/**
 * The no-session allowlist. It used to be declared inline in
 * `apps/web/src/middleware.ts`; it now lives here because the client-side 401
 * handler (`apps/web/src/providers/auth-provider.tsx`) has to answer the same
 * question, and while the two kept separate lists the middleware served the
 * public landing page and the client bounced the visitor off it seconds later.
 * `apps/web/src/lib/public-routes.test.ts` asserts that middleware.ts declares
 * no copy of these arrays, so this path is where they will stay.
 */
const WEB_PUBLIC_ROUTES = path.join(
  MONOREPO_ROOT,
  'apps/web/src/lib/public-routes.ts',
);

/** A URL built from `${this.appUrl}` in notifications.service.ts. */
interface EmailLink {
  /** Everything after the origin, e.g. `/reset-password?token=${token}`. */
  raw: string;
  /** Path only, query and fragment stripped. */
  pathname: string;
}

/**
 * Collect every URL the service builds on top of the app origin.
 * Matches the template literals `` `${this.appUrl}…` `` verbatim in source, so
 * a new email that builds its link the same way is picked up automatically.
 */
function collectEmailLinks(): EmailLink[] {
  const source = fs.readFileSync(NOTIFICATIONS_SERVICE, 'utf-8');
  const pattern = /`\$\{this\.appUrl\}([^`]*)`/g;
  const links: EmailLink[] = [];

  for (const match of source.matchAll(pattern)) {
    const raw = match[1] ?? '';
    const pathname = raw.split(/[?#]/)[0] ?? '';
    links.push({ raw, pathname });
  }
  return links;
}

/**
 * Every route the Next.js app router serves, as a list of segment matchers.
 * Route groups are dropped, so `(auth)/reset-password/page.tsx` becomes
 * `['reset-password']`. Dynamic segments become sentinels rather than literals.
 */
type SegmentMatcher =
  | { kind: 'literal'; value: string }
  | { kind: 'param' }
  | { kind: 'catchAll' };

function collectWebRoutes(): SegmentMatcher[][] {
  const routes: SegmentMatcher[][] = [];

  const walk = (dir: string, segments: SegmentMatcher[]): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // `(group)` and `@slot` folders contribute no URL segment. `_private`
        // folders are excluded from routing entirely.
        if (entry.name.startsWith('_')) continue;
        const contributes =
          !entry.name.startsWith('(') && !entry.name.startsWith('@');
        const next: SegmentMatcher[] = contributes
          ? [...segments, toMatcher(entry.name)]
          : segments;
        walk(path.join(dir, entry.name), next);
        continue;
      }
      if (entry.name === 'page.tsx' || entry.name === 'route.ts') {
        routes.push(segments);
      }
    }
  };

  walk(WEB_APP_DIR, []);
  return routes;
}

function toMatcher(folder: string): SegmentMatcher {
  // `[...slug]` and `[[...slug]]` swallow the rest of the path.
  if (folder.startsWith('[[...') || folder.startsWith('[...')) {
    return { kind: 'catchAll' };
  }
  if (folder.startsWith('[')) return { kind: 'param' };
  return { kind: 'literal', value: folder };
}

/** Does `pathname` hit this route? */
function routeMatches(route: SegmentMatcher[], pathname: string): boolean {
  const parts = pathname.split('/').filter((part) => part.length > 0);

  for (let i = 0; i < route.length; i++) {
    const matcher = route[i] as SegmentMatcher;
    if (matcher.kind === 'catchAll') return parts.length > i;
    const part = parts[i];
    if (part === undefined) return false;
    if (matcher.kind === 'literal' && matcher.value !== part) return false;
  }
  return parts.length === route.length;
}

/**
 * The declaration of each allowlist array, as written in the source.
 *
 * `(?:export\s+)?` and `(?::[^=]+)?` tolerate the `export` keyword and the
 * `: readonly string[]` annotation the arrays now carry — the narrower pattern
 * these replaced (`const PUBLIC_PATHS = [`) matched neither, which is how this
 * guard silently started checking an empty list.
 */
const ARRAY_DECLARATIONS = {
  PUBLIC_PATHS: /(?:export\s+)?const\s+PUBLIC_PATHS\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]/,
  PUBLIC_PREFIXES:
    /(?:export\s+)?const\s+PUBLIC_PREFIXES\s*(?::[^=]+)?=\s*\[([\s\S]*?)\]/,
} satisfies Record<string, RegExp>;

/**
 * Read one string-array declaration out of the shared public-route module.
 * Callers must assert the result is non-empty: an unmatched regex is
 * indistinguishable from a genuinely empty allowlist, and reads as a pass.
 */
function collectStringArray(name: keyof typeof ARRAY_DECLARATIONS): string[] {
  const source = fs.readFileSync(WEB_PUBLIC_ROUTES, 'utf-8');
  const block = ARRAY_DECLARATIONS[name].exec(source)?.[1] ?? '';
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
}

/** Exact paths listed in the no-session allowlist. */
function collectPublicPaths(): string[] {
  return collectStringArray('PUBLIC_PATHS');
}

/** Path prefixes listed in the no-session allowlist. */
function collectPublicPrefixes(): string[] {
  return collectStringArray('PUBLIC_PREFIXES');
}

describe('transactional email links point at routes that exist', () => {
  const links = collectEmailLinks();
  const webRoutes = collectWebRoutes();

  // API paths are served by NestJS, not by the Next.js app router.
  const apiLinks = links.filter((link) => link.pathname.startsWith('/api/'));
  const webLinks = links.filter((link) => !link.pathname.startsWith('/api/'));

  it('finds the links (the guard is not silently matching nothing)', () => {
    // If a refactor changes how URLs are built, this drops and the suite says
    // so instead of passing vacuously.
    expect(links.length).toBeGreaterThanOrEqual(9);
    expect(webRoutes.length).toBeGreaterThan(50);
  });

  it('builds no path with an un-analyzable dynamic segment', () => {
    // Interpolation in the query string is fine; a `${…}` inside the PATH would
    // make the checks below meaningless, so teach the guard before adding one.
    const dynamic = links.filter((link) => link.pathname.includes('${'));
    expect(dynamic.map((link) => link.raw)).toEqual([]);
  });

  it.each(
    // Deduplicate: /settings/billing is built by four different emails.
    [...new Set(webLinks.map((link) => link.pathname))].map((p) => [p]),
  )('%s is a real apps/web/src/app route', (pathname: string) => {
    const matched = webRoutes.some((route) => routeMatches(route, pathname));
    expect(matched).toBe(true);
  });

  it.each([...new Set(apiLinks.map((link) => link.pathname))].map((p) => [p]))(
    '%s is a real NestJS route',
    (pathname: string) => {
      // /api/v1/<controller>/<handler>
      const [, , , controller, handler] = pathname.split('/');
      const modules = path.join(API_SRC, 'modules');
      const found = fs
        .readdirSync(modules, { recursive: true })
        .filter(
          (file): file is string =>
            typeof file === 'string' && file.endsWith('.controller.ts'),
        )
        .some((file) => {
          const source = fs.readFileSync(path.join(modules, file), 'utf-8');
          return (
            source.includes("@Controller('" + controller + "')") &&
            new RegExp(
              "@(Get|Post|Put|Patch|Delete)\\('" + handler + "'\\)",
            ).test(source)
          );
        });
      expect(found).toBe(true);
    },
  );

  it('covers the links this spec was written for', () => {
    const paths = links.map((link) => link.pathname);
    expect(paths).toContain('/reset-password');
    expect(paths).toContain('/forgot-password');
    expect(paths).toContain('/accept-invite');
    // The dead originals must not come back.
    expect(paths).not.toContain('/auth/reset-password');
    expect(paths).not.toContain('/auth/forgot-password');
    expect(paths).not.toContain('/organizations/accept-invite');
    expect(paths).not.toContain('/dashboard');
  });
});

describe('email entry points are reachable without a session', () => {
  const publicPaths = collectPublicPaths();
  const publicPrefixes = collectPublicPrefixes();

  it('finds the allowlist (the guard is not silently matching nothing)', () => {
    // When the arrays moved out of middleware.ts the old regex matched
    // nothing, so every check below ran against `[]`. Read an empty list as
    // "allowlist not found" and fail loudly rather than asserting on air —
    // the next move of this file should land here, not go unnoticed.
    expect(publicPaths.length).toBeGreaterThan(0);
    expect(publicPrefixes.length).toBeGreaterThan(0);
    // Spot-check one entry of each that has no reason to ever leave, so a
    // regex that matches only the first line or the wrong array still fails.
    expect(publicPaths).toContain('/login');
    expect(publicPrefixes).toContain('/email/');
  });

  // These three links are opened by someone who, by definition, cannot be
  // signed in: a locked-out user resetting a password, or an invitee with no
  // account at all. A path missing from PUBLIC_PATHS 307s to /login and the
  // emailed token never reaches the page — the same symptom as a dead route.
  it.each([['/reset-password'], ['/forgot-password'], ['/accept-invite']])(
    '%s is in the PUBLIC_PATHS allowlist',
    (pathname: string) => {
      expect(publicPaths).toContain(pathname);
    },
  );

  it('keeps the emailed static assets reachable', () => {
    // Transactional emails reference /email/<asset>; an email client fetches
    // those with no session cookie and must get a direct 200, never a 307.
    expect(publicPrefixes).toContain('/email/');
  });
});
