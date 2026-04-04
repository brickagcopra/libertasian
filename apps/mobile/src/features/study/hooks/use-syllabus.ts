import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
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
    queryFn: () => apiClient.get<BarSyllabus[]>('/study/syllabi'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSyllabus(code: string) {
  return useQuery({
    queryKey: ['syllabi', 'subject', code],
    queryFn: () =>
      apiClient.get<SyllabusWithTopics>(
        `/study/syllabi/subject/${encodeURIComponent(code)}`,
      ),
    enabled: !!code,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSyllabusTopic(syllabusId: string, topicId: string) {
  return useQuery({
    queryKey: ['syllabi', syllabusId, 'topics', topicId],
    queryFn: () =>
      apiClient.get<SyllabusTopic>(
        `/study/syllabi/${syllabusId}/topics/${topicId}`,
      ),
    enabled: !!syllabusId && !!topicId,
  });
}

export function useSyllabusProgress(syllabusId: string) {
  return useQuery({
    queryKey: ['syllabi', syllabusId, 'progress'],
    queryFn: () =>
      apiClient.get<SyllabusProgressSummary>(
        `/study/syllabi/${syllabusId}/progress`,
      ),
    enabled: !!syllabusId,
  });
}

export function useBarExamReadiness() {
  return useQuery({
    queryKey: ['bar-readiness'],
    queryFn: () => apiClient.get<BarExamReadiness>('/study/bar-readiness'),
  });
}

export function useUpsertSyllabusTopicProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      topicId,
      data,
    }: {
      topicId: string;
      data: UpsertSyllabusTopicProgressInput;
    }) =>
      apiClient.put<StudyProgress>(
        `/study/syllabi/topics/${topicId}/progress`,
        data,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syllabi'] });
      queryClient.invalidateQueries({ queryKey: ['bar-readiness'] });
    },
  });
}
