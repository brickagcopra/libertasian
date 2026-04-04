'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { GenerateFlashcardsResponse } from '../types';

interface GenerateFlashcardsParams {
  uploadId: string;
  flashcardSetId: string;
  cardType?: string;
  count?: number;
  barSubject?: string;
}

export function useGenerateFlashcardsFromScan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ uploadId, ...body }: GenerateFlashcardsParams) =>
      apiClient.post<GenerateFlashcardsResponse>(
        `/uploads/${uploadId}/generate-flashcards`,
        body,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['scan-detail', variables.uploadId] });
      queryClient.invalidateQueries({ queryKey: ['flashcard-sets'] });
    },
  });
}
