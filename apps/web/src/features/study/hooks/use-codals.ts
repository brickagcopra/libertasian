'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { CodalListItem, CodalListMeta } from '../types';

export function useCodals(
  subject: string,
  params?: {
    cursor?: string;
    documentType?: string;
    search?: string;
  },
) {
  return useQuery({
    queryKey: ['codals', subject, params],
    queryFn: async () => {
      const queryParams: Record<string, string> = { limit: '20' };
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.documentType) queryParams['documentType'] = params.documentType;
      if (params?.search) queryParams['search'] = params.search;
      const res = await apiClient.get<{
        success: boolean;
        data: CodalListItem[];
        meta: CodalListMeta;
      }>(`/study/codals/${encodeURIComponent(subject)}`, { params: queryParams });
      return res;
    },
    enabled: !!subject,
  });
}
