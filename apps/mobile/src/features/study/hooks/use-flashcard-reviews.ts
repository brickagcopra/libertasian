import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  FlashcardReview,
  FlashcardReviewStats,
  SubmitFlashcardReviewInput,
} from '../types';

export function useFlashcardReviewStats(setId: string) {
  return useQuery({
    queryKey: ['flashcard-review-stats', setId],
    queryFn: async () => {
      // NO `.data`: bare { success, data } envelope, already stripped by
      // `apiClient`.
      return apiClient.get<FlashcardReviewStats>(
        `/study/flashcard-sets/${setId}/review-stats`,
      );
    },
    enabled: !!setId,
  });
}

export function useSubmitFlashcardReview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      flashcardId,
      input,
    }: {
      flashcardId: string;
      input: SubmitFlashcardReviewInput;
    }) => {
      return apiClient.post<FlashcardReview>(
        `/study/flashcards/${flashcardId}/review`,
        input,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-review-stats'] });
      queryClient.invalidateQueries({ queryKey: ['study-stats'] });
    },
  });
}
