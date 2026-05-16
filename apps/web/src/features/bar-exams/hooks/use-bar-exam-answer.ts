'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import type { BarExamAnswer } from '../types';

interface Options {
  enabled: boolean;
}

/**
 * Fetch the approved AI ALAC answer for a single bar exam question.
 *
 * The endpoint consumes one `aiAnswers` quota unit per call, so callers
 * MUST gate `enabled` on user intent (e.g. accordion open). retry=false
 * because 402 / 429 are deterministic states the UI must show, not
 * transient errors to paper over.
 */
export function useBarExamAnswer(questionId: string, opts: Options) {
  return useQuery({
    queryKey: ['bar-exam-answer', questionId],
    enabled: opts.enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await apiClient.get<{ success: true; data: BarExamAnswer }>(
        `/bar-exams/questions/${encodeURIComponent(questionId)}/answer`,
      );
      return res.data;
    },
  });
}
