'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  CreateFlashcardInput,
  Flashcard,
  UpdateFlashcardInput,
} from '../types';

export function useFlashcards(setId: string) {
  return useQuery({
    queryKey: ['flashcards', setId],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: Flashcard[];
      }>(`/study/flashcard-sets/${setId}/flashcards`);
      return res;
    },
    enabled: !!setId,
  });
}

export function useCreateFlashcard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      setId,
      data,
    }: {
      setId: string;
      data: CreateFlashcardInput;
    }) => {
      return apiClient.post<{ success: boolean; data: Flashcard }>(
        `/study/flashcard-sets/${setId}/flashcards`,
        data,
      );
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['flashcards', variables.setId] });
      queryClient.invalidateQueries({ queryKey: ['flashcard-set', variables.setId] });
      queryClient.invalidateQueries({ queryKey: ['flashcard-sets'] });
    },
  });
}

export function useUpdateFlashcard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      setId,
      data,
    }: {
      id: string;
      setId: string;
      data: UpdateFlashcardInput;
    }) => {
      return apiClient.patch<{ success: boolean; data: Flashcard }>(
        `/study/flashcards/${id}`,
        data,
      );
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['flashcards', variables.setId] });
    },
  });
}

export function useDeleteFlashcard() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, setId }: { id: string; setId: string }) => {
      return apiClient.delete(`/study/flashcards/${id}`);
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['flashcards', variables.setId] });
      queryClient.invalidateQueries({ queryKey: ['flashcard-set', variables.setId] });
      queryClient.invalidateQueries({ queryKey: ['flashcard-sets'] });
    },
  });
}
