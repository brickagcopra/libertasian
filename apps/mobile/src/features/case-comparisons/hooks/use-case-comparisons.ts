import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  ComparisonListResponse,
  ComparisonDetailResponse,
  CaseComparisonListItem,
  ComparisonFilters,
  GenerateComparisonInput,
} from '../types';

export function useComparisons(filters: ComparisonFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.comparisonType) params['comparisonType'] = filters.comparisonType;
  if (filters.status) params['status'] = filters.status;
  if (filters.matterId) params['matterId'] = filters.matterId;

  return useQuery({
    queryKey: ['case-comparisons', filters],
    queryFn: () =>
      apiClient.get<ComparisonListResponse>('/case-comparisons', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useComparison(id: string, enabled = true) {
  return useQuery({
    queryKey: ['case-comparison', id],
    queryFn: () =>
      apiClient.get<ComparisonDetailResponse>(`/case-comparisons/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      const resp = query.state.data as ComparisonDetailResponse | undefined;
      const comparison = resp?.data;
      if (
        comparison &&
        (comparison.status === 'pending' || comparison.status === 'generating')
      ) {
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
      apiClient.post<CaseComparisonListItem>(
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
