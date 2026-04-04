'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type { StudyProgress, UpsertStudyProgressInput } from '../types';

export function useStudyProgressList() {
  return useQuery({
    queryKey: ['study-progress'],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: StudyProgress[];
      }>('/study/progress');
      return res;
    },
  });
}

export function useStudyProgress(entityType: string, entityId: string) {
  return useQuery({
    queryKey: ['study-progress', entityType, entityId],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: StudyProgress;
      }>(`/study/progress/${encodeURIComponent(entityType)}/${entityId}`);
      return res.data;
    },
    enabled: !!entityType && !!entityId,
  });
}

export function useUpsertStudyProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      entityType,
      entityId,
      data,
    }: {
      entityType: string;
      entityId: string;
      data: UpsertStudyProgressInput;
    }) => {
      return apiClient.patch<{ success: boolean; data: StudyProgress }>(
        `/study/progress/${encodeURIComponent(entityType)}/${entityId}`,
        data,
      );
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['study-progress'] });
      queryClient.invalidateQueries({
        queryKey: ['study-progress', variables.entityType, variables.entityId],
      });
    },
  });
}
