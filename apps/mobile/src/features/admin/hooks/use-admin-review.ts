import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  ReviewQueueItem,
  ReviewQueueStats,
  PaginatedResponse,
  ApiResponse,
  BatchReviewResult,
  SubmitReviewResult,
  ReviewQueueFilters,
} from '../types';

// ---- Review Queue List ----

export function useReviewQueue(filters: ReviewQueueFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.reviewStatus) params['reviewStatus'] = filters.reviewStatus;
  if (filters.sourceOrigin) params['sourceOrigin'] = filters.sourceOrigin;
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);

  return useQuery({
    queryKey: ['admin', 'review', 'queue', filters],
    queryFn: async () => {
      const res = await apiClient.get<PaginatedResponse<ReviewQueueItem>>(
        '/admin/digests/review-queue',
        { params },
      );
      return { items: res.data, meta: res.meta };
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ---- Review Queue Stats ----

export function useReviewStats() {
  return useQuery({
    queryKey: ['admin', 'review', 'stats'],
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<ReviewQueueStats>>(
        '/admin/digests/review-stats',
      );
      return res.data;
    },
    staleTime: 2 * 60 * 1000,
  });
}

// ---- Submit Review ----

export function useSubmitReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      verdict,
      notes,
    }: {
      id: string;
      verdict: 'approve' | 'reject' | 'needs_revision';
      notes?: string;
    }) => {
      const res = await apiClient.post<ApiResponse<SubmitReviewResult>>(
        `/admin/digests/${id}/review`,
        { verdict, notes },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'review'] });
    },
  });
}

// ---- Assign Reviewer ----

export function useAssignReviewer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      reviewerUserId,
    }: {
      id: string;
      reviewerUserId: string;
    }) => {
      await apiClient.post(`/admin/digests/${id}/assign`, { reviewerUserId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'review'] });
    },
  });
}

// ---- Unassign Reviewer ----

export function useUnassignReviewer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      await apiClient.post(`/admin/digests/${id}/unassign`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'review'] });
    },
  });
}

// ---- Batch Approve ----

export function useBatchApprove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ digestIds }: { digestIds: string[] }) => {
      const res = await apiClient.post<ApiResponse<BatchReviewResult>>(
        '/admin/digests/batch-approve',
        { digestIds },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'review'] });
    },
  });
}

// ---- Batch Reject ----

export function useBatchReject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      digestIds,
      reason,
    }: {
      digestIds: string[];
      reason?: string;
    }) => {
      const res = await apiClient.post<ApiResponse<BatchReviewResult>>(
        '/admin/digests/batch-reject',
        { digestIds, reason },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'review'] });
    },
  });
}
