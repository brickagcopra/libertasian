import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
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
      // NO `.data`: every `/study/*` endpoint below returns a bare
      // { success, data } envelope, which `apiClient` already strips.
      return apiClient.get<StudyStats>('/study/stats');
    },
  });
}

export function useStartStudySession() {
  return useMutation({
    mutationFn: async (input: StartStudySessionInput) => {
      return apiClient.post<StudySession>('/study/sessions/start', input);
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
      return apiClient.post<StudySession>(
        `/study/sessions/${sessionId}/end`,
        input,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['study-stats'] });
    },
  });
}
