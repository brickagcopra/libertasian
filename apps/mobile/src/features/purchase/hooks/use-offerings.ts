import { useQuery } from '@tanstack/react-query';

import {
  getPurchases,
  type PurchasesPackage,
  type PurchasesStoreProduct,
} from '../lib/purchases-sdk';
import {
  STORE_PRODUCT_IDS,
  isStoreProductId,
  type PurchasePlanOption,
  type StoreProductId,
} from '../products';

export const offeringKeys = {
  all: ['store-offerings'] as const,
  current: () => [...offeringKeys.all, 'current'] as const,
};

/** Which question the options on screen came from. */
export type OfferingsSource = 'offering' | 'products';

/**
 * Why there is nothing to sell. Machine values — never rendered, never
 * translated. The screen says one sentence for all of them; these exist so we
 * can tell the causes apart in telemetry, which is precisely what we could not
 * do when App Review saw an empty purchase screen.
 *
 *  - `no_sdk`               — this binary has no `react-native-purchases`, or
 *                             no RevenueCat key. A build fact.
 *  - `offering_null`        — RevenueCat served no current offering AND the
 *                             store returned no products. Nothing anywhere.
 *  - `no_matching_packages` — the store or the offering DID return products,
 *                             and none of them is one of ours (or none is
 *                             renderable). A dashboard / App Store Connect fact.
 *  - `products_empty`       — an offering existed but carried nothing, and the
 *                             direct store fetch came back empty. This is the
 *                             StoreKit failure that produced the rejection.
 */
export type OfferingsUnavailableReason =
  | 'no_sdk'
  | 'offering_null'
  | 'no_matching_packages'
  | 'products_empty';

/**
 * Thrown when NEITHER path yields a usable plan.
 *
 * THROWING IS THE POINT. This used to resolve to `{ plans: [], ... }`, which
 * React Query cached as a SUCCESS for the full 5-minute `staleTime` — so a
 * single unlucky store fetch turned the purchase screen into a dead end that
 * would not retry itself for five minutes, no matter what the user did. That is
 * the shape of the 2.1(b) rejection. An error result retries, can be refetched
 * by hand, and is never mistaken for "the store says there is nothing".
 */
export class OfferingsUnavailableError extends Error {
  readonly reason: OfferingsUnavailableReason;
  /** Every product id the store DID mention, for telemetry. Often empty. */
  readonly rawProductIds: string[];

  constructor(reason: OfferingsUnavailableReason, rawProductIds: string[] = []) {
    super(`store offerings unavailable: ${reason}`);
    this.name = 'OfferingsUnavailableError';
    this.reason = reason;
    this.rawProductIds = rawProductIds;
  }
}

export interface OfferingsResult {
  plans: PurchasePlanOption[];
  /** The SDK package behind each option, needed to actually buy it. */
  packagesByProductId: Record<string, PurchasesPackage>;
  /** The raw store product behind each option, on the fallback path. */
  productsByProductId: Record<string, PurchasesStoreProduct>;
  /** Which path produced `plans`. Decides how `purchase()` buys. */
  source: OfferingsSource;
}

/** The fields we read off a store product, from either path. */
interface StoreProductLike {
  identifier: string;
  title: string;
  priceString: string;
  subscriptionPeriod?: string | null;
  description?: string | null;
}

/**
 * The store's own description of one option.
 *
 * `title` and `priceString` come from the store verbatim. Neither is derived,
 * defaulted or formatted here — see `durationFor` for the one field that
 * needed a decision.
 */
function toPlanOption(product: StoreProductLike): PurchasePlanOption | null {
  const productId = product.identifier;
  if (!isStoreProductId(productId)) return null;

  const duration = durationFor(productId, product.subscriptionPeriod);
  // A blank price is a 3.1.2(c) violation — the price must be in front of the
  // customer BEFORE they subscribe — so a product with no price string is
  // still dropped. A MISSING PERIOD IS NOT that violation, and no longer drops
  // anything; see `durationFor`.
  if (!product.priceString || !duration) return null;

  return {
    productId,
    title: product.title,
    duration,
    priceString: product.priceString,
    ...(product.description ? { description: product.description } : {}),
  };
}

/**
 * The subscription period, as a string to render.
 *
 * PRIMARY SOURCE: the store's `subscriptionPeriod`, an ISO 8601 duration
 * (`P1M`, `P1Y`) — a machine value, not something to put in front of a user.
 *
 * FALLBACK: the product id's own suffix. This is the change that matters. The
 * field is `string | null` in the SDK's own types, it is genuinely absent on a
 * raw `getProducts()` result on some StoreKit paths, and dropping a card over
 * it meant an otherwise complete, correctly-priced plan vanished from the
 * screen — which is how a purchase surface ends up empty in front of a
 * reviewer. The suffix is not a guess: `productId` has already been narrowed to
 * `StoreProductId`, four ids we own, and the server's `STORE_PRODUCT_MAP` maps
 * the same four suffixes to the same two periods.
 *
 * Nothing else is derived. In particular the PRICE is never computed from the
 * period — no "per month" arithmetic on an annual plan, which would produce a
 * number the store never quoted.
 */
function durationFor(
  productId: StoreProductId,
  subscriptionPeriod: string | null | undefined,
): string | null {
  switch (subscriptionPeriod) {
    case 'P1M':
      return '1 month';
    case 'P1Y':
      return '1 year';
    default:
      break;
  }

  if (productId.endsWith('.monthly')) return '1 month';
  if (productId.endsWith('.annual')) return '1 year';
  return null;
}

/**
 * Order by `STORE_PRODUCT_IDS`, never by the store's own ordering, so the
 * surface does not silently rearrange when someone edits the dashboard.
 */
function plansFor(
  productsByProductId: Record<string, StoreProductLike>,
): PurchasePlanOption[] {
  return STORE_PRODUCT_IDS.map((id) => productsByProductId[id])
    .filter((product): product is StoreProductLike => product !== undefined)
    .map(toPlanOption)
    .filter((plan): plan is PurchasePlanOption => plan !== null);
}

/**
 * The plans this app may sell, from whichever source can answer.
 *
 * FILTERS BY PRODUCT ID on both paths, always. A RevenueCat offering is
 * dashboard-configured and can contain anything someone added there; the four
 * ids in `STORE_PRODUCT_IDS` are the server's `STORE_PRODUCT_MAP` and the
 * server refuses everything else. Rendering an unmapped product would offer the
 * user a purchase that gets taken by the store and then declined by us — the
 * one failure mode with no clean resolution.
 *
 * TWO PATHS, in order:
 *
 *  1. `getOfferings()`, the configured offering. Preferred: RevenueCat's
 *     packages carry the offering context the dashboard reports on.
 *  2. `getProducts(STORE_PRODUCT_IDS)`, the store asked directly. Reached only
 *     when path 1 yields nothing usable. An offering is a RevenueCat object
 *     built on top of a store fetch, and it can be empty for reasons the raw
 *     fetch is not — a dashboard offering someone renamed, a product not yet
 *     attached to it, a cold RevenueCat cache. Asking the store itself is the
 *     second, independent question this screen never used to ask.
 *
 * If both come back empty this THROWS. See `OfferingsUnavailableError`.
 */
export function useOfferings(enabled = true) {
  return useQuery<OfferingsResult>({
    queryKey: offeringKeys.current(),
    enabled,
    queryFn: async (): Promise<OfferingsResult> => {
      const purchases = getPurchases();
      if (!purchases) throw new OfferingsUnavailableError('no_sdk');

      // ---- path 1: the configured offering ----
      const { current } = await purchases.getOfferings();
      const offeringProductIds: string[] = [];
      const packagesByProductId: Record<string, PurchasesPackage> = {};

      for (const pkg of current?.availablePackages ?? []) {
        offeringProductIds.push(pkg.product.identifier);
        if (isStoreProductId(pkg.product.identifier)) {
          packagesByProductId[pkg.product.identifier] = pkg;
        }
      }

      const offeringProducts: Record<string, StoreProductLike> = {};
      for (const [id, pkg] of Object.entries(packagesByProductId)) {
        offeringProducts[id] = pkg.product;
      }

      const offeringPlans = plansFor(offeringProducts);
      if (offeringPlans.length > 0) {
        return {
          plans: offeringPlans,
          packagesByProductId,
          productsByProductId: {},
          source: 'offering',
        };
      }

      // ---- path 2: the store, asked directly ----
      const products = (await purchases.getProducts([...STORE_PRODUCT_IDS])) ?? [];

      const productsByProductId: Record<string, PurchasesStoreProduct> = {};
      for (const product of products) {
        if (isStoreProductId(product.identifier)) {
          productsByProductId[product.identifier] = product;
        }
      }

      const productPlans = plansFor(productsByProductId);
      if (productPlans.length > 0) {
        return {
          plans: productPlans,
          packagesByProductId: {},
          productsByProductId,
          source: 'products',
        };
      }

      const rawProductIds = [
        ...new Set([
          ...offeringProductIds,
          ...products.map((product) => product.identifier),
        ]),
      ];

      throw new OfferingsUnavailableError(
        unavailableReason({
          offeringWasNull: !current,
          offeringProductIds,
          productCount: products.length,
        }),
        rawProductIds,
      );
    },
    // The offering changes only when someone edits it in the dashboard. Long
    // stale time; a wrong price for five minutes is not a risk, and refetching
    // on every mount would hit the store on every screen open. Nothing empty is
    // ever cached under it any more — that path throws.
    staleTime: 5 * 60 * 1000,
    // A store fetch is a network call to StoreKit / Play Billing on a device
    // that may have just come off a lock screen, and the observed failure was
    // transient: RevenueCat served all four products correctly at the moment
    // the device saw none. One retry was not enough to ride that out.
    retry: 3,
    retryDelay: (failureCount) => Math.min(1000 * 2 ** failureCount, 8000),
  });
}

/**
 * Which of the four reasons to report, when everything came back empty.
 *
 * Read in order: whatever DID come back is more informative than what did not.
 */
function unavailableReason({
  offeringWasNull,
  offeringProductIds,
  productCount,
}: {
  offeringWasNull: boolean;
  offeringProductIds: string[];
  productCount: number;
}): OfferingsUnavailableReason {
  // Something answered with products; none of them is ours, or none renderable.
  if (productCount > 0 || offeringProductIds.length > 0) {
    return 'no_matching_packages';
  }
  // Nothing answered at all, and RevenueCat had no offering to serve.
  if (offeringWasNull) return 'offering_null';
  // An offering existed but was empty, and the store itself returned nothing.
  return 'products_empty';
}

/** Resolve the SDK package to purchase for a product id, if we have it. */
export function packageFor(
  result: OfferingsResult | undefined,
  productId: StoreProductId,
): PurchasesPackage | null {
  return result?.packagesByProductId[productId] ?? null;
}

/** Resolve the raw store product to purchase, on the `products` path. */
export function productFor(
  result: OfferingsResult | undefined,
  productId: StoreProductId,
): PurchasesStoreProduct | null {
  return result?.productsByProductId[productId] ?? null;
}
