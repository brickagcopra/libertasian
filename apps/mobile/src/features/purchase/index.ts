/**
 * The purchase surface.
 *
 * `no-purchase-copy.test.ts` exempts this tree (and `app/purchase/`) from the
 * FORBIDDEN word list BY LOCATION, and asserts the confinement in both
 * directions. Importing from here anywhere outside those two trees is a
 * REVIEW GATE, not a routine change: the importer list is pinned in that test
 * as `PERMITTED_PURCHASE_ENTRY_POINTS`.
 */

export { PURCHASE_ROUTE, PURCHASE_PRIVACY_ROUTE, PURCHASE_TERMS_ROUTE } from './routes';
export {
  STORE_PRODUCT_IDS,
  isStoreProductId,
  type PurchasePlanOption,
  type SellablePlanCode,
  type StoreBillingPeriod,
  type StoreProductId,
} from './products';
export { PlanCard, type PlanCardProps } from './components/plan-card';
export {
  PurchaseEntryPoint,
  type PurchaseEntryPointProps,
} from './components/purchase-entry-point';
export {
  PurchaseSurface,
  type PurchaseSurfaceProps,
  type PurchaseSurfaceStatus,
} from './components/purchase-surface';
export {
  usePurchaseOptions,
  RESTORE_NOTHING_NOTICE,
  UNCONFIRMED_NOTICE,
  type PurchaseOptions,
} from './hooks/use-purchase-options';
export { useOfferings, packageFor, offeringKeys, type OfferingsResult } from './hooks/use-offerings';
export { configurePurchases, getPurchases } from './lib/purchases-sdk';
export { syncPurchasesWithServer, type StoreSyncOutcome } from './lib/store-sync';
