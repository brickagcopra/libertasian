import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * The purchase surface is exempt from the FORBIDDEN word list. It is NOT exempt
 * from Guideline 3.1.1.
 *
 * Naming a plan and a price on this screen is required (3.1.2(c)). Offering any
 * way to pay that is not the store's own in-app purchase — a link to the
 * website, a mention of web pricing, an email to sales, a promo code field — is
 * what got build 23 rejected, and it is the exact thing the D13 exemption could
 * accidentally let through, because the word list no longer applies here.
 *
 * So the exemption comes with this: a scan of the same two trees for the
 * OPPOSITE mistake.
 */
const MOBILE_SRC = join(__dirname, '..', '..');

const PURCHASE_SURFACE_DIRS = [
  join(MOBILE_SRC, 'app', 'purchase'),
  join(MOBILE_SRC, 'features', 'purchase'),
];

/**
 * Ways off the app, and ways to pay that are not the store's.
 *
 * `libertasian.com` and `http` catch the website and any URL. `Linking` and
 * `WebBrowser` catch opening one without writing the URL down. The rest catch
 * copy that points at an off-app purchase without linking to it, which
 * Guideline 3.1.3's anti-steering rule treats the same way.
 */
const FORBIDDEN_IN_SURFACE = [
  'libertasian.com',
  'http://',
  'https://',
  'Linking',
  'WebBrowser',
  'openURL',
  'our website',
  'on the web',
  'web pricing',
  'promo code',
  'coupon',
  'credit card',
  'PayPal',
  'GCash',
  'Xendit',
  'PayMongo',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const SURFACE_FILES = PURCHASE_SURFACE_DIRS.flatMap(walk);

const relativePath = (file: string): string =>
  relative(MOBILE_SRC, file).split(sep).join('/');

describe('the purchase surface offers no way to pay outside the store', () => {
  it('finds the purchase surface at all', () => {
    // Without this, every assertion below passes against an empty file list.
    expect(SURFACE_FILES.length).toBeGreaterThan(0);
    expect(SURFACE_FILES.map(relativePath)).toContain('app/purchase/index.tsx');
  });

  it('contains no URL, no browser call and no off-app payment route', () => {
    const violations: { file: string; term: string }[] = [];

    for (const file of SURFACE_FILES) {
      // Comments explain the policy and must be free to name the thing they
      // forbid — this file's own guidance would otherwise trip it.
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      for (const term of FORBIDDEN_IN_SURFACE) {
        if (source.toLowerCase().includes(term.toLowerCase())) {
          violations.push({ file: relativePath(file), term });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('hardcodes no price, currency symbol or period string', () => {
    // Every one of these arrives from the store's localized offering at
    // runtime. A literal here would show the wrong currency outside PH and go
    // stale the moment a price point moves in App Store Connect.
    const violations: { file: string; match: string }[] = [];

    for (const file of SURFACE_FILES) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

      // A currency symbol, or a bare number that reads like money.
      for (const match of source.match(/[₱$€£]\s?[\d,]+|\b\d{3,}(?:[.,]\d{2})\b/g) ?? []) {
        violations.push({ file: relativePath(file), match });
      }
      // "per month", "/mo", "a year" — period strings belong to the store.
      for (const match of source.match(/\bper (?:month|year)\b|\/\s?(?:mo|yr)\b/gi) ?? []) {
        violations.push({ file: relativePath(file), match });
      }
    }

    expect(violations).toEqual([]);
  });

  it('would catch a price if one were added', () => {
    // The guard on the guard: the regex above must actually match money.
    expect('₱1,699.00'.match(/[₱$€£]\s?[\d,]+/)).not.toBeNull();
    expect('999.00'.match(/\b\d{3,}(?:[.,]\d{2})\b/)).not.toBeNull();
    expect('per month'.match(/\bper (?:month|year)\b/i)).not.toBeNull();
  });
});
