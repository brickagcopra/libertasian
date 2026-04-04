import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type { StudyProgress, UpsertStudyProgressInput } from '../types';

export function useStudyProgressList() {
  return useQuery({
    queryKey: ['study', 'progress'],
    queryFn: () => apiClient.get<StudyProgress[]>('/study/progress'),
    staleTime: 2 * 60 * 1000,
  });
}

export function useStudyProgress(
  entityType: string,
  entityId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ['study', 'progress', entityType, entityId],
    queryFn: () =>
      apiClient.get<StudyProgress>(
        `/study/progress/${entityType}/${entityId}`,
      ),
    enabled: enabled && entityType.length > 0 && entityId.length > 0,
    staleTime: 2 * 60 * 1000,
  });
}

export function useUpsertStudyProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      entityType,
      entityId,
      input,
    }: {
      entityType: string;
      entityId: string;
      input: UpsertStudyProgressInput;
    }) =>
      apiClient.patch<StudyProgress>(
        `/study/progress/${entityType}/${entityId}`,
        input,
      ),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['study', 'progress'] });
      queryClient.invalidateQueries({
        queryKey: [
          'study',
          'progress',
          variables.entityType,
          variables.entityId,
        ],
      });
    },
  });
}
