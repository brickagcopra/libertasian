import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';

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
      // NO `.data`: `GET /admin/digests/review-stats` returns a bare
      // { success, data } envelope, which `apiClient` already strips.
      return apiClient.get<DerivativeStats>('/admin/digests/review-stats');
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
      // `.data` IS correct here: `GET /digests` returns { success, data, meta },
      // and the `meta` sibling stops `apiClient` unwrapping it. The generic
      // now names the real shape instead of inventing cursor/hasNext siblings.
      const res = await apiClient.get<{
        success: boolean;
        data: GenerationJob[];
        meta: { cursor: string | null; hasNext: boolean };
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
      // Bare { success, data } envelope — already unwrapped by `apiClient`.
      return apiClient.post<GenerationJob>('/digests/generate', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'derivatives'],
      });
      queryClient.invalidateQueries({ queryKey: ['digests'] });
    },
  });
}
