'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type ReviewStatusFilter = ReviewStatus | 'all';

/** Floor for any confidence-driven bulk action. Mirrors the API constant. */
export const MIN_BULK_CONFIDENCE = 0.7;

/** Job statuses that still produce progress, i.e. worth polling for. */
export const ACTIVE_JOB_STATUSES = ['queued', 'running'] as const;

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

export interface YearSubjectCount {
  year: number;
  subjectCode: string | null;
  count: number;
}

export interface DispatchAnswerGenerationInput {
  questionIds?: string[];
  sittingId?: string;
  year?: number;
  subjectCode?: string;
  onlyMissing?: boolean;
  allMissing?: boolean;
  dryRun?: boolean;
}

export interface DispatchDryRunResult {
  dryRun: true;
  total: number;
  byYearSubject: YearSubjectCount[];
}

export interface DispatchJobResult {
  dryRun: false;
  jobId: string;
  total: number;
}

export type DispatchResult = DispatchDryRunResult | DispatchJobResult;

export interface GenerationJobCounts {
  queued: number;
  running: number;
  generated: number;
  generatedUngrounded: number;
  skippedExisting: number;
  failed: number;
}

export interface GenerationJobSummary {
  id: string;
  status: string;
  total: number;
  onlyMissing: boolean;
  filters: unknown;
  triggeredByUserId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastItemUpdatedAt: string | null;
  done: number;
  stalled: boolean;
  counts: GenerationJobCounts;
}

export interface GenerationJobFailedItem {
  id: string;
  questionId: string;
  questionNumber: number;
  sittingYear: number;
  subjectStudyCode: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  updatedAt: string;
}

export interface GenerationJobDetail extends GenerationJobSummary {
  failedItems: {
    items: GenerationJobFailedItem[];
    meta: { hasNext: boolean; nextCursor: string | null; limit: number };
  };
}

export interface CoverageCell {
  year: number;
  subjectCode: string | null;
  totalQuestions: number;
  answered: number;
  missing: number;
  pending: number;
  pendingAtOrAbove070: number;
  approved: number;
  rejected: number;
  unscored: number;
}

export type CoverageTotals = Omit<CoverageCell, 'year' | 'subjectCode'>;

export interface CoverageResult {
  cells: CoverageCell[];
  totals: CoverageTotals;
}

/** Approve accepts either an explicit id list or a confidence filter. */
export interface BulkApproveInput {
  ids?: string[];
  filter?: { year?: number; subjectCode?: string; minConfidence: number };
  dryRun?: boolean;
  reason?: string;
}

/**
 * Reject takes explicit ids only — the API has no filter mode for it, and
 * typing it this way keeps "reject everything above 0.70" unexpressible here
 * too rather than relying on a 400 to catch it.
 */
export interface BulkRejectInput {
  ids: string[];
  dryRun?: boolean;
}

export interface BulkReviewResult {
  dryRun: boolean;
  matched: number;
  updated: number;
  byYearSubject: YearSubjectCount[];
  bulkOperationId: string | null;
}

export function isJobActive(job: { status: string }): boolean {
  return (ACTIVE_JOB_STATUSES as readonly string[]).includes(job.status);
}

/** Poll cadence while a job is moving. */
export const JOBS_POLL_MS = 5000;

/**
 * `refetchInterval` for the job views: poll only while something is actually
 * queued or running. An admin page left open on a finished queue should not
 * hold a request every five seconds for the rest of the day.
 */
export function jobsPollInterval(
  jobs: Array<{ status: string }> | undefined,
): number | false {
  if (!jobs) return false;
  return jobs.some(isJobActive) ? JOBS_POLL_MS : false;
}

const ANSWERS_KEY = ['admin', 'bar-exam-answers'] as const;
const JOBS_KEY = ['admin', 'bar-exam-answer-jobs'] as const;
const COVERAGE_KEY = ['admin', 'bar-exam-answer-coverage'] as const;

// ---- Queries ----

export function useBarExamAnswers(params?: {
  reviewStatus?: ReviewStatusFilter;
  year?: number;
  subjectCode?: string;
  minConfidence?: number;
  cursor?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: [...ANSWERS_KEY, params],
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.reviewStatus) queryParams['reviewStatus'] = params.reviewStatus;
      if (params?.year !== undefined) queryParams['year'] = String(params.year);
      if (params?.subjectCode) queryParams['subjectCode'] = params.subjectCode;
      if (params?.minConfidence !== undefined) {
        queryParams['minConfidence'] = String(params.minConfidence);
      }
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
    queryKey: [...ANSWERS_KEY, 'detail', id],
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

export function useBarExamAnswerCoverage() {
  return useQuery({
    queryKey: COVERAGE_KEY,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: CoverageResult;
      }>('/admin/bar-exams/answers/coverage');
      return res.data;
    },
  });
}

/** Recent generation jobs, polled only while one is active. */
export function useBarExamAnswerGenerationJobs() {
  return useQuery({
    queryKey: JOBS_KEY,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: { items: GenerationJobSummary[] };
      }>('/admin/bar-exams/answers/generation-jobs');
      return res.data;
    },
    refetchInterval: (query) => {
      const data = query.state.data as
        | { items: GenerationJobSummary[] }
        | undefined;
      return jobsPollInterval(data?.items);
    },
  });
}

export function useBarExamAnswerGenerationJob(id: string | null) {
  return useQuery({
    queryKey: [...JOBS_KEY, 'detail', id],
    enabled: !!id,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        data: GenerationJobDetail;
      }>(`/admin/bar-exams/answers/generation-jobs/${id}`);
      return res.data;
    },
    refetchInterval: (query) => {
      const data = query.state.data as GenerationJobDetail | undefined;
      return jobsPollInterval(data ? [data] : undefined);
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
      qc.invalidateQueries({ queryKey: ANSWERS_KEY });
      qc.invalidateQueries({ queryKey: COVERAGE_KEY });
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
      qc.invalidateQueries({ queryKey: ANSWERS_KEY });
      qc.invalidateQueries({ queryKey: COVERAGE_KEY });
    },
  });
}

/**
 * Dispatch generation. A `dryRun` call resolves and counts only, so the
 * dialog can say how many questions it is about to generate before the admin
 * confirms — the previous dialog could only promise "up to 50".
 */
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
    onSuccess: (data) => {
      // A dry run created nothing — invalidating would only cause traffic.
      if (data.dryRun) return;
      qc.invalidateQueries({ queryKey: JOBS_KEY });
      qc.invalidateQueries({ queryKey: ANSWERS_KEY });
    },
  });
}

export function useCancelGenerationJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{
        success: boolean;
        data: GenerationJobSummary;
      }>(`/admin/bar-exams/answers/generation-jobs/${id}/cancel`);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

export function useRetryGenerationJobFailures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{
        success: boolean;
        data: { job: GenerationJobSummary; requeued: number };
      }>(`/admin/bar-exams/answers/generation-jobs/${id}/retry-failed`);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

export function useBulkApproveBarExamAnswers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkApproveInput) => {
      const res = await apiClient.post<{
        success: boolean;
        data: BulkReviewResult;
      }>('/admin/bar-exams/answers/bulk-approve', input);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.dryRun) return;
      qc.invalidateQueries({ queryKey: ANSWERS_KEY });
      qc.invalidateQueries({ queryKey: COVERAGE_KEY });
    },
  });
}

export function useBulkRejectBarExamAnswers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkRejectInput) => {
      const res = await apiClient.post<{
        success: boolean;
        data: BulkReviewResult;
      }>('/admin/bar-exams/answers/bulk-reject', input);
      return res.data;
    },
    onSuccess: (data) => {
      if (data.dryRun) return;
      qc.invalidateQueries({ queryKey: ANSWERS_KEY });
      qc.invalidateQueries({ queryKey: COVERAGE_KEY });
    },
  });
}

/** Invalidate coverage + the review queue — used when a job finishes. */
export function useInvalidateBarExamAnswerViews() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: COVERAGE_KEY });
    qc.invalidateQueries({ queryKey: ANSWERS_KEY });
  };
}
