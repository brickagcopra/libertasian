import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { QuotaUsageData } from '../types';

export const quotaKeys = {
  all: ['quotas'] as const,
  usage: () => [...quotaKeys.all, 'usage'] as const,
};

/**
 * `enabled` exists for `useFreemiumSurfacesSync`, which mounts at the root and
 * must not fire this request while signed out. Defaults to true, so the
 * existing caller (Settings → Usage & quotas) is unchanged.
 */
export function useQuotaUsage(enabled = true) {
  return useQuery({
    queryKey: quotaKeys.usage(),
    enabled,
    // NO `.data` HERE. `apiClient.get()` already strips the {success, data}
    // envelope (see `unwrapEnvelope` in lib/api-client.ts), and /quotas/usage
    // returns exactly that shape with no `meta` sibling — so the generic is the
    // UNWRAPPED payload and a second `.data` reads a field that does not exist.
    // It returned `undefined`, which `useFreemiumSurfacesSync` treats as "no
    // answer yet": it early-returns, never writes MMKV, and every paid surface
    // plus the purchase row stays hidden. `use-quotas.test.ts` pins this.
    queryFn: () => apiClient.get<QuotaUsageData>('/quotas/usage'),
    staleTime: 1 * 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // auto-refresh every 5 minutes
  });
}
