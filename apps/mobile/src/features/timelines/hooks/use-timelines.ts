import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  TimelineListResponse,
  TimelineDetailResponse,
  CaseTimelineListItem,
  TimelineFilters,
  GenerateTimelineInput,
} from '../types';

export function useTimelines(filters: TimelineFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.status) params['status'] = filters.status;
  if (filters.matterId) params['matterId'] = filters.matterId;

  return useQuery({
    queryKey: ['timelines', filters],
    queryFn: () =>
      apiClient.get<TimelineListResponse>('/timelines', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useTimeline(id: string, enabled = true) {
  return useQuery({
    queryKey: ['timeline', id],
    queryFn: () =>
      apiClient.get<TimelineDetailResponse>(`/timelines/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      const resp = query.state.data as TimelineDetailResponse | undefined;
      const timeline = resp?.data;
      if (
        timeline &&
        (timeline.status === 'pending' || timeline.status === 'generating')
      ) {
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
