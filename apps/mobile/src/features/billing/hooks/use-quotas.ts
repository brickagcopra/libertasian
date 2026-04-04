import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { QuotaUsageResponse, QuotaUsageData } from '../types';

export const quotaKeys = {
  all: ['quotas'] as const,
  usage: () => [...quotaKeys.all, 'usage'] as const,
};

export function useQuotaUsage() {
  return useQuery({
    queryKey: quotaKeys.usage(),
    queryFn: async (): Promise<QuotaUsageData> => {
      const res = await apiClient.get<QuotaUsageResponse>('/quotas/usage');
      return res.data;
    },
    staleTime: 1 * 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // auto-refresh every 5 minutes
  });
}
