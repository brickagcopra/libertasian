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
      const res = await apiClient.get<{
        success: boolean;
        data: FlashcardReviewStats;
      }>(`/study/flashcard-sets/${setId}/review-stats`);
      return res.data;
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
      const res = await apiClient.post<{
        success: boolean;
        data: FlashcardReview;
      }>(`/study/flashcards/${flashcardId}/review`, input);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['flashcard-review-stats'] });
      queryClient.invalidateQueries({ queryKey: ['study-stats'] });
    },
  });
}
