import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

import { NOT_INCLUDED_MESSAGE, NO_ACCESS_MESSAGE } from '../../lib/api-client';

/**
 * REGRESSION GUARD — the point of the freemium PR.
 *
 * A hidden feature renders NOTHING. Not a lock icon with an explanation, not a
 * "not on your plan" line, not a link to the website. App Review rejected build
 * 20 under Guideline 2.1(b) for naming purchasable tiers and build 23 under
 * 3.1.1 for the paywall itself; hiding a feature and then explaining why it is
 * hidden re-creates exactly what 3.1.1 rejected.
 *
 * This used to walk a hardcoded twelve-file list and, within those files, only
 * quoted literals CONTAINING A SPACE. Both limits were holes:
 *
 *   - the file list froze at the moment the freemium PR was written, so a line
 *     added to any of the other ~400 source files was invisible to it, and the
 *     failure mode this guard exists for is precisely a well-meaning line added
 *     to a screen later;
 *   - the space requirement was there to skip plan codes being compared
 *     (`=== 'pro'`), but it also skipped every one-word LABEL — `'Upgrade'` on
 *     a button reads as a comparison to this test;
 *   - and a literal scan cannot see JSX text at all, so `<Text>Upgrade</Text>`
 *     passed however it was written.
 *
 * It now walks all of `src/` and scans JSX text nodes alongside string
 * literals. The space requirement is kept for literals only — a bare `'pro'`
 * in TypeScript really is a wire value — and dropped for JSX text, which is
 * rendered by definition.
 */
const MOBILE_SRC = join(__dirname, '..', '..');

/**
 * Words that imply something is for sale. Mirrors the list in
 * `features/chat/chat-knowledge-base.test.ts` and `lib/api-client.test.ts` —
 * the whole app is held to one list, not three.
 */
const FORBIDDEN = [
  'Pro',
  'Edu',
  'Team',
  'Enterprise',
  'Premium',
  'plan',
  'pricing',
  'upgrade',
  'subscription',
  'tier',
  'paid',
  'billing',
  'price',
  'unlock',
  'libertasian.com',
  '$',
  '₱',
];

/**
 * Reviewed exemptions, and the ONLY way past the list above.
 *
 * Widening the walk from twelve files to all of `src/` turned three of the
 * FORBIDDEN entries into ordinary English in places that have nothing to do
 * with purchasing. Each pair below was read and is benign; an exemption is an
 * exact file + exact text match, so a NEW occurrence of the same word in the
 * same file still fails. `expect(ALLOWED).toMatchOccurrences` below deletes
 * the value of a stale one by failing when it stops matching anything.
 */
const ALLOWED: readonly { file: string; text: string }[] = [
  // A firm's colleagues, not the Team plan.
  {
    file: 'app/(onboarding)/index.tsx',
    text: 'Part of a law firm or legal team',
  },
  // Our moderators, not the Team plan.
  {
    file: 'features/feed/components/report-sheet.tsx',
    text: 'Thank you for your report. Our team will review it.',
  },
  // The label for the `team_members_allowed` quota row — a capability the
  // account has, named the way the API names it. It names no purchasable tier.
  { file: 'features/billing/types.ts', text: 'Team Members' },
  // A regex replacement group in a camelCase-to-words helper, not currency.
  { file: 'features/derivatives/renderers/generic-renderer.tsx', text: ' $1' },
];

const isAllowed = (file: string, text: string): boolean =>
  ALLOWED.some((entry) => entry.file === file && entry.text === text);

/**
 * The ONLY directories permitted to name a purchasable thing.
 *
 * Guideline 3.1.2 REQUIRES title, duration and price before purchase, which is
 * the exact opposite of what FORBIDDEN enforces everywhere else. The conflict is
 * resolved by LOCATION: these two trees are the purchase surface and may name a
 * plan and a price; nothing else in src/ may, and the tests below PROVE the
 * confinement rather than assuming it.
 *
 * Adding a third prefix here is a REVIEW GATE, not a routine change.
 */
const PURCHASE_SURFACE_PREFIXES = ['app/purchase/', 'features/purchase/'] as const;

const inPurchaseSurface = (file: string): boolean =>
  PURCHASE_SURFACE_PREFIXES.some((prefix) => file.startsWith(prefix));

/**
 * Every file outside the purchase surface allowed to import from it.
 *
 * A purchase surface reachable from an unguarded screen is a paywall on an
 * unguarded screen, so this list is the review signal: its diff is the whole
 * question. One entry today — the Settings row.
 */
const PERMITTED_PURCHASE_ENTRY_POINTS: readonly string[] = ['app/settings/index.tsx'];

/**
 * Every piece of text this file can put in front of a user.
 *
 * Comments explain the policy and must be free to name it, and identifiers
 * like `billingPeriodEnd` are wire keys the user never reads — so comments are
 * stripped first and only quoted literals and JSX text nodes are returned.
 *
 * The JSX matcher takes what sits between a `>` and the next `<` with no
 * braces or angle brackets in between, which is a literal text node and never
 * an interpolation. `{t.label}` therefore does not match, and neither does
 * markup: an interpolated value is checked wherever it is defined.
 */
function renderableText(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const literals = (withoutComments.match(/(['"])(?:(?!\1|\\).|\\.)*\1/g) ?? [])
    .map((literal) => literal.slice(1, -1))
    // A bare `'pro'` is a plan code being compared, never a sentence rendered
    // to a user. A one-word JSX text node is a different matter — see below.
    .filter((text) => text.includes(' '));

  const jsxText = (withoutComments.match(/>[^<>{}]+</g) ?? [])
    .map((node) => node.slice(1, -1).trim())
    .filter(Boolean);

  return [...literals, ...jsxText];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const matches = (term: string, text: string): boolean =>
  /^[a-z]+$/i.test(term)
    ? new RegExp('\\b' + term + 's?\\b', 'i').test(text)
    : text.includes(term);

/** Repo-relative, forward-slashed, so a failure names a path you can open. */
const relativePath = (file: string): string =>
  relative(MOBILE_SRC, file).split(sep).join('/');

const SOURCE_FILES = walk(MOBILE_SRC);

interface Violation {
  file: string;
  text: string;
  term: string;
}

/**
 * Every FORBIDDEN hit in `src/`, honouring ALLOWED.
 *
 * `skipPurchaseSurface` is the ONE axis of difference between the two tests
 * below: with it, the surface is not read at all (the historical guarantee,
 * unchanged for every other file); without it, the surface is read and its hits
 * are checked for PLACEMENT instead. Sharing the scan means the two can never
 * drift into disagreeing about what counts as a violation.
 */
function allViolations({ skipPurchaseSurface }: { skipPurchaseSurface: boolean }): Violation[] {
  const violations: Violation[] = [];

  for (const file of SOURCE_FILES) {
    const path = relativePath(file);
    if (skipPurchaseSurface && inPurchaseSurface(path)) continue;

    for (const text of renderableText(readFileSync(file, 'utf8'))) {
      if (isAllowed(path, text)) continue;
      for (const term of FORBIDDEN) {
        if (matches(term, text)) violations.push({ file: path, text, term });
      }
    }
  }

  return violations;
}

describe('freemium surfaces name nothing purchasable', () => {
  it('walks the whole of src/, not a fixed file list', () => {
    // A sanity floor: if the walk silently stopped resolving files, every
    // assertion below would pass vacuously.
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
    expect(SOURCE_FILES.map(relativePath)).toContain(
      'features/entitlements/surface-guard.tsx',
    );
  });

  it('renders no purchase-implying copy anywhere in src/', () => {
    // The purchase surface is skipped here and ONLY here. Its content is
    // checked by the confinement test below instead, which reads the same files
    // through the same scanner and asserts where the hits are rather than that
    // there are none.
    expect(allViolations({ skipPurchaseSurface: true })).toEqual([]);
  });

  it('confines every purchase-implying string to the purchase surface', () => {
    // The inverse of the skip above: scan src/ with NO prefix skipping and
    // assert every hit sits inside the purchase surface.
    //
    // This is the test that catches "Upgrade to Pro" appearing on a settings
    // screen. The main test can only report that a file it scanned is clean; it
    // cannot notice a file it was told to skip, and it cannot notice a hit that
    // moved OUT of the surface into a screen with no way to buy. This one names
    // the file.
    const outside = allViolations({ skipPurchaseSurface: false }).filter(
      (violation) => !inPurchaseSurface(violation.file),
    );

    expect(outside).toEqual([]);
  });

  it('keeps the purchase surface non-empty and reachable only through the gate', () => {
    // Two failure modes, both silent:
    //
    //   - a prefix matching no files is a DEAD EXEMPTION. It would sit in the
    //     list looking like a considered decision while protecting nothing, and
    //     the first file added under it would inherit an exemption nobody
    //     re-reviewed.
    //   - a purchase surface imported from an unguarded screen is a paywall on
    //     an unguarded screen. Hiding the Settings row would not help: the
    //     import is the reachability, not the row.
    const files = SOURCE_FILES.map(relativePath).filter(inPurchaseSurface);
    expect(files.length).toBeGreaterThan(0);

    const importers = SOURCE_FILES.map(relativePath)
      .filter((file) => !inPurchaseSurface(file))
      .filter((file) =>
        /@\/(features|app)\/purchase/.test(readFileSync(join(MOBILE_SRC, file), 'utf8')),
      );

    expect(importers).toEqual(PERMITTED_PURCHASE_ENTRY_POINTS);
  });

  it('exempts the purchase surface by LOCATION and nothing else', () => {
    // The exemption must be a prefix match on the path, not a substring one: a
    // file at `features/feed/purchase-banner.tsx` must NOT inherit it, and
    // neither must anything merely containing the word.
    expect(inPurchaseSurface('features/purchase/components/plan-card.tsx')).toBe(true);
    expect(inPurchaseSurface('app/purchase/index.tsx')).toBe(true);
    expect(inPurchaseSurface('features/feed/purchase-banner.tsx')).toBe(false);
    expect(inPurchaseSurface('app/settings/purchase.tsx')).toBe(false);
    expect(inPurchaseSurface('features/entitlements/surface-guard.tsx')).toBe(false);
  });

  it('still catches a purchase string planted outside the surface', () => {
    // The guard on the guard. If `matches` or `renderableText` ever stopped
    // seeing this shape, every assertion above would pass vacuously and the
    // whole file would be decorative.
    expect(
      FORBIDDEN.some((term) => matches(term, 'Upgrade to Pro')),
    ).toBe(true);
  });

  it('keeps every exemption earning its place', () => {
    // A stale exemption is a hole nobody is watching. If the copy it covers is
    // gone or reworded, the entry has to go with it.
    const unmatched = ALLOWED.filter(
      (entry) =>
        !SOURCE_FILES.some(
          (file) =>
            relativePath(file) === entry.file &&
            renderableText(readFileSync(file, 'utf8')).includes(entry.text),
        ),
    );

    expect(unmatched).toEqual([]);
  });

  it('sees a one-word JSX label, which the literal scan could not', () => {
    // The hole this rewrite closes, asserted directly rather than trusted.
    expect(renderableText('<Text>Upgrade</Text>')).toContain('Upgrade');
    expect(renderableText("const label = 'Upgrade';")).not.toContain('Upgrade');
    expect(matches('upgrade', 'Upgrade')).toBe(true);
  });

  // The two refusal strings the hidden surfaces fall back to on the paths that
  // can still 402. Unchanged by this PR, asserted here so a change to them
  // fails alongside the surfaces that depend on them.
  it('leaves the two refusal messages untouched', () => {
    expect(NOT_INCLUDED_MESSAGE).toBe("This isn't available right now.");
    expect(NO_ACCESS_MESSAGE).toBe("You don't have access to this.");
  });
});
