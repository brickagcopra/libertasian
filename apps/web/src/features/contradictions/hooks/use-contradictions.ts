'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  ContradictionListResponse,
  ContradictionDetailResponse,
  ContradictionReportDetail,
  ContradictionReportListItem,
  ContradictionFilters,
  GenerateContradictionInput,
} from '../types';

export function useContradictions(params?: ContradictionFilters) {
  return useQuery({
    queryKey: ['contradictions', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (params?.status) queryParams['status'] = params.status;
      if (params?.scope) queryParams['scope'] = params.scope;
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<ContradictionListResponse>('/contradictions', { params: queryParams });
    },
  });
}

export function useContradiction(id: string | null) {
  return useQuery({
    queryKey: ['contradiction', id],
    queryFn: async () => {
      const res = await apiClient.get<ContradictionDetailResponse>(`/contradictions/${id}`);
      return res.data;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const report = query.state.data as ContradictionReportDetail | undefined;
      if (report && (report.status === 'pending' || report.status === 'generating')) {
        return 3000;
      }
      return false;
    },
  });
}

export function useGenerateContradiction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: GenerateContradictionInput) =>
      apiClient.post<{ success: boolean; data: ContradictionReportListItem }>(
        '/contradictions/generate',
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contradictions'] });
    },
  });
}

export function useDeleteContradiction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/contradictions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contradictions'] });
    },
  });
}
