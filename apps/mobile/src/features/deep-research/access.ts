import { useMemo } from 'react';

import { useQuotaUsage } from '../billing/hooks/use-quotas';
import type { QuotaUsageData } from '../billing/types';
import { useSurfaceAccess, type SurfaceAccess } from '../entitlements/use-freemium-surfaces';

/** The quota key Deep Research spends (`DEEP_RESEARCH_QUOTA` on the API). */
export const DEEP_RESEARCH_QUOTA_KEY = 'deepResearchPerMonth';

/**
 * What the Deep Research UI may offer, decided BEFORE any tap.
 *
 *   hidden      — the surface is not visible on this account/platform. Entry
 *                 points render nothing; the route redirects home (SurfaceGuard).
 *                 This is a free account on a platform with no live store —
 *                 Android today.
 *   purchase    — not entitled (or a limit of 0) and a store purchase is live on
 *                 THIS platform: the purchase entry point. iOS today.
 *   unavailable — entitled surface but a limit of 0 and no store: the fixed
 *                 neutral refusal.
 *   loading     — the quota is not known yet: skeleton, never a dead button.
 *   exhausted   — this month's runs are spent: the reset date.
 *   ready       — go. `remaining` is null for unlimited or unknown.
 *
 * `storePurchaseAvailable` is resolved PER PLATFORM by the API from the
 * `X-Platform` header, so "iOS shows the purchase flow, Android does not" falls
 * out of the server's answer rather than a `Platform.OS` check that would go
 * stale the day Play billing ships.
 */
export type DeepResearchAccess =
  | { kind: 'hidden' }
  | { kind: 'purchase' }
  | { kind: 'unavailable' }
  | { kind: 'loading' }
  | { kind: 'exhausted'; resetsAt: string | null; limit: number }
  | {
      kind: 'ready';
      /** null when unlimited or not known. */
      remaining: number | null;
      limit: number | null;
      resetsAt: string | null;
      unlimited: boolean;
    };

export function resolveDeepResearchAccess(
  access: SurfaceAccess,
  quota: QuotaUsageData | undefined,
  quotaFailed: boolean,
): DeepResearchAccess {
  if (!access.surfaces.workspace) return { kind: 'hidden' };

  const refuse = (): DeepResearchAccess =>
    access.storePurchaseAvailable ? { kind: 'purchase' } : { kind: 'unavailable' };

  if (!access.entitled) return refuse();

  if (!quota) {
    // A failed quota read must not strand the user: the server is the
    // authority and refuses properly on POST.
    return quotaFailed
      ? { kind: 'ready', remaining: null, limit: null, resetsAt: null, unlimited: false }
      : { kind: 'loading' };
  }

  const item = quota.quotas[DEEP_RESEARCH_QUOTA_KEY];
  if (!item) {
    // An API older than Deep Research: let the server decide.
    return { kind: 'ready', remaining: null, limit: null, resetsAt: null, unlimited: false };
  }

  const resetsAt = item.resetsAt || null;
  if (item.limit === 0) return refuse();
  if (item.limit < 0) return { kind: 'ready', remaining: null, limit: null, resetsAt, unlimited: true };

  const remaining = Math.max(0, item.limit - item.used);
  if (remaining === 0) return { kind: 'exhausted', resetsAt, limit: item.limit };
  return { kind: 'ready', remaining, limit: item.limit, resetsAt, unlimited: false };
}

/** The live answer for the current account. */
export function useDeepResearchAccess(): DeepResearchAccess {
  const { surfaces, entitled, storePurchaseAvailable } = useSurfaceAccess();
  const visible = surfaces.workspace;
  // Same query (and cache entry) the root sync already holds; not a paid call.
  const { data, isError } = useQuotaUsage(visible);
  // Keyed on the three scalars: `useSurfaceAccess` parses a fresh object on
  // every render, so memoising on it would never hit.
  return useMemo(
    () =>
      resolveDeepResearchAccess(
        { surfaces: { ...surfaces, workspace: visible }, entitled, storePurchaseAvailable },
        data,
        isError,
      ),
    [visible, entitled, storePurchaseAvailable, data, isError],
  );
}

/** "Oct 1" — the reset instant as the user reads it. */
export function formatResetDate(resetsAt: string | null | undefined): string | null {
  if (!resetsAt) return null;
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
