import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  FlashcardSet,
  CursorListMeta,
  CreateFlashcardSetInput,
  UpdateFlashcardSetInput,
} from '../types';

interface FlashcardSetsResponse {
  data: FlashcardSet[];
  meta: CursorListMeta;
}

interface FlashcardSetFilters {
  barSubject?: string;
  cursor?: string;
  limit?: number;
}

export function useFlashcardSets(filters: FlashcardSetFilters = {}) {
  const params: Record<string, string> = {};
  if (filters.cursor) params['cursor'] = filters.cursor;
  if (filters.limit) params['limit'] = String(filters.limit);
  if (filters.barSubject) params['barSubject'] = filters.barSubject;

  return useQuery({
    queryKey: ['study', 'flashcard-sets', filters],
    queryFn: () =>
      apiClient.get<FlashcardSetsResponse>('/study/flashcard-sets', { params }),
    staleTime: 2 * 60 * 1000,
  });
}

export function useFlashcardSet(id: string, enabled = true) {
  return useQuery({
    queryKey: ['study', 'flashcard-set', id],
    queryFn: () => apiClient.get<FlashcardSet>(`/study/flashcard-sets/${id}`),
    enabled: enabled && id.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateFlashcardSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFlashcardSetInput) =>
      apiClient.post<FlashcardSet>('/study/flashcard-sets', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['study', 'flashcard-sets'] });
    },
  });
}

export function useUpdateFlashcardSet(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateFlashcardSetInput) =>
      apiClient.patch<FlashcardSet>(`/study/flashcard-sets/${id}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['study', 'flashcard-sets'] });
      queryClient.invalidateQueries({
        queryKey: ['study', 'flashcard-set', id],
      });
    },
  });
}

export function useDeleteFlashcardSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`/study/flashcard-sets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['study', 'flashcard-sets'] });
    },
  });
}
