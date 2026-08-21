import { ApiClientError } from '../../../lib/api-client';
import { meetsMinimumTier, useSubscription } from './use-subscription';

export interface CanUseBookmarksAnnotationsResult {
  /**
   * True only when the org is KNOWN to be below the Edu tier — the only
   * state in which the reader swaps the bookmark sheet / annotation-create
   * sheet for the feature-unavailable sheet.
   */
  locked: boolean;
}

/**
 * POST /bookmarks and POST /annotations require the `edu` tier or above
 * (method-level SubscriptionGuard + @RequiredSubscription('edu')). This hook
 * resolves that gate client-side so the reader can open a feature-unavailable
 * sheet instead of letting the request fire and 403.
 *
 * Built on the existing useSubscription query (GET /billing/subscription) +
 * meetsMinimumTier — the same single source of truth the web gate uses.
 *
 * Fail-open: while the subscription query is loading, or errored for any
 * reason other than 404, we return locked=false and the request path's
 * 402/403 Alert remains the fallback. A 404 is the API's documented
 * "no subscription record" response and is treated as the free tier.
 *
 * No platform-admin bypass here: the mobile AuthUser does not expose
 * isPlatformAdmin (unlike web's auth store), so there is nothing to key a
 * client-side bypass on. Admins still bypass SubscriptionGuard server-side;
 * if the mobile user object ever gains isPlatformAdmin, mirror web's
 * useCanAccessPaidFeature bypass here.
 */
export function useCanUseBookmarksAnnotations(): CanUseBookmarksAnnotationsResult {
  const { data: sub, isLoading, error } = useSubscription();

  const noSubscription =
    error instanceof ApiClientError && error.statusCode === 404;

  if (noSubscription) {
    return { locked: true };
  }
  if (isLoading || error || !sub) {
    // Undetermined — never lock on loading/errored subscription state.
    return { locked: false };
  }

  const allowed =
    (sub.status === 'active' || sub.status === 'trialing') &&
    meetsMinimumTier(sub.planCode, 'edu');

  return { locked: !allowed };
}
