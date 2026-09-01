import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  TimelineListResponse,
  CaseTimelineDetail,
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
      apiClient.get<CaseTimelineDetail>(`/timelines/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      // NO second `.data`: `GET /timelines/:id` returns a bare
      // { success, data } envelope, which `apiClient` already strips, so
      // `query.state.data` IS the detail object. Reading `.data` off it gave
      // `undefined` and the status check below could never be true — the poll
      // stopped immediately and a still-generating record never refreshed.
      const timeline = query.state.data as CaseTimelineDetail | undefined;
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
      apiClient.post<CaseTimelineListItem>('/timelines/generate', data),
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
