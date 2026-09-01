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
      // PUT, not PATCH. The server declares
      // `@Put('progress/:entityType/:entityId')` (study.controller.ts:745) and
      // has no PATCH handler on that path, so every save 404'd. It is an upsert
      // — the whole progress record is replaced — so PUT is also the correct
      // verb on the merits; the client was simply wrong about it.
      apiClient.put<StudyProgress>(
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
