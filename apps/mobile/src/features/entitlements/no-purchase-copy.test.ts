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
    const violations: { file: string; text: string; term: string }[] = [];

    for (const file of SOURCE_FILES) {
      const path = relativePath(file);
      for (const text of renderableText(readFileSync(file, 'utf8'))) {
        if (isAllowed(path, text)) continue;
        for (const term of FORBIDDEN) {
          if (matches(term, text)) violations.push({ file: path, text, term });
        }
      }
    }

    expect(violations).toEqual([]);
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
