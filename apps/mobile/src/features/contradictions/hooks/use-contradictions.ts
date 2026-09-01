import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  ContradictionListResponse,
  ContradictionReportDetail,
  ContradictionReportListItem,
  ContradictionFilters,
  GenerateContradictionInput,
} from '../types';

export function useContradictions(filters: ContradictionFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.status) params['status'] = filters.status;
  if (filters.scope) params['scope'] = filters.scope;

  return useQuery({
    queryKey: ['contradictions', filters],
    queryFn: () =>
      apiClient.get<ContradictionListResponse>('/contradictions', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useContradiction(id: string, enabled = true) {
  return useQuery({
    queryKey: ['contradiction', id],
    queryFn: () =>
      apiClient.get<ContradictionReportDetail>(`/contradictions/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      // NO second `.data`: `GET /contradictions/:id` returns a bare
      // { success, data } envelope, which `apiClient` already strips, so
      // `query.state.data` IS the detail object. Reading `.data` off it gave
      // `undefined` and the status check below could never be true — the poll
      // stopped immediately and a still-generating record never refreshed.
      const report = query.state.data as ContradictionReportDetail | undefined;
      if (
        report &&
        (report.status === 'pending' || report.status === 'generating')
      ) {
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
      apiClient.post<ContradictionReportListItem>(
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
