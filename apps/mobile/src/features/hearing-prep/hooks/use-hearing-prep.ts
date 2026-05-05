import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  HearingPrepListResponse,
  HearingPrepDetailResponse,
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
      apiClient.get<HearingPrepDetailResponse>(`/hearing-prep/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      const resp = query.state.data as HearingPrepDetailResponse | undefined;
      const pack = resp?.data;
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
