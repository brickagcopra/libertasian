import { readFileSync } from 'fs';
import { join } from 'path';

import { STORE_PRODUCT_IDS, isStoreProductId, toStoreProductId } from './products';

/**
 * The API's map is the enforcement point; this list is a convenience copy.
 *
 * A convenience copy that can drift is worse than no copy: the client would
 * offer a product id the server refuses, and the user would be charged by the
 * store for something we then decline to grant. So the test reads the API file
 * off disk and compares, rather than restating the four strings a third time.
 */
const API_PRODUCT_MAP = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'api',
  'src',
  'modules',
  'store-purchases',
  'store-product-map.ts',
);

function apiProductIds(): string[] {
  const source = readFileSync(API_PRODUCT_MAP, 'utf8');
  const body = source.slice(
    source.indexOf('export const STORE_PRODUCT_MAP'),
    source.indexOf('} as const satisfies'),
  );
  return [...body.matchAll(/'(com\.libertasian\.[a-z.]+)'/g)].map((match) => match[1]!);
}

describe('store product ids', () => {
  it('matches STORE_PRODUCT_MAP in the API, exactly and in order', () => {
    expect([...STORE_PRODUCT_IDS]).toEqual(apiProductIds());
  });

  it('reads a non-empty list out of the API file', () => {
    // If the slice above ever stopped matching — the map renamed, the file
    // moved — the comparison would pass vacuously against two empty arrays.
    expect(apiProductIds()).toHaveLength(4);
  });

  it('offers pro and edu only, never team or enterprise', () => {
    // The structural guarantee, restated on the client. The server refuses an
    // unmapped id anyway; this fails at test time instead of at purchase time.
    for (const id of STORE_PRODUCT_IDS) {
      expect(id).toMatch(/^com\.libertasian\.(pro|edu)\.(monthly|annual)$/);
    }
    expect(STORE_PRODUCT_IDS.join(' ')).not.toContain('team');
    expect(STORE_PRODUCT_IDS.join(' ')).not.toContain('enterprise');
  });

  it('rejects anything not in the list', () => {
    expect(isStoreProductId('com.libertasian.pro.monthly')).toBe(true);
    expect(isStoreProductId('com.libertasian.team.monthly')).toBe(false);
    expect(isStoreProductId('com.libertasian.enterprise.annual')).toBe(false);
    expect(isStoreProductId('com.libertasian.pro.weekly')).toBe(false);
    expect(isStoreProductId('')).toBe(false);
  });

  describe('toStoreProductId', () => {
    it('passes the bare (App Store) ids through', () => {
      for (const id of STORE_PRODUCT_IDS) expect(toStoreProductId(id)).toBe(id);
    });

    it('maps Play `<subscriptionId>:<basePlanId>` ids to the canonical id', () => {
      expect(toStoreProductId('com.libertasian.pro.monthly:monthly')).toBe(
        'com.libertasian.pro.monthly',
      );
      expect(toStoreProductId('com.libertasian.edu.annual:annual')).toBe(
        'com.libertasian.edu.annual',
      );
    });

    it('refuses a base plan that does not match the billing period', () => {
      expect(toStoreProductId('com.libertasian.pro.monthly:annual')).toBeNull();
      expect(toStoreProductId('com.libertasian.pro.monthly:promo')).toBeNull();
      expect(toStoreProductId('com.libertasian.pro.monthly:')).toBeNull();
      expect(toStoreProductId('com.libertasian.pro.monthly:monthly:x')).toBeNull();
    });

    it('refuses ids that are not ours, with or without a base plan', () => {
      expect(toStoreProductId('com.libertasian.team.monthly:monthly')).toBeNull();
      expect(toStoreProductId('rc_lifetime')).toBeNull();
      expect(toStoreProductId(':monthly')).toBeNull();
      expect(toStoreProductId('')).toBeNull();
    });
  });
});
