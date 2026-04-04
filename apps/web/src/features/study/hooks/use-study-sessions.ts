'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  EndStudySessionInput,
  StartStudySessionInput,
  StudySession,
  StudyStats,
} from '../types';

export function useStudyStats() {
  return useQuery({
    queryKey: ['study-stats'],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: StudyStats;
      }>('/study/stats');
      return res.data;
    },
  });
}

export function useStartStudySession() {
  return useMutation({
    mutationFn: async (input: StartStudySessionInput) => {
      const res = await apiClient.post<{
        success: boolean;
        data: StudySession;
      }>('/study/sessions/start', input);
      return res.data;
    },
  });
}

export function useEndStudySession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sessionId,
      input,
    }: {
      sessionId: string;
      input: EndStudySessionInput;
    }) => {
      const res = await apiClient.post<{
        success: boolean;
        data: StudySession;
      }>(`/study/sessions/${sessionId}/end`, input);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['study-stats'] });
    },
  });
}
