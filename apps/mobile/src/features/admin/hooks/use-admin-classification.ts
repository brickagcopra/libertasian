import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { ApiResponse, PaginatedResponse } from '../types';

// ---- Types ----

export interface ClassificationReviewItem {
  id: string;
  legalDocumentId: string;
  documentTitle: string;
  predictedPrimary: string | null;
  predictedSecondary: string | null;
  confidence: number;
  createdAt: string;
}

export interface ClassificationStats {
  pendingReview: number;
  confirmedCount: number;
  rejectedCount: number;
  overriddenCount: number;
}

export interface ClassificationDetail extends ClassificationReviewItem {
  documentType: string | null;
  court: string | null;
}

interface ClassificationQueueFilters {
  cursor?: string;
  limit?: number;
}

// ---- Hooks ----

export function useClassificationQueue(
  filters: ClassificationQueueFilters = {},
) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);

  return useQuery({
    queryKey: ['admin', 'classification', 'queue', filters],
    queryFn: async () => {
      const res = await apiClient.get<PaginatedResponse<ClassificationReviewItem>>(
        '/admin/classification/review-queue',
        { params },
      );
      return { items: res.data, meta: res.meta };
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useClassificationStats() {
  return useQuery({
    queryKey: ['admin', 'classification', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ClassificationStats>>(
        '/admin/classification/stats',
      );
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

export function useClassificationDetail(id: string) {
  return useQuery({
    queryKey: ['admin', 'classification', 'detail', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ClassificationDetail>>(
        `/admin/classification/${id}`,
      );
      return res.data;
    },
    enabled: id.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useConfirmClassification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      await apiClient.post('/admin/classification/confirm', {
        classificationId: id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'classification'],
      });
    },
  });
}

export function useRejectClassification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      await apiClient.post('/admin/classification/reject', {
        classificationId: id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'classification'],
      });
    },
  });
}

export function useOverrideClassification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      primaryCode,
      secondaryCode,
    }: {
      id: string;
      primaryCode: string;
      secondaryCode?: string;
    }) => {
      await apiClient.post('/admin/classification/override', {
        classificationId: id,
        primaryCode,
        secondaryCode,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['admin', 'classification'],
      });
    },
  });
}
