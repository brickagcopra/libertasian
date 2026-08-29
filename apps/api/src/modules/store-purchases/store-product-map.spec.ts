/**
 * D7 — the map is the enforcement point for "only `pro` and `edu` are sold as
 * IAP".
 *
 * These tests are cheap and the guarantee they protect is not: an entry that
 * resolved to `team` or `enterprise` would make a web-and-sales-only tier
 * purchasable from a phone, and the mobile build must name nothing purchasable
 * outside the purchase surface at all.
 */

import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
  resolveStoreProduct,
  STORE_PRODUCT_IDS,
  STORE_PRODUCT_MAP,
} from './store-product-map';

describe('STORE_PRODUCT_MAP (D7)', () => {
  it('sells exactly four products', () => {
    expect(STORE_PRODUCT_IDS).toEqual([
      'com.libertasian.pro.monthly',
      'com.libertasian.pro.annual',
      'com.libertasian.edu.monthly',
      'com.libertasian.edu.annual',
    ]);
  });

  it('resolves every product to pro or edu, and to nothing else', () => {
    for (const definition of Object.values(STORE_PRODUCT_MAP)) {
      expect(['pro', 'edu']).toContain(definition.planCode);
      expect(['monthly', 'annual']).toContain(definition.billingPeriod);
    }
  });

  it('has no entry that resolves to team or enterprise', () => {
    // The structural guarantee. `SellablePlanCode` makes adding one a COMPILE
    // error; this is the runtime restatement, so a cast or a widened type
    // cannot smuggle one in unnoticed.
    const planCodes = Object.values(STORE_PRODUCT_MAP).map((d) => d.planCode);
    expect(planCodes).not.toContain('team');
    expect(planCodes).not.toContain('enterprise');
    expect(planCodes).not.toContain('free');
  });

  it('names plan codes the entitlement resolver actually knows', () => {
    // A typo'd plan code would create a subscription that resolves to the free
    // fallback — a paying subscriber silently entitled to nothing. Checked
    // against getDefaultEntitlements, which §13.4 records as the LIVE source of
    // truth while the `billing.db_plans` flag is off, rather than against a
    // literal repeated here.
    const resolver = new SubscriptionsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const free = resolver.getDefaultEntitlements('free');

    for (const definition of Object.values(STORE_PRODUCT_MAP)) {
      const entitlements = resolver.getDefaultEntitlements(definition.planCode);
      expect(entitlements).not.toEqual(free);
    }
  });

  it('refuses anything absent from the map, so an unmapped product grants nothing', () => {
    for (const productId of [
      'com.libertasian.team.monthly',
      'com.libertasian.enterprise.annual',
      'com.libertasian.pro.weekly',
      'com.libertasian.pro.monthly ',
      'COM.LIBERTASIAN.PRO.MONTHLY',
      '',
      null,
      undefined,
    ]) {
      expect(resolveStoreProduct(productId)).toBeNull();
    }
  });

  it('matches product ids exactly, with no prefix or substring matching', () => {
    // A prefix match would make `com.libertasian.pro.monthly.evil` resolve.
    expect(resolveStoreProduct('com.libertasian.pro.monthly.evil')).toBeNull();
    expect(resolveStoreProduct('libertasian.pro.monthly')).toBeNull();
  });

  it('cannot be tricked by a prototype-chain key', () => {
    // A bare object lookup would return Object.prototype members for keys like
    // `constructor` or `toString`, which would then be used as a plan.
    for (const productId of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(resolveStoreProduct(productId)).toBeNull();
    }
  });
});
