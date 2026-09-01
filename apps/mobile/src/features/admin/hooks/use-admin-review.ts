import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  ReviewQueueItem,
  ReviewQueueStats,
  PaginatedResponse,
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
      // NO `.data`: `GET /admin/digests/review-stats` returns a bare
      // { success, data } envelope, which `apiClient` already strips.
      return apiClient.get<ReviewQueueStats>('/admin/digests/review-stats');
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
      // Bare { success, data } envelope — already unwrapped by `apiClient`.
      return apiClient.post<SubmitReviewResult>(`/admin/digests/${id}/review`, {
        verdict,
        notes,
      });
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
      // Bare { success, data } envelope — already unwrapped by `apiClient`.
      return apiClient.post<BatchReviewResult>('/admin/digests/batch-approve', {
        digestIds,
      });
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
      // Bare { success, data } envelope — already unwrapped by `apiClient`.
      return apiClient.post<BatchReviewResult>('/admin/digests/batch-reject', {
        digestIds,
        reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'review'] });
    },
  });
}
