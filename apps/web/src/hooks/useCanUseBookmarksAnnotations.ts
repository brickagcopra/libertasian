'use client';

import {
  meetsMinimumTier,
  useSubscription,
} from '@/features/billing/hooks/use-subscription';
import { useAuthStore } from '@/stores/auth-store';

export interface CanUseBookmarksAnnotationsResult {
  /**
   * True only when the org is KNOWN to be below the Edu tier (and the user
   * is not a platform admin) — the only state that swaps the bookmark and
   * annotation affordances for the upsell UI.
   */
  locked: boolean;
}

/**
 * POST /bookmarks and POST /annotations require the `edu` tier or above
 * (method-level SubscriptionGuard + @RequiredSubscription('edu')). This hook
 * resolves that gate client-side so the reader can show a proactive upsell
 * instead of letting the request fire and 403.
 *
 * Composition mirrors useCanUploadDocuments: the single-source-of-truth
 * useSubscription query + meetsMinimumTier, with the platform-admin bypass
 * from useCanAccessPaidFeature (admins bypass SubscriptionGuard server-side,
 * so their UI must never lock).
 *
 * Fail-open: while the subscription query is loading or errored we return
 * locked=false — the request path with its 402/403 catch remains the
 * fallback. A resolved `null` (API 404 = no subscription record) is a KNOWN
 * free org and locks.
 */
export function useCanUseBookmarksAnnotations(): CanUseBookmarksAnnotationsResult {
  const user = useAuthStore((s) => s.user);
  const { data: sub, isLoading, isError } = useSubscription();

  if (user?.isPlatformAdmin) {
    return { locked: false };
  }
  if (isLoading || isError) {
    return { locked: false };
  }
  const allowed =
    !!sub &&
    (sub.status === 'active' || sub.status === 'trialing') &&
    meetsMinimumTier(sub.planCode, 'edu');
  return { locked: !allowed };
}
