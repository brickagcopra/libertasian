import { router } from 'expo-router';

import {
  PURCHASE_PRIVACY_ROUTE,
  PURCHASE_TERMS_ROUTE,
  PurchaseSurface,
  usePurchaseOptions,
} from '@/features/purchase';

/**
 * The purchase screen.
 *
 * Deliberately thin: it wires the options seam to the surface and owns nothing
 * else. Everything the user reads about a plan comes from
 * `usePurchaseOptions()`, which in turn will come from the store's own
 * localized offering — there is no copy in this file to go stale against a
 * price change.
 */
export default function PurchaseRoute() {
  const { status, plans, busy, notice, purchase, restore } = usePurchaseOptions();

  return (
    <PurchaseSurface
      status={status}
      plans={plans}
      busy={busy}
      notice={notice}
      onPurchase={purchase}
      onRestore={restore}
      onOpenTerms={() => router.push(PURCHASE_TERMS_ROUTE)}
      onOpenPrivacy={() => router.push(PURCHASE_PRIVACY_ROUTE)}
    />
  );
}
