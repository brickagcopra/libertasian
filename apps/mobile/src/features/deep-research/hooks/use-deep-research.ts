import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../../../lib/api-client';
import { resolveRunDetail, resolveRunListPage } from '../envelope';
import type { DeepResearchRunListItem } from '../types';

export const deepResearchKeys = {
  all: ['deep-research'] as const,
  list: () => [...deepResearchKeys.all, 'list'] as const,
  detail: (id: string) => [...deepResearchKeys.all, 'detail', id] as const,
};

const PAGE_SIZE = 20;

/**
 * The caller's own runs, newest first, keyset-paginated.
 *
 * `apiClient.get<unknown>` on purpose: the envelope is resolved by
 * `resolveRunListPage`, not by trusting a generic — see `envelope.ts` for why
 * this route arrives still wrapped.
 */
export function useDeepResearchRuns() {
  return useInfiniteQuery({
    queryKey: deepResearchKeys.list(),
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: String(PAGE_SIZE) };
      if (pageParam) params['cursor'] = pageParam;
      return resolveRunListPage(await apiClient.get<unknown>('/deep-research', { params }));
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined),
    select: (data): DeepResearchRunListItem[] => data.pages.flatMap((p) => p.items),
    staleTime: 60 * 1000,
  });
}

/** One past run. The payload arrives unwrapped; `resolveRunDetail` pins it. */
export function useDeepResearchRun(id: string, enabled = true) {
  return useQuery({
    queryKey: deepResearchKeys.detail(id),
    queryFn: async () => resolveRunDetail(await apiClient.get<unknown>(`/deep-research/${id}`)),
    enabled: enabled && id.length > 0,
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
