import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  HearingPrepListResponse,
  HearingPrepDetail,
  HearingPrepListItem,
  HearingPrepFilters,
  GenerateHearingPrepInput,
} from '../types';

export function useHearingPreps(filters: HearingPrepFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.status) params['status'] = filters.status;
  if (filters.matterId) params['matterId'] = filters.matterId;

  return useQuery({
    queryKey: ['hearing-preps', filters],
    queryFn: () =>
      apiClient.get<HearingPrepListResponse>('/hearing-prep', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useHearingPrep(id: string, enabled = true) {
  return useQuery({
    queryKey: ['hearing-prep', id],
    queryFn: () =>
      apiClient.get<HearingPrepDetail>(`/hearing-prep/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      // NO second `.data`: `GET /hearing-prep/:id` returns a bare
      // { success, data } envelope, which `apiClient` already strips, so
      // `query.state.data` IS the detail object. Reading `.data` off it gave
      // `undefined` and the status check below could never be true — the poll
      // stopped immediately and a still-generating record never refreshed.
      const pack = query.state.data as HearingPrepDetail | undefined;
      if (
        pack &&
        (pack.status === 'pending' || pack.status === 'generating')
      ) {
        return 3000;
      }
      return false;
    },
  });
}

export function useGenerateHearingPrep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: GenerateHearingPrepInput) =>
      apiClient.post<HearingPrepListItem>('/hearing-prep/generate', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hearing-preps'] });
    },
  });
}

export function useDeleteHearingPrep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/hearing-prep/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hearing-preps'] });
    },
  });
}
