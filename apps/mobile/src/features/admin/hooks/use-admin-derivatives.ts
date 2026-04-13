import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { ApiResponse } from '../types';

// ---- Types ----

export interface DerivativeStats {
  totalDigests: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  pendingReview: number;
  avgConfidence: number;
}

export interface GenerationJob {
  id: string;
  digestType: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  legalDocumentId: string;
  documentTitle: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

interface GenerationJobFilters {
  orderBy?: string;
  orderDirection?: string;
  limit?: number;
}

// ---- Hooks ----

export function useDerivativeStats() {
  return useQuery({
    queryKey: ['admin', 'derivatives', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<DerivativeStats>>(
        '/admin/digests/review-stats',
      );
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useRecentGenerationJobs(filters: GenerationJobFilters = {}) {
  const params: Record<string, string> = {
    orderBy: filters.orderBy ?? 'createdAt',
    orderDirection: filters.orderDirection ?? 'desc',
    limit: String(filters.limit ?? 20),
  };

  return useQuery({
    queryKey: ['admin', 'derivatives', 'jobs', filters],
    queryFn: async () => {
      const res = await apiClient.get<{
        data: GenerationJob[];
        cursor: string | null;
        hasNext: boolean;
      }>('/digests', { params });
      return res.data;
    },
    staleTime: 60 * 1000,
  });
}

export function useTriggerDigestGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      legalDocumentId: string;
      digestType: string;
    }) => {
      const res = await apiClient.post<ApiResponse<GenerationJob>>(
        '/digests/generate',
        data,
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'derivatives'],
      });
      queryClient.invalidateQueries({ queryKey: ['digests'] });
    },
  });
}
