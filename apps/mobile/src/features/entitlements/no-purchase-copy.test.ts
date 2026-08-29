import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

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
 * This walks the string literals of every source file the freemium work
 * introduced or touched, rather than asserting on one module, because the
 * failure mode is a well-meaning line added to a screen later.
 */
const MOBILE_SRC = join(__dirname, '..', '..');

/** Files this PR introduced or changed. */
const GUARDED_FILES = [
  'features/entitlements/use-freemium-surfaces.ts',
  'features/entitlements/surface-guard.tsx',
  'features/entitlements/test-helpers.ts',
  'app/scan/_layout.tsx',
  'app/study/_layout.tsx',
  'app/bar-exams/_layout.tsx',
  'components/ui/TabBar.tsx',
  'app/(tabs)/_layout.tsx',
  'app/(tabs)/study.tsx',
  'app/documents/index.tsx',
  'app/settings/index.tsx',
  'lib/api-client.ts',
];

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
 * Only user-visible text is in scope. Comments explain the policy and must be
 * free to name it; identifiers like `billingPeriodEnd` are wire keys the user
 * never reads. So: strip block and line comments, then look at string literals
 * only, and only ones containing a space — a bare `'pro'` is a plan code being
 * compared, never a sentence rendered to a user.
 */
function renderableStrings(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const literals = withoutComments.match(/(['"])(?:(?!\1|\\).|\\.)*\1/g) ?? [];
  return literals
    .map((literal) => literal.slice(1, -1))
    .filter((text) => text.includes(' '));
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

describe('freemium surfaces name nothing purchasable', () => {
  it.each(GUARDED_FILES)('%s renders no purchase-implying copy', (relative) => {
    const source = readFileSync(join(MOBILE_SRC, relative), 'utf8');

    for (const text of renderableStrings(source)) {
      for (const term of FORBIDDEN) {
        expect({ relative, text, term, hit: matches(term, text) }).toEqual({
          relative,
          text,
          term,
          hit: false,
        });
      }
    }
  });

  it('covers the whole entitlements feature, not just the listed files', () => {
    for (const file of walk(join(MOBILE_SRC, 'features', 'entitlements'))) {
      for (const text of renderableStrings(readFileSync(file, 'utf8'))) {
        for (const term of FORBIDDEN) {
          expect({ file, text, term, hit: matches(term, text) }).toEqual({
            file,
            text,
            term,
            hit: false,
          });
        }
      }
    }
  });

  // The two refusal strings the hidden surfaces fall back to on the paths that
  // can still 402. Unchanged by this PR, asserted here so a change to them
  // fails alongside the surfaces that depend on them.
  it('leaves the two refusal messages untouched', () => {
    expect(NOT_INCLUDED_MESSAGE).toBe("This isn't available right now.");
    expect(NO_ACCESS_MESSAGE).toBe("You don't have access to this.");
  });
});
