import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  BarExamAnswer,
  BarExamSittingDetail,
  BarExamYearGroup,
} from '../types';

/**
 * Past Philippine Bar Exam read API (mobile mirror of the web feature).
 *
 * Endpoints are JWT-auth; apiClient injects the Bearer token and the
 * `X-Client: mobile` header automatically. The transport already strips the
 * `{ success, data }` envelope, so each generic on `apiClient.get<T>(...)`
 * is the *inner* payload shape.
 */

export function useBarExamYears() {
  return useQuery({
    queryKey: ['bar-exam-years'],
    queryFn: () => apiClient.get<BarExamYearGroup[]>('/bar-exams'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useBarExamYear(year: number) {
  return useQuery({
    queryKey: ['bar-exam-year', year],
    queryFn: () => apiClient.get<BarExamYearGroup>(`/bar-exams/${year}`),
    enabled: !!year,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBarExamSitting(
  year: number,
  subjectCode: string,
  part?: string,
) {
  return useQuery({
    queryKey: ['bar-exam-sitting', year, subjectCode, part ?? null],
    queryFn: () =>
      apiClient.get<BarExamSittingDetail>(
        `/bar-exams/${year}/${encodeURIComponent(subjectCode)}`,
        { params: part ? { part } : undefined },
      ),
    enabled: !!year && !!subjectCode,
    staleTime: 5 * 60 * 1000,
  });
}

interface UseBarExamAnswerOptions {
  enabled: boolean;
}

/**
 * Fetch the approved AI ALAC answer for a single bar exam question.
 *
 * Consumes 1 `aiAnswers` quota unit per *request*, so callers MUST gate
 * `enabled` on explicit user intent (e.g. accordion open). retry=false
 * because 402 / 404 / 429 are deterministic UI states, not transient errors.
 */
export function useBarExamAnswer(
  questionId: string,
  opts: UseBarExamAnswerOptions,
) {
  return useQuery({
    queryKey: ['bar-exam-answer', questionId],
    queryFn: () =>
      apiClient.get<BarExamAnswer>(
        `/bar-exams/questions/${encodeURIComponent(questionId)}/answer`,
      ),
    enabled: opts.enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
