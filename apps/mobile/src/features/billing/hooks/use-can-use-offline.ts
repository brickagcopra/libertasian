import { ApiClientError } from '../../../lib/api-client';
import { meetsMinimumTier, useSubscription } from './use-subscription';

export interface CanUseOfflineResult {
  /**
   * True only when the org is KNOWN to be below the Edu tier — the only
   * state in which the reader / codal list swaps the "save offline" action
   * for the feature-unavailable sheet.
   */
  locked: boolean;
}

/**
 * Offline saving is the `offlineReading` entitlement — false on free, true
 * from edu upward in plan-seed, so the tier floor is `edu`. This hook
 * resolves that gate client-side so the reader and the codal list can open a
 * feature-unavailable sheet instead of writing a new document into offline
 * storage.
 *
 * Mirrors useCanUseBookmarksAnnotations exactly (useSubscription +
 * meetsMinimumTier, 404 = no subscription record = free tier, fail-open
 * while loading or on any other error). See that hook for why there is no
 * client-side platform-admin bypass.
 *
 * Blocks NEW saves only. Already-cached documents are never evicted by this
 * gate — offline content stays readable after a plan lapses.
 */
export function useCanUseOffline(): CanUseOfflineResult {
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
