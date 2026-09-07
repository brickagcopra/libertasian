import { Platform } from 'react-native';

/**
 * Release-build telemetry for the purchase screen.
 *
 * WHY THIS EXISTS: App Review rejected 1.0.1 (30) under 2.1(b) — "the plans
 * were unavailable at the time of review". Our own logs proved the reviewer
 * signed in, received `storePurchaseAvailable: true`, and reached this screen;
 * RevenueCat's `default` offering serves all four products correctly. So the
 * store fetch came back empty ON DEVICE and the client rendered a permanent
 * dead end, and we had no way to see any of it. `logger` is dev-only
 * (`lib/logger.ts` returns early on `!__DEV__`), so a release build reported
 * nothing at all. These events are the release-build channel.
 *
 * WHAT MAY NEVER GO IN HERE: no email, no user or organization id, no store
 * account, no `priceString`, no price, no currency, no localized store copy.
 * The payload is persisted server-side. Store PRODUCT IDS are ours — they are
 * the four constants in `products.ts` and the server's own `STORE_PRODUCT_MAP`
 * keys — and they are the whole point: "the store returned nothing" and "the
 * store returned four ids we do not sell" are different bugs with different
 * fixes, and only the raw ids tell them apart.
 *
 * LOCATION IS LOAD-BEARING. This module names purchasable things, so it lives
 * under `features/purchase/` where `no-purchase-copy.test.ts` exempts it BY
 * LOCATION. `purchase-telemetry.test.ts` asserts nothing outside the purchase
 * surface imports it.
 */

/** Which path produced (or failed to produce) the options on screen. */
export type PurchaseTelemetrySource = 'offering' | 'products';

/**
 * Why the screen has nothing to sell. Machine values, never rendered.
 *
 * The four offering/product reasons come from `OfferingsUnavailableError`;
 * `sdk_failed` is the earlier stop, where the SDK never configured at all (no
 * native module, no RevenueCat key, or the 15s watchdog fired).
 */
export type PurchaseUnavailableReason =
  | 'no_sdk'
  | 'offering_null'
  | 'no_matching_packages'
  | 'products_empty'
  | 'sdk_failed';

/** How a purchase ended, as the STORE and the server judged it. */
export type PurchaseOutcome = 'confirmed' | 'failed' | 'cancelled';

/** How a restore ended. `nothing` is a true statement, not a failure. */
export type RestoreOutcome = 'confirmed' | 'nothing' | 'failed' | 'cancelled';

/**
 * Post one event through the analytics singleton.
 *
 * LAZY REQUIRE, deliberately, and the same pattern as `purchases-sdk.ts` two
 * files over. `lib/analytics` imports `expo-sqlite` (its offline buffer) at
 * module scope, and this module is reachable from the `features/purchase`
 * barrel, which `features/entitlements/surface-guard.tsx` imports, which most
 * of the app's screens render. A top-level import would therefore drag the
 * SQLite native module into the import graph of half the app — and did: it
 * broke seven unrelated test suites on the first run.
 *
 * TOTAL, as well. Telemetry exists to explain a broken purchase screen; it may
 * never be the reason one breaks. A missing analytics module, an unwritable
 * buffer, a native bridge that is not there — all of it is swallowed.
 */
function post(eventName: string, properties: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { mobileAnalytics } = require('../../../lib/analytics') as {
      mobileAnalytics: {
        track: (name: string, properties: Record<string, unknown>) => void;
      };
    };
    mobileAnalytics.track(eventName, properties);
  } catch {
    // Nothing to report the failure to report with.
  }
}

/** Attacker-influenced in the general case, and we persist it. Cap it. */
const MAX_RAW_PRODUCT_IDS = 12;
const MAX_RAW_PRODUCT_ID_LENGTH = 120;

function safeProductIds(ids: readonly unknown[] | undefined): string[] {
  return (ids ?? [])
    .filter((id): id is string => typeof id === 'string')
    .slice(0, MAX_RAW_PRODUCT_IDS)
    .map((id) => id.slice(0, MAX_RAW_PRODUCT_ID_LENGTH));
}

export interface PurchaseTelemetry {
  /**
   * The screen cannot sell anything.
   *
   * Fired ONCE PER REASON for the life of this instance. The purchase screen
   * re-renders on every query state change and the unavailable state is
   * sticky, so an undeduplicated call here would post one event per render and
   * bury the signal it exists to carry. A DIFFERENT reason is a different
   * fact and is always reported.
   */
  surfaceUnavailable(params: {
    reason: PurchaseUnavailableReason;
    source?: PurchaseTelemetrySource | null;
    rawProductIds?: readonly string[];
  }): void;
  /** The screen has options. Fired once per instance. */
  surfaceReady(params: {
    planCount: number;
    source: PurchaseTelemetrySource;
  }): void;
  purchaseResult(outcome: PurchaseOutcome): void;
  restoreResult(outcome: RestoreOutcome): void;
}

/**
 * One reporter per mount of the purchase screen.
 *
 * A factory rather than module-level functions because the dedupe window IS
 * the mount: a user who leaves the screen and comes back has had a chance for
 * the store to answer differently, and that second visit is a new observation
 * we want.
 */
export function createPurchaseTelemetry(): PurchaseTelemetry {
  const reportedReasons = new Set<PurchaseUnavailableReason>();
  let reportedReady = false;

  return {
    surfaceUnavailable({ reason, source, rawProductIds }) {
      if (reportedReasons.has(reason)) return;
      reportedReasons.add(reason);

      post('purchase_surface_unavailable', {
        platform: Platform.OS,
        reason,
        source: source ?? 'none',
        rawProductIds: safeProductIds(rawProductIds),
      });
    },

    surfaceReady({ planCount, source }) {
      if (reportedReady) return;
      reportedReady = true;

      post('purchase_surface_ready', {
        platform: Platform.OS,
        planCount,
        source,
      });
    },

    purchaseResult(outcome) {
      post('purchase_result', {
        platform: Platform.OS,
        outcome,
      });
    },

    restoreResult(outcome) {
      post('restore_result', {
        platform: Platform.OS,
        outcome,
      });
    },
  };
}
