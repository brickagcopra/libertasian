import { ApiClientError } from '../../../lib/api-client';
import { PLAN_LABELS } from '../types';
import { meetsMinimumTier, useSubscription } from './use-subscription';

export interface CanUseOfflineResult {
  /**
   * True only when the org is KNOWN to be below the Edu tier — the only
   * state in which the reader / codal list swaps the "save offline" action
   * for the upsell sheet.
   */
  locked: boolean;
  /** Display name of the current plan ('Free' when no subscription exists). */
  planName: string;
}

/**
 * Offline saving is the `offlineReading` entitlement — false on free, true
 * from edu upward in plan-seed, so the tier floor is `edu`. This hook
 * resolves that gate client-side so the reader and the codal list can open
 * an upsell sheet instead of writing a new document into offline storage.
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
    return { locked: true, planName: PLAN_LABELS['free'] ?? 'Free' };
  }
  if (isLoading || error || !sub) {
    // Undetermined — never lock on loading/errored subscription state.
    return { locked: false, planName: PLAN_LABELS['free'] ?? 'Free' };
  }

  const allowed =
    (sub.status === 'active' || sub.status === 'trialing') &&
    meetsMinimumTier(sub.planCode, 'edu');

  return {
    locked: !allowed,
    planName: PLAN_LABELS[sub.planCode] ?? sub.planCode,
  };
}
