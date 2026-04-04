'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  AddReviewerPackItemInput,
  CreateReviewerPackInput,
  CursorListMeta,
  ReviewerPack,
  ReviewerPackItem,
  UpdateReviewerPackInput,
  UpdateReviewerPackItemInput,
} from '../types';

export function useReviewerPacks(params?: {
  barSubject?: string;
  visibility?: string;
  cursor?: string;
}) {
  return useQuery({
    queryKey: ['reviewer-packs', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = { limit: '20' };
      if (params?.barSubject) queryParams['barSubject'] = params.barSubject;
      if (params?.visibility) queryParams['visibility'] = params.visibility;
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      const res = await apiClient.get<{
        success: boolean;
        data: ReviewerPack[];
        meta: CursorListMeta;
      }>('/study/reviewer-packs', { params: queryParams });
      return res;
    },
  });
}

export function useReviewerPack(id: string) {
  return useQuery({
    queryKey: ['reviewer-pack', id],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: ReviewerPack & { items: ReviewerPackItem[] };
      }>(`/study/reviewer-packs/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateReviewerPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateReviewerPackInput) => {
      return apiClient.post<{ success: boolean; data: ReviewerPack }>(
        '/study/reviewer-packs',
        data,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewer-packs'] });
    },
  });
}

export function useUpdateReviewerPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateReviewerPackInput;
    }) => {
      return apiClient.patch<{ success: boolean; data: ReviewerPack }>(
        `/study/reviewer-packs/${id}`,
        data,
      );
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reviewer-packs'] });
      queryClient.invalidateQueries({ queryKey: ['reviewer-pack', variables.id] });
    },
  });
}

export function useDeleteReviewerPack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete(`/study/reviewer-packs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reviewer-packs'] });
    },
  });
}

export function useAddReviewerPackItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      packId,
      data,
    }: {
      packId: string;
      data: AddReviewerPackItemInput;
    }) => {
      return apiClient.post<{ success: boolean; data: ReviewerPackItem }>(
        `/study/reviewer-packs/${packId}/items`,
        data,
      );
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reviewer-pack', variables.packId] });
      queryClient.invalidateQueries({ queryKey: ['reviewer-packs'] });
    },
  });
}

export function useUpdateReviewerPackItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      packId,
      data,
    }: {
      id: string;
      packId: string;
      data: UpdateReviewerPackItemInput;
    }) => {
      return apiClient.patch<{ success: boolean; data: ReviewerPackItem }>(
        `/study/reviewer-pack-items/${id}`,
        data,
      );
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reviewer-pack', variables.packId] });
    },
  });
}

export function useDeleteReviewerPackItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, packId }: { id: string; packId: string }) => {
      return apiClient.delete(`/study/reviewer-pack-items/${id}`);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['reviewer-pack', variables.packId] });
      queryClient.invalidateQueries({ queryKey: ['reviewer-packs'] });
    },
  });
}
