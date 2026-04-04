import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { ActivityFilters, ActivityListResponse } from '../types';

export function useActivity(filters: ActivityFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.entityType) params['entityType'] = filters.entityType;
  if (filters.actorUserId) params['actorUserId'] = filters.actorUserId;

  return useQuery({
    queryKey: ['activity', filters],
    queryFn: () => apiClient.get<ActivityListResponse>('/activity', { params }),
    staleTime: 60 * 1000,
  });
}
