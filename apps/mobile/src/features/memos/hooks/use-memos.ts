import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  MemoListResponse,
  MemoDetail,
  MemoListItem,
  MemoFilters,
  GenerateMemoInput,
} from '../types';

export function useMemos(filters: MemoFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.memoType) params['memoType'] = filters.memoType;
  if (filters.status) params['status'] = filters.status;
  if (filters.matterId) params['matterId'] = filters.matterId;

  return useQuery({
    queryKey: ['memos', filters],
    queryFn: () => apiClient.get<MemoListResponse>('/memos', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useMemo(id: string, enabled = true) {
  return useQuery({
    queryKey: ['memo', id],
    queryFn: () => apiClient.get<MemoDetail>(`/memos/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchInterval: (query) => {
      // NO second `.data`: `GET /memos/:id` returns a bare
      // { success, data } envelope, which `apiClient` already strips, so
      // `query.state.data` IS the detail object. Reading `.data` off it gave
      // `undefined` and the status check below could never be true — the poll
      // stopped immediately and a still-generating record never refreshed.
      const memo = query.state.data as MemoDetail | undefined;
      if (memo && (memo.status === 'pending' || memo.status === 'generating')) {
        return 3000;
      }
      return false;
    },
  });
}

export function useGenerateMemo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: GenerateMemoInput) =>
      apiClient.post<MemoListItem>('/memos/generate', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    },
  });
}

export function useDeleteMemo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/memos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memos'] });
    },
  });
}
