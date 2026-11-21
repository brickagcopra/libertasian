/**
 * Store product id → plan, as typed config rather than a table. See D7.
 *
 * Four rows, changed only when a product is created in App Store Connect or
 * Play Console — itself a manual act. A table would add a migration, a seed and
 * an admin surface to manage four constants, and would turn the "`pro` and
 * `edu` only" guarantee into a runtime data question instead of a compile-time
 * one.
 *
 * Promoting this to a table later is a pure add: the map becomes the seed.
 */

/**
 * The plans that may be sold as IAP.
 *
 * `team` and `enterprise` are absent BY DESIGN and adding either is a compile
 * error, not a config change. That is the whole reason this is a narrow named
 * union and not `string`.
 */
export type SellablePlanCode = 'pro' | 'edu';

export type StoreBillingPeriod = 'monthly' | 'annual';

export interface StoreProductDefinition {
  planCode: SellablePlanCode;
  billingPeriod: StoreBillingPeriod;
}

export const STORE_PRODUCT_MAP = {
  'com.libertasian.pro.monthly': { planCode: 'pro', billingPeriod: 'monthly' },
  'com.libertasian.pro.annual': { planCode: 'pro', billingPeriod: 'annual' },
  'com.libertasian.edu.monthly': { planCode: 'edu', billingPeriod: 'monthly' },
  'com.libertasian.edu.annual': { planCode: 'edu', billingPeriod: 'annual' },
} as const satisfies Record<string, StoreProductDefinition>;

export type StoreProductId = keyof typeof STORE_PRODUCT_MAP;

/** Every product id we are willing to honour, for the purchase-intent response. */
export const STORE_PRODUCT_IDS = Object.keys(STORE_PRODUCT_MAP) as StoreProductId[];

/**
 * Resolve a product id to its plan, or `null` if it is not one of ours.
 *
 * A `null` here is the enforcement point for "only `pro` and `edu` are sold as
 * IAP": there is no product id in the map that resolves to `team` or
 * `enterprise`, so no store event — however malformed or hostile — can unlock
 * them. An unmapped product is RECORDED AND REFUSED; it never grants anything.
 *
 * This map does not, and cannot, enforce student eligibility for `edu`. It maps
 * a product id to a plan; it has no idea who tapped Buy. That is accepted
 * rather than unresolved — `edu` ships ungated, and nothing was gating it on
 * the web either. If a gate is ever wanted, it goes in
 * `PlansService.checkEligibility()`, not here.
 */
export function resolveStoreProduct(
  productId: string | null | undefined,
): StoreProductDefinition | null {
  if (!productId) return null;

  const direct = lookup(productId);
  if (direct) return direct;

  // Google Play Billing 5+ names a subscription `<subscriptionId>:<basePlanId>`
  // and RevenueCat's webhook `product_id` carries it verbatim, so a Play
  // purchase of `com.libertasian.pro.monthly` arrives as
  // `com.libertasian.pro.monthly:monthly`. The base plan id must equal the
  // product's own billing period: any other base plan (a promo plan, or an
  // annual plan added under a monthly subscription by mistake) is refused
  // rather than granted under the wrong period. The mobile client's
  // `toStoreProductId` applies the same rule.
  const separator = productId.indexOf(':');
  if (separator === -1) return null;
  const definition = lookup(productId.slice(0, separator));
  if (!definition) return null;
  return productId.slice(separator + 1) === definition.billingPeriod ? definition : null;
}

function lookup(productId: string): StoreProductDefinition | null {
  // `Object.hasOwn`, not a bare index. A plain object lookup walks the
  // prototype chain, so a hostile `product_id` of `constructor`, `toString` or
  // `__proto__` would return a truthy non-definition — and the caller would
  // then read `planCode` off it as `undefined` and create a subscription on a
  // plan that does not exist. An own-key check is the whole fix.
  if (!Object.hasOwn(STORE_PRODUCT_MAP, productId)) return null;
  return (STORE_PRODUCT_MAP as Record<string, StoreProductDefinition>)[productId] ?? null;
}
