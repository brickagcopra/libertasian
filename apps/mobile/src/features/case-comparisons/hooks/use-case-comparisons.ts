import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  ComparisonListResponse,
  CaseComparisonDetail,
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
      apiClient.get<CaseComparisonDetail>(`/case-comparisons/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      // NO second `.data`: `GET /case-comparisons/:id` returns a bare
      // { success, data } envelope, which `apiClient` already strips, so
      // `query.state.data` IS the detail object. Reading `.data` off it gave
      // `undefined` and the status check below could never be true — the poll
      // stopped immediately and a still-generating record never refreshed.
      const comparison = query.state.data as CaseComparisonDetail | undefined;
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
