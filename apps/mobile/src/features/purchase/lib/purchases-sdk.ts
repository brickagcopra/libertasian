import type {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';

import { getRevenueCatKey } from '../purchase-env';

/**
 * The ONLY module that touches `react-native-purchases`.
 *
 * LAZY REQUIRE, deliberately. `react-native-purchases` resolves its native
 * module at IMPORT time, so a top-level `import Purchases from ...` throws on
 * any binary that does not contain it — every Expo Go session, every test
 * runner, and any older build that reaches this code through a JS update. That
 * failure mode has bitten this app before with
 * `@react-native-google-signin/google-signin`, which is why the pattern is
 * repeated rather than reinvented.
 *
 * Everything here returns a NEUTRAL value rather than throwing when the SDK or
 * the key is absent. "No store" is an ordinary state on this app — no
 * RevenueCat project is configured yet — and it must render as "unavailable",
 * never as an error.
 */

/** Narrow structural view of the SDK, so nothing else imports its types. */
interface PurchasesModule {
  configure(options: { apiKey: string; appUserID?: string | null }): void;
  logIn(appUserID: string): Promise<{ customerInfo: CustomerInfo }>;
  logOut(): Promise<CustomerInfo>;
  getOfferings(): Promise<{ current: PurchasesOffering | null }>;
  purchasePackage(pkg: PurchasesPackage): Promise<{ customerInfo: CustomerInfo }>;
  restorePurchases(): Promise<CustomerInfo>;
  /**
   * The store's own answer to "what does this account own right now?".
   *
   * Needed because `purchasePackage()` REJECTS on outcomes that are not
   * failures — most importantly `PRODUCT_ALREADY_PURCHASED`, raised when a user
   * taps a plan the store already sold them. Asking the store afterwards is how
   * we tell "this did not go through" apart from "this was already yours",
   * without pattern-matching error codes or message text.
   */
  getCustomerInfo(): Promise<CustomerInfo>;
}

/**
 * Does the store consider this account entitled?
 *
 * The store, not our server, is the authority on whether a purchase COMPLETED —
 * App Review buys in the sandbox, and the API deliberately ignores sandbox
 * events in production (D10), so `/store/sync` answers `in_sync` for a purchase
 * that genuinely succeeded. Deciding completion from the server's answer is what
 * showed "we could not confirm that" on a working purchase and drew the 2.1(b)
 * rejection. The server remains the authority on the ENTITLEMENT itself.
 *
 * Total on purpose: `CustomerInfo` arrives from a native bridge, and a partial
 * or absent object must read as "not entitled", never throw.
 */
export function hasActiveEntitlement(
  info: CustomerInfo | null | undefined,
): boolean {
  return Object.keys(info?.entitlements?.active ?? {}).length > 0;
}

/** Thrown by the SDK when the user dismisses the store sheet. Not a failure. */
export interface PurchaseCancelledError {
  userCancelled?: boolean;
}

export function isUserCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as PurchaseCancelledError).userCancelled === true
  );
}

let cached: PurchasesModule | null = null;

/**
 * Resolve the SDK, or `null` if this binary does not contain it.
 *
 * Never throws. A missing native module is a build fact, not a runtime error
 * anyone can act on.
 */
export function getPurchases(): PurchasesModule | null {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('react-native-purchases') as
      | { default?: PurchasesModule }
      | PurchasesModule;
    const resolved =
      ('default' in mod && mod.default ? mod.default : mod) as PurchasesModule;
    // A module object with no `configure` is a shim, not the SDK.
    if (typeof resolved?.configure !== 'function') return null;
    cached = resolved;
    return cached;
  } catch {
    return null;
  }
}

/** Test seam. Resets the memoised handle between cases. */
export function resetPurchasesCache(): void {
  cached = null;
}

let configuredFor: string | null = null;

/**
 * Configure the SDK for one organization, once.
 *
 * `appUserID` IS the organization id, matching the server's `app_user_id`
 * (design D11). The server resolves a webhook's `app_user_id` straight to an
 * organization row — so a client that logged in with a USER id, or let the SDK
 * generate an anonymous id, would produce purchases the server cannot attribute
 * to any tenant.
 *
 * Re-called on org switch: a user who belongs to two orgs and switches context
 * must switch App User ID with it, or a purchase lands on the wrong tenant.
 *
 * Returns whether the SDK is usable, so callers can render "unavailable"
 * without inspecting the reason.
 */
export async function configurePurchases(organizationId: string): Promise<boolean> {
  const apiKey = getRevenueCatKey();
  const purchases = getPurchases();
  if (!apiKey || !purchases) return false;

  try {
    if (configuredFor === organizationId) return true;

    if (configuredFor === null) {
      purchases.configure({ apiKey, appUserID: organizationId });
    } else {
      // Already configured for a DIFFERENT org — switch identity rather than
      // reconfiguring, which is what the SDK supports and what keeps the
      // store's own alias graph correct.
      await purchases.logIn(organizationId);
    }
    configuredFor = organizationId;
    return true;
  } catch {
    configuredFor = null;
    return false;
  }
}

/** Test seam. */
export function resetPurchasesConfiguration(): void {
  configuredFor = null;
}

export type { CustomerInfo, PurchasesOffering, PurchasesPackage };
