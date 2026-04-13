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

// ---- Queries ----

export function useSubjects(taxonomy?: string) {
  return useQuery({
    queryKey: ['admin', 'subjects', taxonomy],
    queryFn: async () => {
      const qp: Record<string, string> = {};
      if (taxonomy) qp['taxonomy'] = taxonomy;
      const res = await apiClient.get<SubjectItem[]>('/subjects', { params: qp });
      return res;
    },
  });
}

export function useSubjectTopics(subjectId: string) {
  return useQuery({
    queryKey: ['admin', 'subjects', subjectId, 'topics'],
    queryFn: async () => {
      const res = await apiClient.get<SubjectTopic[]>(`/subjects/${subjectId}/topics`);
      return res;
    },
    enabled: !!subjectId,
  });
}

export function useClassificationCoverage() {
  return useQuery({
    queryKey: ['admin', 'subjects', 'coverage'],
    queryFn: async () => {
      const res = await apiClient.get<ClassificationCoverage>('/subjects/coverage');
      return res;
    },
  });
}

export function useSubjectEquivalences(studySubjectId: string) {
  return useQuery({
    queryKey: ['admin', 'subjects', 'equivalences', studySubjectId],
    queryFn: async () => {
      const res = await apiClient.get<SubjectEquivalence[]>(
        `/subjects/equivalences/${studySubjectId}`,
      );
      return res;
    },
    enabled: !!studySubjectId,
  });
}

// ---- Mutations ----

export function useClassifyUnclassified() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ success: boolean; message: string }>(
        '/subjects/batch-classify',
      );
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'subjects'] });
    },
  });
}
