'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';
import type {
  BarSyllabus,
  SyllabusWithTopics,
  SyllabusTopic,
  SyllabusProgressSummary,
  BarExamReadiness,
  UpsertSyllabusTopicProgressInput,
  StudyProgress,
} from '../types';

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
  });
}

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syllabi'] });
      queryClient.invalidateQueries({ queryKey: ['bar-readiness'] });
    },
  });
}
