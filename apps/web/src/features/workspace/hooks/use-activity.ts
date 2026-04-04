'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { ActivityListResponse } from '../types';

interface UseActivityParams {
  entityType?: string;
  actorUserId?: string;
  cursor?: string;
  limit?: number;
}

export function useActivity(params?: UseActivityParams) {
  return useQuery({
    queryKey: ['activity', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (params?.entityType) queryParams['entityType'] = params.entityType;
      if (params?.actorUserId) queryParams['actorUserId'] = params.actorUserId;
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<ActivityListResponse>('/activity', { params: queryParams });
    },
  });
}
