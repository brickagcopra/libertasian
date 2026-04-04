'use client';

import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { AiAnswerResponse } from '../types';

interface AiAnswerApiResponse {
  success: boolean;
  data: AiAnswerResponse;
  meta: {
    quota: { used: number; limit: number; remaining: number };
  };
}

export function useAiAnswer(query: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['ai-answer', query],
    queryFn: async () => {
      if (!query) return null;
      return apiClient.post<AiAnswerApiResponse>('/ai-answers', { query });
    },
    enabled: enabled && !!query,
    staleTime: 5 * 60 * 1000,
  });
}
