import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  ReviewerPack,
  ReviewerPackItem,
  CursorListMeta,
  CreateReviewerPackInput,
  UpdateReviewerPackInput,
  AddReviewerPackItemInput,
  UpdateReviewerPackItemInput,
} from '../types';

interface ReviewerPacksResponse {
  data: ReviewerPack[];
  meta: CursorListMeta;
}

interface ReviewerPackDetail extends ReviewerPack {
  items: ReviewerPackItem[];
}

interface ReviewerPackFilters {
  barSubject?: string;
  cursor?: string;
  limit?: number;
}

export function useReviewerPacks(filters: ReviewerPackFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.barSubject) params['barSubject'] = filters.barSubject;

  return useQuery({
    queryKey: ['study', 'reviewer-packs', filters],
    queryFn: () =>
      apiClient.get<ReviewerPacksResponse>('/study/reviewer-packs', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useReviewerPack(id: string, enabled = true) {
  return useQuery({
    queryKey: ['study', 'reviewer-pack', id],
    queryFn: () =>
      apiClient.get<ReviewerPackDetail>(`/study/reviewer-packs/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateReviewerPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateReviewerPackInput) =>
      apiClient.post<ReviewerPack>('/study/reviewer-packs', input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['study', 'reviewer-packs'],
      });
    },
  });
}

export function useUpdateReviewerPack(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateReviewerPackInput) =>
      apiClient.patch<ReviewerPack>(`/study/reviewer-packs/${id}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['study', 'reviewer-packs'],
      });
      queryClient.invalidateQueries({
        queryKey: ['study', 'reviewer-pack', id],
      });
    },
  });
}

export function useDeleteReviewerPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/study/reviewer-packs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['study', 'reviewer-packs'],
      });
    },
  });
}

export function useAddReviewerPackItem(packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddReviewerPackItemInput) =>
      apiClient.post<ReviewerPackItem>(
        `/study/reviewer-packs/${packId}/items`,
        input,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['study', 'reviewer-pack', packId],
      });
      queryClient.invalidateQueries({
        queryKey: ['study', 'reviewer-packs'],
      });
    },
  });
}

export function useUpdateReviewerPackItem(packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: UpdateReviewerPackItemInput;
    }) => apiClient.patch<ReviewerPackItem>(`/study/reviewer-pack-items/${id}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['study', 'reviewer-pack', packId],
      });
    },
  });
}

export function useDeleteReviewerPackItem(packId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/study/reviewer-pack-items/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['study', 'reviewer-pack', packId],
      });
      queryClient.invalidateQueries({
        queryKey: ['study', 'reviewer-packs'],
      });
    },
  });
}
