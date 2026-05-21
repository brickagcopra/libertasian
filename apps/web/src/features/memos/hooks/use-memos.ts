'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  MemoListResponse,
  MemoDetailResponse,
  MemoDetail,
  MemoListItem,
  MemoFilters,
  GenerateMemoInput,
} from '../types';

export function useMemos(params?: MemoFilters, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['memos', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: String(params?.limit ?? 20),
      };
      if (params?.memoType) queryParams['memoType'] = params.memoType;
      if (params?.status) queryParams['status'] = params.status;
      if (params?.matterId) queryParams['matterId'] = params.matterId;
      if (params?.cursor) queryParams['cursor'] = params.cursor;

      return apiClient.get<MemoListResponse>('/memos', { params: queryParams });
    },
    enabled: options?.enabled ?? true,
  });
}

export function useMemo(id: string | null) {
  return useQuery({
    queryKey: ['memo', id],
    queryFn: async () => {
      const res = await apiClient.get<MemoDetailResponse>(`/memos/${id}`);
      return res.data;
    },
    enabled: !!id,
    refetchInterval: (query) => {
      const memo = query.state.data as MemoDetail | undefined;
      // Poll every 3s while memo is pending/generating
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
      apiClient.post<{ success: boolean; data: MemoListItem }>(
        '/memos/generate',
        data,
      ),
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
