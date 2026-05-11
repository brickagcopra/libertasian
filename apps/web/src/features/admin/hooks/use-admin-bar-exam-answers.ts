'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface BarExamAnswerRow {
  id: string;
  barExamQuestionId: string;
  answerType: string;
  reviewStatus: ReviewStatus;
  visibility: string;
  confidence: number | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  question: {
    id: string;
    questionNumber: number;
    excerpt: string;
    sittingYear: number;
    subjectStudyCode: string | null;
  };
  modelRun: {
    id: string;
    modelName: string;
    promptTemplateVersion: string | null;
  } | null;
}

export interface BarExamAnswerDetail extends BarExamAnswerRow {
  answerText: string;
  structuredAnswerJson: {
    answer: string;
    law: string;
    analysis: string;
    conclusion: string;
  } | null;
  question: BarExamAnswerRow['question'] & { questionText: string };
}

export interface DispatchAnswerGenerationInput {
  questionIds?: string[];
  sittingId?: string;
  year?: number;
  subjectCode?: string;
}

export interface DispatchResult {
  taskId: string;
  taskName: string;
  questionCount: number;
  truncated: boolean;
}

// ---- Queries ----

export function useBarExamAnswers(params?: {
  reviewStatus?: ReviewStatus;
  cursor?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['admin', 'bar-exam-answers', params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.reviewStatus) queryParams['reviewStatus'] = params.reviewStatus;
      if (params?.cursor) queryParams['cursor'] = params.cursor;
      if (params?.limit) queryParams['limit'] = String(params.limit);

      const res = await apiClient.get<{
        success: boolean;
        data: {
          items: BarExamAnswerRow[];
          meta: { hasNext: boolean; nextCursor: string | null; limit: number };
        };
      }>('/admin/bar-exams/answers', { params: queryParams });
      return res.data;
    },
  });
}

export function useBarExamAnswerDetail(id: string | null) {
  return useQuery({
    queryKey: ['admin', 'bar-exam-answers', 'detail', id],
    enabled: !!id,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: BarExamAnswerDetail;
      }>(`/admin/bar-exams/answers/${id}`);
      return res.data;
    },
  });
}

// ---- Mutations ----

export function useApproveBarExamAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{
        success: boolean;
        data: BarExamAnswerDetail;
      }>(`/admin/bar-exams/answers/${id}/approve`);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'bar-exam-answers'] });
    },
  });
}

export function useRejectBarExamAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const res = await apiClient.post<{
        success: boolean;
        data: BarExamAnswerDetail;
      }>(`/admin/bar-exams/answers/${id}/reject`, reason ? { reason } : undefined);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'bar-exam-answers'] });
    },
  });
}

export function useDispatchAnswerGeneration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DispatchAnswerGenerationInput) => {
      const res = await apiClient.post<{
        success: boolean;
        data: DispatchResult;
      }>('/admin/bar-exams/answers/dispatch-generation', input);
      return res.data;
    },
    onSuccess: () => {
      // Pending rows land asynchronously — invalidate the queue so the
      // refresh picks them up once the worker writes them.
      qc.invalidateQueries({ queryKey: ['admin', 'bar-exam-answers'] });
    },
  });
}
