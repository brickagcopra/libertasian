/**
 * The store product identifiers this app may offer.
 *
 * These strings are the SERVER's, not ours. `STORE_PRODUCT_MAP` in
 * `apps/api/src/modules/store-purchases/store-product-map.ts` is the
 * enforcement point: a store event carrying any id absent from that map is
 * recorded and refused, and no id in it resolves to `team` or `enterprise`.
 * Listing them again here is a convenience for the client, never a second
 * source of truth — `products.test.ts` reads the API file off disk and fails if
 * the two lists drift apart.
 *
 * Nothing in this module knows a price, a currency or a period length. Every
 * one of those comes from the store's own localized offering at runtime; see
 * `PurchasePlanOption`.
 */

/** The plans that may be sold in-app. `team` and `enterprise` are web-only. */
export type SellablePlanCode = 'pro' | 'edu';

export type StoreBillingPeriod = 'monthly' | 'annual';

export const STORE_PRODUCT_IDS = [
  'com.libertasian.pro.monthly',
  'com.libertasian.pro.annual',
  'com.libertasian.edu.monthly',
  'com.libertasian.edu.annual',
] as const;

export type StoreProductId = (typeof STORE_PRODUCT_IDS)[number];

export function isStoreProductId(value: string): value is StoreProductId {
  return (STORE_PRODUCT_IDS as readonly string[]).includes(value);
}

/**
 * One purchasable option, as the STORE describes it.
 *
 * Every display field is a string the store handed us, rendered verbatim. That
 * is not a stylistic preference:
 *
 *  - `priceString` is already localized and already carries the right currency
 *    symbol and separators for the viewer's storefront. Formatting a number
 *    ourselves would show the wrong currency to anyone outside PH and would go
 *    stale the moment a price point changes in App Store Connect.
 *  - `duration` likewise. "1 month" is a subscription period the store owns.
 *
 * Guideline 3.1.2(c) requires the title, the duration and the price to be in
 * front of the customer BEFORE they subscribe, which is why all three are
 * required fields rather than optional ones.
 */
export interface PurchasePlanOption {
  productId: StoreProductId;
  /** The store's own product title. */
  title: string;
  /** The store's own subscription period, e.g. "1 month". */
  duration: string;
  /** The store's own localized price, e.g. "₱1,699.00". Rendered as given. */
  priceString: string;
  /** Optional store-supplied blurb. Never written by us. */
  description?: string;
}
