'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

// ---- Types ----

export interface SubjectItem {
  id: string;
  code: string;
  name: string;
  taxonomyVersion: string;
  weightPercent: number | null;
  displayOrder: number;
  description: string | null;
}

export interface SubjectTopic {
  id: string;
  subjectId: string;
  code: string;
  name: string;
  description: string | null;
  displayOrder: number;
}

export interface ClassificationCoverage {
  totalDocuments: number;
  classifiedDocuments: number;
  unclassifiedDocuments: number;
  coveragePercent: number;
  bySubject: Array<{
    subjectId: string;
    subjectCode: string;
    subjectName: string;
    documentCount: number;
    primaryCount: number;
  }>;
}

export interface SubjectEquivalence {
  id: string;
  studySubjectId: string;
  barAdminSubjectId: string;
  relationship: string;
  notes: string | null;
  studySubject?: SubjectItem;
  barAdminSubject?: SubjectItem;
}

// The /subjects controller returns raw payloads (no { success, data } envelope),
// unlike most admin endpoints — apiClient.get returns response.json() as-is, so
// type and consume the response directly.

// ---- Queries ----

export function useSubjects(taxonomy?: string) {
  return useQuery({
    queryKey: ['admin', 'subjects', taxonomy],
    queryFn: async () => {
      const qp: Record<string, string> = {};
      if (taxonomy) qp['taxonomy'] = taxonomy;
      return apiClient.get<SubjectItem[]>('/subjects', { params: qp });
    },
  });
}

export function useSubjectTopics(subjectId: string) {
  return useQuery({
    queryKey: ['admin', 'subjects', subjectId, 'topics'],
    queryFn: async () => apiClient.get<SubjectTopic[]>(`/subjects/${subjectId}/topics`),
    enabled: !!subjectId,
  });
}

export function useClassificationCoverage() {
  return useQuery({
    queryKey: ['admin', 'subjects', 'coverage'],
    queryFn: async () => apiClient.get<ClassificationCoverage>('/subjects/coverage'),
  });
}

export function useSubjectEquivalences(studySubjectId: string) {
  return useQuery({
    queryKey: ['admin', 'subjects', 'equivalences', studySubjectId],
    queryFn: async () =>
      apiClient.get<SubjectEquivalence[]>(`/subjects/equivalences/${studySubjectId}`),
    enabled: !!studySubjectId,
  });
}

// ---- Mutations ----

export function useClassifyUnclassified() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      apiClient.post<{ message: string }>('/subjects/batch-classify'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'subjects'] });
    },
  });
}
