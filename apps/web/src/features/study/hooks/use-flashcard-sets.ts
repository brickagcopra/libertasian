'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  CreateFlashcardSetInput,
  CursorListMeta,
  FlashcardSet,
  UpdateFlashcardSetInput,
} from '../types';

export function useFlashcardSets(params?: {
  barSubject?: string;
  visibility?: string;
  cursor?: string;
}) {
  return useQuery({
    queryKey: ['flashcard-sets', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = { limit: '20' };
      if (params?.barSubject) queryParams['barSubject'] = params.barSubject;
      if (params?.visibility) queryParams['visibility'] = params.visibility;
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      const res = await apiClient.get<{
        success: boolean;
        data: FlashcardSet[];
        meta: CursorListMeta;
      }>('/study/flashcard-sets', { params: queryParams });
      return res;
    },
  });
}

export function useFlashcardSet(id: string) {
  return useQuery({
    queryKey: ['flashcard-set', id],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: FlashcardSet;
      }>(`/study/flashcard-sets/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateFlashcardSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateFlashcardSetInput) => {
      return apiClient.post<{ success: boolean; data: FlashcardSet }>(
        '/study/flashcard-sets',
        data,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-sets'] });
    },
  });
}

export function useUpdateFlashcardSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateFlashcardSetInput;
    }) => {
      return apiClient.patch<{ success: boolean; data: FlashcardSet }>(
        `/study/flashcard-sets/${id}`,
        data,
      );
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-sets'] });
      queryClient.invalidateQueries({ queryKey: ['flashcard-set', variables.id] });
    },
  });
}

export function useDeleteFlashcardSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete(`/study/flashcard-sets/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-sets'] });
    },
  });
}
