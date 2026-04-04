import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  Flashcard,
  CreateFlashcardInput,
  UpdateFlashcardInput,
} from '../types';

export function useFlashcards(setId: string, enabled = true) {
  return useQuery({
    queryKey: ['study', 'flashcards', setId],
    queryFn: () =>
      apiClient.get<Flashcard[]>(
        `/study/flashcard-sets/${setId}/flashcards`,
      ),
    enabled: enabled && setId.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateFlashcard(setId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFlashcardInput) =>
      apiClient.post<Flashcard>(
        `/study/flashcard-sets/${setId}/flashcards`,
        input,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['study', 'flashcards', setId],
      });
      queryClient.invalidateQueries({
        queryKey: ['study', 'flashcard-set', setId],
      });
      queryClient.invalidateQueries({
        queryKey: ['study', 'flashcard-sets'],
      });
    },
  });
}

export function useUpdateFlashcard(setId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateFlashcardInput }) =>
      apiClient.patch<Flashcard>(`/study/flashcards/${id}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['study', 'flashcards', setId],
      });
    },
  });
}

export function useDeleteFlashcard(setId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/study/flashcards/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['study', 'flashcards', setId],
      });
      queryClient.invalidateQueries({
        queryKey: ['study', 'flashcard-set', setId],
      });
      queryClient.invalidateQueries({
        queryKey: ['study', 'flashcard-sets'],
      });
    },
  });
}
