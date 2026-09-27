'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useQuotaUsage } from '@/features/billing/hooks/use-quotas';
import type { QuotaUsageItem } from '@/features/billing/types';
import { apiClient } from '@/lib/api-client';

import { resolveRunDetail, resolveRunPage } from '../lib/api';

export const deepResearchKeys = {
  all: ['deep-research'] as const,
  list: () => [...deepResearchKeys.all, 'list'] as const,
  detail: (id: string) => [...deepResearchKeys.all, 'detail', id] as const,
};

const PAGE_SIZE = 20;

/** The caller's own runs, newest first (GET /deep-research, keyset cursor). */
export function useDeepResearchRuns(options?: { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: deepResearchKeys.list(),
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: String(PAGE_SIZE) };
      if (pageParam) params['cursor'] = pageParam;
      const body = await apiClient.get<unknown>('/deep-research', { params });
      return resolveRunPage(body);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: options?.enabled ?? true,
  });
}

/** One saved run (GET /deep-research/:id). */
export function useDeepResearchRun(id: string | null) {
  return useQuery({
    queryKey: deepResearchKeys.detail(id ?? ''),
    queryFn: async () => resolveRunDetail(await apiClient.get<unknown>(`/deep-research/${id}`)),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDeleteDeepResearchRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<unknown>(`/deep-research/${id}`),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: deepResearchKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: deepResearchKeys.list() });
    },
  });
}

/** `deepResearchPerMonth` from the shared GET /quotas/usage query. */
export function useDeepResearchQuota(): {
  quota: QuotaUsageItem | null;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuotaUsage();
  return { quota: data?.quotas?.['deepResearchPerMonth'] ?? null, isLoading };
}
