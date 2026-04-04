'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  ComparisonListResponse,
  ComparisonDetailResponse,
  CaseComparisonDetail,
  CaseComparisonListItem,
  ComparisonFilters,
  GenerateComparisonInput,
} from '../types';

export function useComparisons(params?: ComparisonFilters) {
  return useQuery({
    queryKey: ['case-comparisons', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (params?.comparisonType) queryParams['comparisonType'] = params.comparisonType;
      if (params?.status) queryParams['status'] = params.status;
      if (params?.matterId) queryParams['matterId'] = params.matterId;
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<ComparisonListResponse>('/case-comparisons', { params: queryParams });
    },
  });
}

export function useComparison(id: string | null) {
  return useQuery({
    queryKey: ['case-comparison', id],
    queryFn: async () => {
      const res = await apiClient.get<ComparisonDetailResponse>(`/case-comparisons/${id}`);
      return res.data;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const comparison = query.state.data as CaseComparisonDetail | undefined;
      if (comparison && (comparison.status === 'pending' || comparison.status === 'generating')) {
        return 3000;
      }
      return false;
    },
  });
}

export function useGenerateComparison() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: GenerateComparisonInput) =>
      apiClient.post<{ success: boolean; data: CaseComparisonListItem }>(
        '/case-comparisons/generate',
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-comparisons'] });
    },
  });
}

export function useDeleteComparison() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/case-comparisons/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-comparisons'] });
    },
  });
}
