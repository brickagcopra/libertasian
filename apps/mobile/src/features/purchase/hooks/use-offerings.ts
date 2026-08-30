import { useQuery } from '@tanstack/react-query';

import { getPurchases, type PurchasesPackage } from '../lib/purchases-sdk';
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

export interface OfferingsResult {
  plans: PurchasePlanOption[];
  /** The SDK package behind each option, needed to actually buy it. */
  packagesByProductId: Record<string, PurchasesPackage>;
}

const EMPTY: OfferingsResult = { plans: [], packagesByProductId: {} };

/**
 * The store's own description of one package.
 *
 * `title`, `priceString` and the period all come from `package.product`. None
 * of them is derived, defaulted or formatted here — see `subscriptionPeriod`
 * below for the one place that needed a decision.
 */
function toPlanOption(pkg: PurchasesPackage): PurchasePlanOption | null {
  const productId = pkg.product.identifier;
  if (!isStoreProductId(productId)) return null;

  const duration = subscriptionPeriod(pkg);
  // A package with no price string or no period is not renderable: the card
  // requires all three fields, because 3.1.2(c) requires all three on screen.
  // Dropping it is right — showing a plan with a blank price is the violation.
  if (!pkg.product.priceString || !duration) return null;

  return {
    productId,
    title: pkg.product.title,
    duration,
    priceString: pkg.product.priceString,
    ...(pkg.product.description ? { description: pkg.product.description } : {}),
  };
}

/**
 * The subscription period, as a string to render.
 *
 * The SDK gives `subscriptionPeriod` as an ISO 8601 duration (`P1M`, `P1Y`) —
 * a machine value, not something to put in front of a user. Turning it into
 * words is the ONE piece of display text this client produces, and it is
 * confined to the two periods we actually sell: `STORE_PRODUCT_MAP` has only
 * monthly and annual products, so anything else is a product we did not
 * configure and must not render as a guess.
 *
 * Nothing else is derived. In particular the PRICE is never computed from the
 * period — no "per month" arithmetic on an annual plan, which would produce a
 * number the store never quoted.
 */
function subscriptionPeriod(pkg: PurchasesPackage): string | null {
  switch (pkg.product.subscriptionPeriod) {
    case 'P1M':
      return '1 month';
    case 'P1Y':
      return '1 year';
    default:
      return null;
  }
}

/**
 * The current offering, mapped onto the four product ids we sell.
 *
 * FILTERS BY PRODUCT ID, always. A RevenueCat offering is dashboard-configured
 * and can contain anything someone added there; the four ids in
 * `STORE_PRODUCT_IDS` are the server's `STORE_PRODUCT_MAP` and the server
 * refuses everything else. Rendering an unmapped package would offer the user a
 * purchase that gets taken by the store and then declined by us — the one
 * failure mode with no clean resolution.
 *
 * Ordered by `STORE_PRODUCT_IDS` rather than by the offering, so the surface
 * does not silently reorder when someone rearranges the dashboard.
 */
export function useOfferings(enabled = true) {
  return useQuery<OfferingsResult>({
    queryKey: offeringKeys.current(),
    enabled,
    queryFn: async (): Promise<OfferingsResult> => {
      const purchases = getPurchases();
      if (!purchases) return EMPTY;

      const { current } = await purchases.getOfferings();
      if (!current) return EMPTY;

      const packagesByProductId: Record<string, PurchasesPackage> = {};
      for (const pkg of current.availablePackages) {
        if (isStoreProductId(pkg.product.identifier)) {
          packagesByProductId[pkg.product.identifier] = pkg;
        }
      }

      const plans = STORE_PRODUCT_IDS.map((id) => packagesByProductId[id])
        .filter((pkg): pkg is PurchasesPackage => pkg !== undefined)
        .map(toPlanOption)
        .filter((plan): plan is PurchasePlanOption => plan !== null);

      return { plans, packagesByProductId };
    },
    // The offering changes only when someone edits it in the dashboard. Long
    // stale time; a wrong price for five minutes is not a risk, and refetching
    // on every mount would hit the store on every screen open.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/** Resolve the SDK package to purchase for a product id, if we have it. */
export function packageFor(
  result: OfferingsResult | undefined,
  productId: StoreProductId,
): PurchasesPackage | null {
  return result?.packagesByProductId[productId] ?? null;
}
