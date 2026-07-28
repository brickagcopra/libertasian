'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, ApiClientError } from '@/lib/api-client';
import type {
  BarSyllabus,
  SyllabusWithTopics,
  SyllabusTopic,
  SyllabusProgressSummary,
  BarExamReadiness,
  UpsertSyllabusTopicProgressInput,
  StudyProgress,
} from '../types';

/**
 * Study progress and bar readiness are Edu+ entitlements
 * (SubscriptionGuard on GET /study/syllabi/:id/progress, GET
 * /study/bar-readiness and PUT .../progress). A free org gets a deterministic
 * 403 on those routes — retrying it only burns requests, so never retry a 4xx
 * here. The surfaces already render the "no progress yet" empty state when
 * `data` is undefined, so the 403 degrades to an unticked checklist rather
 * than an error.
 */
function retryUnlessClientError(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiClientError && error.statusCode >= 400 && error.statusCode < 500) {
    return false;
  }
  return failureCount < 1;
}

export function useSyllabi() {
  return useQuery({
    queryKey: ['syllabi'],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: BarSyllabus[];
      }>('/study/syllabi');
      return res;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useSyllabus(code: string) {
  return useQuery({
    queryKey: ['syllabi', 'subject', code],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: SyllabusWithTopics;
      }>(`/study/syllabi/subject/${encodeURIComponent(code)}`);
      return res.data;
    },
    enabled: !!code,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSyllabusTopic(syllabusId: string, topicId: string) {
  return useQuery({
    queryKey: ['syllabi', syllabusId, 'topics', topicId],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: SyllabusTopic;
      }>(`/study/syllabi/${syllabusId}/topics/${topicId}`);
      return res.data;
    },
    enabled: !!syllabusId && !!topicId,
  });
}

export function useSyllabusProgress(syllabusId: string) {
  return useQuery({
    queryKey: ['syllabi', syllabusId, 'progress'],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: SyllabusProgressSummary;
      }>(`/study/syllabi/${syllabusId}/progress`);
      return res.data;
    },
    enabled: !!syllabusId,
    retry: retryUnlessClientError,
  });
}

export function useBarExamReadiness() {
  return useQuery({
    queryKey: ['bar-readiness'],
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: BarExamReadiness;
      }>('/study/bar-readiness');
      return res.data;
    },
    retry: retryUnlessClientError,
  });
}

/**
 * PUT /study/syllabi/topics/:topicId/progress is Edu+. Below that tier the
 * write 403s; there is no global mutation error handler and no caller reads
 * `isError`, so the failure is swallowed by design — the checkbox stays
 * unticked and nothing is retried or toasted.
 */
export function useUpsertSyllabusTopicProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      topicId,
      data,
    }: {
      topicId: string;
      data: UpsertSyllabusTopicProgressInput;
    }) => {
      return apiClient.put<{ success: boolean; data: StudyProgress }>(
        `/study/syllabi/topics/${topicId}/progress`,
        data,
      );
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syllabi'] });
      queryClient.invalidateQueries({ queryKey: ['bar-readiness'] });
    },
  });
}
