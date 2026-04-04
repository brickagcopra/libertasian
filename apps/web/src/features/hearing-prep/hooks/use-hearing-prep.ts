'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  HearingPrepListResponse,
  HearingPrepDetailResponse,
  HearingPrepDetail,
  HearingPrepListItem,
  HearingPrepFilters,
  GenerateHearingPrepInput,
} from '../types';

export function useHearingPreps(params?: HearingPrepFilters) {
  return useQuery({
    queryKey: ['hearing-preps', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (params?.status) queryParams['status'] = params.status;
      if (params?.matterId) queryParams['matterId'] = params.matterId;
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<HearingPrepListResponse>('/hearing-prep', { params: queryParams });
    },
  });
}

export function useHearingPrep(id: string | null) {
  return useQuery({
    queryKey: ['hearing-prep', id],
    queryFn: async () => {
      const res = await apiClient.get<HearingPrepDetailResponse>(`/hearing-prep/${id}`);
      return res.data;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const pack = query.state.data as HearingPrepDetail | undefined;
      if (pack && (pack.status === 'pending' || pack.status === 'generating')) {
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
      apiClient.post<{ success: boolean; data: HearingPrepListItem }>(
        '/hearing-prep/generate',
        data,
      ),
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
