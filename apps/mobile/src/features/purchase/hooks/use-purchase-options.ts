import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/providers/auth-provider';
import { quotaKeys } from '@/features/billing/hooks/use-quotas';

import type { PurchaseSurfaceStatus } from '../components/purchase-surface';
import {
  OfferingsUnavailableError,
  packageFor,
  productFor,
  useOfferings,
} from './use-offerings';
import {
  configurePurchases,
  getPurchases,
  hasActiveEntitlement,
  isUserCancelled,
} from '../lib/purchases-sdk';
import {
  createPurchaseTelemetry,
  type PurchaseUnavailableReason,
} from '../lib/purchase-telemetry';
import { syncPurchasesWithServer } from '../lib/store-sync';
import type { PurchasePlanOption, StoreProductId } from '../products';

/**
 * Shown when the purchase COMPLETED — as judged by the store.
 *
 * App Review buys in the sandbox, and the API deliberately ignores sandbox
 * events in production (D10: `checkEnvironment`, and `syncFromStore`'s
 * `wantedEnvironment` filter), so `POST /store/sync` answers
 * `{status:'noop',detail:'in_sync'}` for a purchase that genuinely went
 * through. The screen used to read that as "we could not confirm that yet" and
 * showed it after money changed hands; App Review rejected build 2.1(b) on
 * exactly that line.
 *
 * So the STORE decides whether a purchase completed, and the SERVER keeps
 * deciding what the account is entitled to. `reconcile()` still runs and still
 * refreshes the quota query — it just no longer gets a vote on whether the user
 * is told their purchase worked.
 */
export const PURCHASE_CONFIRMED_NOTICE = 'Your subscription is active. Thank you.';

/**
 * Shown only when neither authority can find the purchase: the store reports no
 * active entitlement AND the server did not reconcile one. That is a purchase
 * that did not happen, and saying so is correct.
 */
export const PURCHASE_FAILED_NOTICE =
  'We could not complete that purchase. Please try again.';

/** The restore found something — at the store, at the server, or both. */
export const RESTORE_CONFIRMED_NOTICE = 'Your purchases have been restored.';

export const RESTORE_NOTHING_NOTICE =
  'There was nothing to restore on this store account.';

/**
 * The restore never reached the store at all.
 *
 * Distinct from {@link RESTORE_NOTHING_NOTICE} on purpose: an empty result is a
 * true statement about the store account, while a thrown
 * `restorePurchases()` is a statement about nothing. Reporting the second as
 * the first tells an entitled user their purchase does not exist, and hides
 * the failure from us — the symptom that surfaced this: `reconcile()` POSTs
 * `/store/sync` unconditionally, yet a full day of nginx logs contains no
 * `/store/sync` request, so every restore was throwing before it got there.
 */
export const RESTORE_FAILED_NOTICE =
  'We could not reach the store. Please try again.';

/**
 * How far the SDK got.
 *
 * A BOOLEAN COULD NOT EXPRESS THE MIDDLE STATE, and that is what App Review
 * saw. `configurePurchases()` is async — it can `logIn()` over the network on
 * an org switch — so `sdkReady === false` covered both "still configuring" and
 * "cannot configure", and the screen rendered the permanent dead end
 * ("Plans are not available right now") during the ordinary first moments of
 * every visit. A reviewer who read that sentence and moved on saw a purchase
 * screen that never worked.
 */
type SdkState = 'configuring' | 'ready' | 'failed';

/**
 * How long `configurePurchases()` may sit unresolved before we give up on it.
 *
 * It resolves rather than throws on every failure it knows about, but it awaits
 * a native bridge call, and a promise that never settles would leave the screen
 * spinning forever with no way out. The watchdog turns that into the
 * `unavailable` state, which now carries a "Try again".
 */
export const SDK_CONFIGURE_TIMEOUT_MS = 15_000;

export interface PurchaseOptions {
  status: PurchaseSurfaceStatus;
  plans: PurchasePlanOption[];
  busy: boolean;
  notice: string | null;
  purchase: (productId: StoreProductId) => void;
  restore: () => void;
  /**
   * Ask everything again: reconfigure the SDK, then refetch the offering.
   *
   * The user-facing half of the fix. Both halves are needed — a refetch alone
   * would not help an SDK that never configured, and reconfiguring alone would
   * hit React Query's 5-minute `staleTime` and change nothing on screen.
   */
  retry: () => void;
}

/**
 * Everything the purchase screen needs, and nothing it does not.
 *
 * The order of operations on a purchase is the important part:
 *
 *   1. buy through the SDK — the STORE is what takes the money, and its
 *      `customerInfo` is what decides whether the purchase completed;
 *   2. ask OUR server to reconcile (`POST /store/sync`), which pulls the
 *      conduit's own view rather than trusting anything this client says (D12);
 *   3. invalidate the quota query, because `/quotas/usage` is what drives every
 *      gated surface in the app.
 *
 * Step 2 failing does not undo step 1 and is never surfaced as a failure. It is
 * the routine answer, not an edge case: sandbox purchases (App Review's, and
 * Play's test track) are ignored by the API on purpose, so a working review
 * build reconciles to `in_sync` every time.
 */
export function usePurchaseOptions(): PurchaseOptions {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = user?.organizationId ?? null;

  const [sdkState, setSdkState] = useState<SdkState>('configuring');
  const [configureNonce, setConfigureNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // One reporter per mount: the dedupe window IS the mount, so a user who
  // leaves and comes back is a fresh observation.
  const telemetry = useRef(createPurchaseTelemetry()).current;

  // D11 — the App User ID IS the organization id, set on session start and on
  // any org switch. Re-running on organizationId change is what makes the
  // switch case work; a user in two orgs who switched context without this
  // would land a purchase on the wrong tenant.
  useEffect(() => {
    let cancelled = false;
    if (!organizationId) {
      setSdkState('failed');
      return;
    }

    setSdkState('configuring');
    const watchdog = setTimeout(() => {
      if (!cancelled) setSdkState((state) => (state === 'configuring' ? 'failed' : state));
    }, SDK_CONFIGURE_TIMEOUT_MS);

    void configurePurchases(organizationId).then((ready) => {
      if (cancelled) return;
      clearTimeout(watchdog);
      setSdkState(ready ? 'ready' : 'failed');
    });

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }, [organizationId, configureNonce]);

  const offerings = useOfferings(sdkState === 'ready');
  const plans = offerings.data?.plans ?? [];
  const source = offerings.data?.source ?? null;

  const status: PurchaseSurfaceStatus =
    sdkState === 'configuring'
      ? // NOT `unavailable`. See {@link SdkState}.
        'loading'
      : sdkState === 'failed'
        ? 'unavailable'
        : offerings.isPending
          ? 'loading'
          : plans.length > 0
            ? 'ready'
            : 'unavailable';

  // Report what the screen actually became, from the same values that decided
  // it. Both calls deduplicate internally, so this is safe on every render.
  useEffect(() => {
    if (status === 'ready' && source) {
      telemetry.surfaceReady({ planCount: plans.length, source });
      return;
    }
    if (status !== 'unavailable') return;

    if (sdkState === 'failed') {
      telemetry.surfaceUnavailable({ reason: 'sdk_failed', source: null });
      return;
    }

    const error = offerings.error;
    const reason: PurchaseUnavailableReason =
      error instanceof OfferingsUnavailableError ? error.reason : 'products_empty';
    telemetry.surfaceUnavailable({
      reason,
      source,
      rawProductIds:
        error instanceof OfferingsUnavailableError ? error.rawProductIds : [],
    });
  }, [status, sdkState, source, plans.length, offerings.error, telemetry]);

  /** Reconcile, then refresh the entitlement the whole app gates on. */
  const reconcile = useCallback(async (): Promise<boolean> => {
    const outcome = await syncPurchasesWithServer();
    await queryClient.invalidateQueries({ queryKey: quotaKeys.usage() });
    return outcome.kind === 'confirmed';
  }, [queryClient]);

  const refetchOfferings = offerings.refetch;
  const retry = useCallback(() => {
    setNotice(null);
    // Re-runs the configure effect, which re-enables the query on success.
    setConfigureNonce((nonce) => nonce + 1);
    void refetchOfferings();
  }, [refetchOfferings]);

  const purchase = useCallback(
    (productId: StoreProductId) => {
      const purchases = getPurchases();
      if (!purchases || busy) return;

      // BOTH GUARDS STAY, one per path. `packageFor` / `productFor` return null
      // for any id that is not in the offering or in the fetched product set,
      // and both of those sets were already filtered to `STORE_PRODUCT_IDS`. An
      // id the server would refuse therefore has nothing to hand the SDK on
      // either path, even if one appeared in the dashboard.
      const pkg = packageFor(offerings.data, productId);
      const product = productFor(offerings.data, productId);
      const buy =
        offerings.data?.source === 'products'
          ? product && (() => purchases.purchaseStoreProduct(product))
          : pkg && (() => purchases.purchasePackage(pkg));
      if (!buy) return;

      setBusy(true);
      setNotice(null);
      void (async () => {
        try {
          const { customerInfo } = await buy();
          const storeOk = hasActiveEntitlement(customerInfo);
          const serverOk = await reconcile();
          const confirmed = storeOk || serverOk;
          setNotice(confirmed ? PURCHASE_CONFIRMED_NOTICE : PURCHASE_FAILED_NOTICE);
          telemetry.purchaseResult(confirmed ? 'confirmed' : 'failed');
        } catch (error) {
          // Dismissing the store sheet is not a failure and gets no message.
          if (isUserCancelled(error)) {
            telemetry.purchaseResult('cancelled');
            return;
          }

          // A rejection is not proof the purchase failed. The SDK throws
          // PRODUCT_ALREADY_PURCHASED when a user taps a plan the store already
          // sold them, and other recoverable states besides. Ask the store who
          // it thinks owns this rather than reading the error — codes and
          // message text differ per platform and per SDK version, and a string
          // match here is how "you already own this" becomes a scary toast.
          let entitled = false;
          try {
            entitled = hasActiveEntitlement(await purchases.getCustomerInfo());
          } catch {
            // Nothing left to ask. Fall through to the failure line.
          }

          if (entitled) {
            await reconcile();
            setNotice(PURCHASE_CONFIRMED_NOTICE);
            telemetry.purchaseResult('confirmed');
          } else {
            setNotice(PURCHASE_FAILED_NOTICE);
            telemetry.purchaseResult('failed');
          }
        } finally {
          setBusy(false);
        }
      })();
    },
    [busy, offerings.data, reconcile, telemetry],
  );

  const restore = useCallback(() => {
    const purchases = getPurchases();
    if (!purchases || busy) return;

    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const info = await purchases.restorePurchases();
        const storeOk = hasActiveEntitlement(info);
        const serverOk = await reconcile();
        const restored = storeOk || serverOk;
        setNotice(restored ? RESTORE_CONFIRMED_NOTICE : RESTORE_NOTHING_NOTICE);
        telemetry.restoreResult(restored ? 'confirmed' : 'nothing');
      } catch (error) {
        // Dismissing the store sheet is not a failure and gets no message —
        // same rule as `purchase()`.
        if (isUserCancelled(error)) {
          telemetry.restoreResult('cancelled');
        } else {
          setNotice(RESTORE_FAILED_NOTICE);
          telemetry.restoreResult('failed');
        }
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, reconcile, telemetry]);

  return { status, plans, busy, notice, purchase, restore, retry };
}
