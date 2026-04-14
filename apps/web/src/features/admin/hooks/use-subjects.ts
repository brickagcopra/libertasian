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

/** Standard API response envelope from NestJS controllers */
type ApiEnvelope<T> = { success: boolean; data: T };

// ---- Queries ----

export function useSubjects(taxonomy?: string) {
  return useQuery({
    queryKey: ['admin', 'subjects', taxonomy],
    queryFn: async () => {
      const qp: Record<string, string> = {};
      if (taxonomy) qp['taxonomy'] = taxonomy;
      const res = await apiClient.get<ApiEnvelope<SubjectItem[]>>('/subjects', { params: qp });
      return res.data;
    },
  });
}

export function useSubjectTopics(subjectId: string) {
  return useQuery({
    queryKey: ['admin', 'subjects', subjectId, 'topics'],
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<SubjectTopic[]>>(`/subjects/${subjectId}/topics`);
      return res.data;
    },
    enabled: !!subjectId,
  });
}

export function useClassificationCoverage() {
  return useQuery({
    queryKey: ['admin', 'subjects', 'coverage'],
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<ClassificationCoverage>>('/subjects/coverage');
      return res.data;
    },
  });
}

export function useSubjectEquivalences(studySubjectId: string) {
  return useQuery({
    queryKey: ['admin', 'subjects', 'equivalences', studySubjectId],
    queryFn: async () => {
      const res = await apiClient.get<ApiEnvelope<SubjectEquivalence[]>>(
        `/subjects/equivalences/${studySubjectId}`,
      );
      return res.data;
    },
    enabled: !!studySubjectId,
  });
}

// ---- Mutations ----

export function useClassifyUnclassified() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiEnvelope<{ message: string }>>(
        '/subjects/batch-classify',
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'subjects'] });
    },
  });
}
