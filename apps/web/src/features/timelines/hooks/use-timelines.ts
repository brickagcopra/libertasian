'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  TimelineListResponse,
  TimelineDetailResponse,
  CaseTimelineDetail,
  CaseTimelineListItem,
  TimelineFilters,
  GenerateTimelineInput,
} from '../types';

export function useTimelines(params?: TimelineFilters) {
  return useQuery({
    queryKey: ['timelines', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (params?.status) queryParams['status'] = params.status;
      if (params?.matterId) queryParams['matterId'] = params.matterId;
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<TimelineListResponse>('/timelines', { params: queryParams });
    },
  });
}

export function useTimeline(id: string | null) {
  return useQuery({
    queryKey: ['timeline', id],
    queryFn: async () => {
      const res = await apiClient.get<TimelineDetailResponse>(`/timelines/${id}`);
      return res.data;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const timeline = query.state.data as CaseTimelineDetail | undefined;
      if (timeline && (timeline.status === 'pending' || timeline.status === 'generating')) {
        return 3000;
      }
      return false;
    },
  });
}

export function useGenerateTimeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: GenerateTimelineInput) =>
      apiClient.post<{ success: boolean; data: CaseTimelineListItem }>(
        '/timelines/generate',
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timelines'] });
    },
  });
}

export function useDeleteTimeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/timelines/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['timelines'] });
    },
  });
}
