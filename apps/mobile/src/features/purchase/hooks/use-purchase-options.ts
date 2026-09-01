import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/providers/auth-provider';
import { quotaKeys } from '@/features/billing/hooks/use-quotas';

import type { PurchaseSurfaceStatus } from '../components/purchase-surface';
import { packageFor, useOfferings } from './use-offerings';
import {
  configurePurchases,
  getPurchases,
  isUserCancelled,
} from '../lib/purchases-sdk';
import { syncPurchasesWithServer } from '../lib/store-sync';
import type { PurchasePlanOption, StoreProductId } from '../products';

/**
 * The one line shown when the store took the purchase but the server has not
 * confirmed the entitlement yet.
 *
 * Deliberately NOT a failure toast. The money is already taken and the
 * entitlement is already owed; the webhook or the nightly reconciliation will
 * deliver it. Telling the user something went wrong would send them to file a
 * refund for a purchase that succeeded.
 *
 * This is today's normal path, not an edge case: the server has no conduit
 * credential configured, so `/store/sync` answers `conduit_unconfigured` every
 * time.
 */
export const UNCONFIRMED_NOTICE =
  'We could not confirm that yet. Try Restore Purchases in a moment.';

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

export interface PurchaseOptions {
  status: PurchaseSurfaceStatus;
  plans: PurchasePlanOption[];
  busy: boolean;
  notice: string | null;
  purchase: (productId: StoreProductId) => void;
  restore: () => void;
}

/**
 * Everything the purchase screen needs, and nothing it does not.
 *
 * The order of operations on a purchase is the important part:
 *
 *   1. buy through the SDK — the STORE is what takes the money;
 *   2. ask OUR server to reconcile (`POST /store/sync`), which pulls the
 *      conduit's own view rather than trusting anything this client says (D12);
 *   3. invalidate the quota query, because `/quotas/usage` is what drives every
 *      gated surface in the app.
 *
 * Step 2 failing does not undo step 1 and is never surfaced as a failure.
 */
export function usePurchaseOptions(): PurchaseOptions {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const organizationId = user?.organizationId ?? null;

  const [sdkReady, setSdkReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // D11 — the App User ID IS the organization id, set on session start and on
  // any org switch. Re-running on organizationId change is what makes the
  // switch case work; a user in two orgs who switched context without this
  // would land a purchase on the wrong tenant.
  useEffect(() => {
    let cancelled = false;
    if (!organizationId) {
      setSdkReady(false);
      return;
    }
    void configurePurchases(organizationId).then((ready) => {
      if (!cancelled) setSdkReady(ready);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const offerings = useOfferings(sdkReady);
  const plans = offerings.data?.plans ?? [];

  const status: PurchaseSurfaceStatus = !sdkReady
    ? 'unavailable'
    : offerings.isPending
      ? 'loading'
      : plans.length > 0
        ? 'ready'
        : 'unavailable';

  /** Reconcile, then refresh the entitlement the whole app gates on. */
  const reconcile = useCallback(async (): Promise<boolean> => {
    const outcome = await syncPurchasesWithServer();
    await queryClient.invalidateQueries({ queryKey: quotaKeys.usage() });
    return outcome.kind === 'confirmed';
  }, [queryClient]);

  const purchase = useCallback(
    (productId: StoreProductId) => {
      const purchases = getPurchases();
      const pkg = packageFor(offerings.data, productId);
      // Both guards matter: `pkg` is null for any id not in the offering, which
      // includes every id the server would refuse. An unmapped product can
      // therefore never be purchased, even if one appeared in the dashboard.
      if (!purchases || !pkg || busy) return;

      setBusy(true);
      setNotice(null);
      void (async () => {
        try {
          await purchases.purchasePackage(pkg);
          const confirmed = await reconcile();
          setNotice(confirmed ? null : UNCONFIRMED_NOTICE);
        } catch (error) {
          // Dismissing the store sheet is not a failure and gets no message.
          if (!isUserCancelled(error)) setNotice(UNCONFIRMED_NOTICE);
        } finally {
          setBusy(false);
        }
      })();
    },
    [busy, offerings.data, reconcile],
  );

  const restore = useCallback(() => {
    const purchases = getPurchases();
    if (!purchases || busy) return;

    setBusy(true);
    setNotice(null);
    void (async () => {
      try {
        await purchases.restorePurchases();
        const confirmed = await reconcile();
        setNotice(confirmed ? null : RESTORE_NOTHING_NOTICE);
      } catch (error) {
        // Dismissing the store sheet is not a failure and gets no message —
        // same rule as `purchase()`.
        if (!isUserCancelled(error)) setNotice(RESTORE_FAILED_NOTICE);
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, reconcile]);

  return { status, plans, busy, notice, purchase, restore };
}
