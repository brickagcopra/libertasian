import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { configurePurchases } from '../lib/purchases-sdk';
import { offeringsQueryOptions } from './use-offerings';

/**
 * Warm the store up at app launch, instead of at purchase-screen mount.
 *
 * WHY THIS EXISTS. App Review's 2.1(b) rejection is fully diagnosed:
 * RevenueCat's subscriber record for the demo org shows `last_seen`
 * 2026-09-07T04:52:13Z, so the reviewer's device DID configure the SDK and DID
 * reach RevenueCat, which serves that subscriber the `default` offering with
 * all four packages. The Paid Apps agreement is Active and the same build
 * renders plans on our own devices. What failed is the layer below: StoreKit
 * returned no products on that device — a cold cache with no Sandbox Apple
 * Account signed in.
 *
 * `configurePurchases()` used to be called from exactly one place,
 * `usePurchaseOptions`, which means the SDK's very first conversation with the
 * store began at the instant the user opened the purchase screen and expected
 * to see prices. Every cold-start cost — configure, the RevenueCat fetch, then
 * StoreKit's own product lookup — was spent inside the window where an empty
 * result reads as "this app cannot sell anything". #462 made that window
 * survivable (retries, a direct product fetch, a Try again); this moves it off
 * the screen entirely, so by the time anyone opens the purchase screen the
 * fetch has usually already happened and the answer is in the query cache.
 *
 * NOT A PURCHASE DOOR. It renders nothing, routes nowhere, and names nothing
 * purchasable. `no-purchase-copy.test.ts` pins every importer of
 * `features/purchase/` for review precisely because an import is reachability;
 * this one buys the SDK a head start and no more.
 *
 * TOTAL. It no-ops while signed out and never throws — `configurePurchases()`
 * already resolves rather than throws on every failure it knows about, and the
 * prefetch below is wrapped as well. A store that cannot be reached at launch
 * must not be able to take the app down with it.
 */
export function usePurchasesBootstrap(
  organizationId: string | null | undefined,
): void {
  const queryClient = useQueryClient();
  // D11 — the App User ID IS the organization id. Keyed by it rather than a
  // bare "done" flag so an org switch warms the new tenant's store identity,
  // while ordinary re-renders and re-mounts of the guard do nothing.
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!organizationId || startedFor.current === organizationId) return;
    startedFor.current = organizationId;

    let cancelled = false;
    void (async () => {
      try {
        const ready = await configurePurchases(organizationId);
        // `false` is the ordinary answer on a binary with no store SDK and on
        // every Expo Go session. There is nothing to prefetch and nothing to
        // report.
        if (!ready || cancelled) return;

        // Exactly the query `useOfferings` runs, spread from one definition, so
        // the entry this writes is the entry the screen reads. `prefetchQuery`
        // swallows a rejection by design — an unreachable store at launch is
        // not an event anyone can act on, and the screen will ask again.
        await queryClient.prefetchQuery(offeringsQueryOptions());
      } catch {
        // Never throw out of app launch.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId, queryClient]);
}
