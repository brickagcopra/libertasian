import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/providers/auth-provider';
import { openStoreAccountPage } from '@/lib/store-account-page';
import { quotaKeys, useQuotaUsage } from '@/features/billing/hooks/use-quotas';

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
  subscriptionOrigin,
  type SubscriptionOrigin,
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
/** The store's manage page could not be opened. Names no other way to cancel. */
export const MANAGE_FAILED_NOTICE =
  'We could not open the store. Please try again.';

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
  /**
   * A purchase or restore in THIS visit ended with an active entitlement. The
   * surface swaps the plan list and its buy button for a confirmation, so the
   * user is not left looking at a live "Continue" for something they already
   * own — tapping it again only re-enters the store's "already purchased" path.
   */
  completed: boolean;
  /**
   * The store reports an active entitlement for this account — found when the
   * screen opens, or by a purchase or restore here. The surface then shows the
   * manage panel instead of plans: buying a second plan on Google Play starts a
   * SECOND, separately billed subscription, so the buy button must not be there.
   */
  hasSubscription: boolean;
  /**
   * Where the active subscription can be managed from, or null when there is
   * none. `elsewhere` covers a purchase on the OTHER platform's store and one
   * made on the website: both unlock the account here, neither can be managed
   * through this device's store, so the surface offers no manage button and,
   * above all, no buy button that would start a second subscription.
   */
  subscriptionOrigin: SubscriptionOrigin | null;
  /** Open the store's own page for managing or cancelling the subscription. */
  manageSubscription: () => void;
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
  const [completed, setCompleted] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [origin, setOrigin] = useState<SubscriptionOrigin | null>(null);
  const [storeChecked, setStoreChecked] = useState(false);
  const managementUrl = useRef<string | null>(null);

  // The SERVER's answer, which is the only one that knows about a purchase made
  // on the website. `previewOnly === false` is the same value every gated
  // surface uses. The App Review demo org starts on free, so it still sees the
  // plans.
  const quotas = useQuotaUsage(organizationId !== null);
  const serverEntitled = quotas.data?.previewOnly === false;

  /** Record what the store says this account owns. Never downgrades on its own. */
  const noteCustomerInfo = useCallback((info: unknown) => {
    const typed = info as Parameters<typeof hasActiveEntitlement>[0] & {
      managementURL?: string | null;
    };
    const found = subscriptionOrigin(typed, Platform.OS);
    if (!found) return;
    setHasSubscription(true);
    // `this_store` wins: an account entitled both here and elsewhere can still
    // manage the part this store sold.
    setOrigin((previous) => (previous === 'this_store' ? previous : found));
    managementUrl.current = typed?.managementURL ?? managementUrl.current;
  }, []);

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

  // Does this account already own something? Asked once the SDK is ready, so a
  // subscriber who comes back to this screen sees how to manage or cancel it
  // rather than a buy button.
  useEffect(() => {
    if (sdkState !== 'ready') return;
    const purchases = getPurchases();
    if (!purchases) return;
    let cancelled = false;
    purchases
      .getCustomerInfo()
      .then((info) => {
        if (!cancelled) noteCustomerInfo(info);
      })
      .catch(() => {
        // Unknown is not "none": the plans render as before.
      })
      .finally(() => {
        if (!cancelled) setStoreChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sdkState, noteCustomerInfo]);
  const plans = offerings.data?.plans ?? [];
  const source = offerings.data?.source ?? null;

  // The store has had its say (or never will). Until then a server-entitled
  // account waits on the spinner rather than flashing the plans, or flashing
  // "elsewhere" for a subscription this store is about to report as its own.
  const storeKnown = storeChecked || sdkState === 'failed';
  const effectiveOrigin: SubscriptionOrigin | null =
    origin ?? (serverEntitled && storeKnown ? 'elsewhere' : null);
  const subscribed = hasSubscription || effectiveOrigin !== null;

  const status: PurchaseSurfaceStatus =
    serverEntitled && !storeKnown && !subscribed
      ? 'loading'
      : sdkState === 'configuring'
      ? // NOT `unavailable`. See {@link SdkState}.
        'loading'
      : sdkState === 'failed'
        ? 'unavailable'
        : // Covers the retries, and the refetch of a FAILED PREFETCH too:
          // `usePurchasesBootstrap` now leaves an error entry under this key
          // when the store cannot be reached at launch, and React Query resets
          // a never-held-data query to `pending` when that refetch starts. So
          // opening the screen on a failed prefetch shows the spinner, not the
          // dead-end sentence — asserted in `terminal states` below, which is
          // what would catch this if that behaviour ever changed.
          offerings.isPending
          ? 'loading'
          : plans.length > 0
            ? 'ready'
            : // Nothing to sell and nothing still running. A VERDICT, and the
              // one state that renders a way out of it.
              'unavailable';

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
          noteCustomerInfo(customerInfo);
          const storeOk = hasActiveEntitlement(customerInfo);
          const serverOk = await reconcile();
          const confirmed = storeOk || serverOk;
          setNotice(confirmed ? PURCHASE_CONFIRMED_NOTICE : PURCHASE_FAILED_NOTICE);
          setCompleted(confirmed);
          if (confirmed) {
            setHasSubscription(true);
            setOrigin('this_store'); // bought here, so managed here
          }
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
            setCompleted(true);
            setHasSubscription(true);
            setOrigin('this_store'); // bought here, so managed here
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
    [busy, offerings.data, reconcile, telemetry, noteCustomerInfo],
  );

  const restore = useCallback(() => {
    const purchases = getPurchases();
    if (!purchases || busy) return;

    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        const info = await purchases.restorePurchases();
        noteCustomerInfo(info);
        const storeOk = hasActiveEntitlement(info);
        const serverOk = await reconcile();
        const restored = storeOk || serverOk;
        setNotice(restored ? RESTORE_CONFIRMED_NOTICE : RESTORE_NOTHING_NOTICE);
        setCompleted(restored);
        if (restored) {
          setHasSubscription(true);
          // The store found nothing but the server did: bought elsewhere.
          setOrigin((previous) => previous ?? 'elsewhere');
        }
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
  }, [busy, reconcile, telemetry, noteCustomerInfo]);

  const manageSubscription = useCallback(() => {
    if (busy) return;
    setNotice(null);
    void (async () => {
      // iOS: Apple's own sheet, inside the app. If it is unavailable (or this is
      // Android, where the SDK throws), fall back to the store's account page.
      if (Platform.OS === 'ios') {
        try {
          await getPurchases()?.showManageSubscriptions();
          return;
        } catch {
          // Fall through to the page.
        }
      }
      const opened = await openStoreAccountPage(managementUrl.current);
      if (!opened) setNotice(MANAGE_FAILED_NOTICE);
    })();
  }, [busy]);

  return {
    status,
    plans,
    busy,
    notice,
    completed,
    hasSubscription: subscribed,
    subscriptionOrigin: effectiveOrigin,
    manageSubscription,
    purchase,
    restore,
    retry,
  };
}
