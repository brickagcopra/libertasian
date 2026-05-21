'use client';

import Link from 'next/link';
import { notFound, useParams, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { EmptyState } from '@/components/empty-states/empty-state';
import { useBarExamAnswer } from '@/features/bar-exams/hooks/use-bar-exam-answer';
import type { BarExamAnswer } from '@/features/bar-exams/types';
import { useCanAccessPaidFeature } from '@/hooks/useCanAccessPaidFeature';
import { ApiClientError, apiClient } from '@/lib/api-client';
import { subjectLabelWithPart, type SittingDetail } from '../../subjects';

function isAnswersPublicEnabled(): boolean {
  return process.env['NEXT_PUBLIC_FEATURE_BAR_EXAM_ANSWERS_PUBLIC'] === 'true';
}

export default function BarExamSittingPage() {
  const featureEnabled = isAnswersPublicEnabled();
  const access = useCanAccessPaidFeature();
  const subLoading = access.reason === 'loading';
  const canAccessAnswers = access.canAccess;
  const params = useParams<{ year: string; subjectCode: string }>();
  const searchParams = useSearchParams();
  const yearParam = params?.year ?? '';
  const subjectCode = params?.subjectCode ?? '';
  const part = searchParams?.get('part') ?? null;
  const year = Number(yearParam);

  if (!Number.isInteger(year) || year < 2006 || year > 2030) {
    notFound();
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['bar-exams', 'sitting', year, subjectCode, part],
    queryFn: async () => {
      const qs: Record<string, string> = {};
      if (part) qs['part'] = part;
      const res = await apiClient.get<{
        success: boolean;
        data: SittingDetail;
      }>(`/bar-exams/${year}/${encodeURIComponent(subjectCode)}`, {
        params: Object.keys(qs).length ? qs : undefined,
      });
      return res.data;
    },
    staleTime: 5 * 60_000,
    retry: (_, err) => {
      if (err instanceof ApiClientError && err.statusCode === 404) return false;
      return true;
    },
  });

  // Per-question lazy fetch tracking. A questionId is added the first time the
  // user opens its accordion and is NEVER removed — closing then re-opening
  // serves from React Query cache without re-firing the network call (and
  // crucially without re-consuming the aiAnswers quota).
  const [openedQuestions, setOpenedQuestions] = useState<Set<string>>(
    () => new Set(),
  );

  const handleAccordionChange = (questionId: string) => (value: string) => {
    if (value === 'answer' && !openedQuestions.has(questionId)) {
      setOpenedQuestions((prev) => {
        const next = new Set(prev);
        next.add(questionId);
        return next;
      });
    }
  };

  if (isError && error instanceof ApiClientError && error.statusCode === 404) {
    notFound();
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="h-6 w-48 animate-pulse rounded bg-gray-100" />
        <div className="h-12 w-3/4 animate-pulse rounded bg-gray-100" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-gray-200 bg-gray-50"
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          illustration="scales"
          title="Unable to load this sitting"
          message="Something went wrong fetching the questions. Refresh to try again."
        />
      </div>
    );
  }

  const { sitting, questions } = data;
  const label = subjectLabelWithPart(sitting.subjectStudyCode, sitting.part);

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/bar-exams" className="hover:text-gray-900">
          Bar Examinations
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/bar-exams/${year}`} className="hover:text-gray-900">
          {year}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">{label}</span>
      </nav>

      <header className="mb-10 border-b border-gray-200 pb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          {year} Bar Examinations
        </p>
        <h1 className="mt-1 text-3xl font-bold text-gray-900 sm:text-4xl">
          {label}
        </h1>
        <div className="mt-3 space-y-1 text-sm text-gray-600">
          {sitting.chairperson && (
            <p>
              <span className="font-medium">Chairperson:</span>{' '}
              {sitting.chairperson}
            </p>
          )}
          <p>
            <span className="font-medium">{sitting.questionCount}</span>{' '}
            {sitting.questionCount === 1 ? 'question' : 'questions'}
          </p>
          {sitting.sourceUrl && (
            <p>
              <a
                href={sitting.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-900"
              >
                View original on LawPhil →
              </a>
            </p>
          )}
        </div>
      </header>

      <ol className="space-y-8">
        {questions.map((q) => (
          <li
            key={q.id}
            id={`q-${q.number}`}
            className="rounded-xl border border-gray-200 bg-white p-6"
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Question {q.number}
              </h2>
              {q.subPartsCount > 0 && (
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {q.subPartsCount} sub-part{q.subPartsCount === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
              {q.text}
            </div>

            {featureEnabled && (
              subLoading ? (
                <div
                  className="mt-4 border-t border-gray-100 pt-2"
                  data-testid="answer-access-loading"
                >
                  <div className="h-9 w-48 animate-pulse rounded bg-gray-100" />
                </div>
              ) : canAccessAnswers ? (
                <div className="mt-4 border-t border-gray-100 pt-2">
                  <Accordion
                    type="single"
                    collapsible
                    onValueChange={handleAccordionChange(q.id)}
                  >
                    <AccordionItem value="answer" className="border-b-0">
                      <AccordionTrigger
                        className="py-2 text-sm font-medium text-gray-700"
                        data-testid={`answer-trigger-${q.number}`}
                      >
                        AI Answer (preview)
                      </AccordionTrigger>
                      <AccordionContent>
                        <BarExamAnswerSection
                          questionId={q.id}
                          enabled={openedQuestions.has(q.id)}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              ) : (
                <div
                  className="mt-4 border-t border-gray-100 pt-2"
                  data-testid={`answer-locked-${q.number}`}
                >
                  <div className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        AI Answer
                      </p>
                      <p className="text-xs text-gray-500">
                        Subscribe to a plan to view AI-generated answers.
                      </p>
                    </div>
                    <Link
                      href="/pricing"
                      className="text-sm font-medium text-indigo-600 hover:underline whitespace-nowrap"
                    >
                      See plans →
                    </Link>
                  </div>
                </div>
              )
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

interface AnswerErrorBody {
  code?: string;
  message?: string;
  resetsAt?: string;
}

function extractErrorCode(err: unknown): {
  code: string | null;
  status: number | null;
  resetsAt: string | null;
} {
  if (err instanceof ApiClientError) {
    const body = (err.body as AnswerErrorBody | undefined) ?? undefined;
    return {
      code: body?.code ?? null,
      status: err.statusCode,
      resetsAt: body?.resetsAt ?? null,
    };
  }
  return { code: null, status: null, resetsAt: null };
}

function BarExamAnswerSection({
  questionId,
  enabled,
}: {
  questionId: string;
  enabled: boolean;
}) {
  const { data, isLoading, isError, error } = useBarExamAnswer(questionId, {
    enabled,
  });

  if (!enabled) return null;

  if (isLoading) {
    return (
      <div className="space-y-2 py-2" data-testid="answer-loading">
        <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100" />
        <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-gray-100" />
      </div>
    );
  }

  if (isError) {
    const { code, status, resetsAt } = extractErrorCode(error);

    if (status === 404 || code === 'answer_not_available') {
      return (
        <p className="py-2 text-sm text-gray-500" data-testid="answer-empty">
          No answer published yet for this question.
        </p>
      );
    }

    if (status === 402 || code === 'subscription_required') {
      return (
        <div className="py-2 text-sm text-gray-700" data-testid="answer-paywall">
          <p className="font-medium">Upgrade to unlock AI answers.</p>
          <Link href="/pricing" className="text-indigo-600 hover:underline">
            See plans →
          </Link>
        </div>
      );
    }

    if (status === 429 || code === 'quota_exceeded') {
      return (
        <div className="py-2 text-sm text-gray-700" data-testid="answer-quota-exceeded">
          <p>
            Daily limit reached.{' '}
            {resetsAt ? `Resets at ${formatResetsAt(resetsAt)}.` : 'Try again later.'}
          </p>
          <Link href="/pricing" className="text-indigo-600 hover:underline">
            Upgrade for more →
          </Link>
        </div>
      );
    }

    return (
      <p className="py-2 text-sm text-red-600" data-testid="answer-error">
        Failed to load the answer. Please try again.
      </p>
    );
  }

  if (!data) return null;

  return <BarExamAnswerBody answer={data} />;
}

function BarExamAnswerBody({ answer }: { answer: BarExamAnswer }) {
  const structured = answer.structuredAnswerJson;
  return (
    <article className="space-y-3 py-2 text-sm text-gray-800" data-testid="answer-body">
      {structured ? (
        <>
          <AlacSection label="Answer" body={structured.answer} />
          <AlacSection label="Law" body={structured.law} />
          <AlacSection label="Analysis" body={structured.analysis} />
          <AlacSection label="Conclusion" body={structured.conclusion} />
        </>
      ) : (
        <p className="whitespace-pre-wrap">{answer.answerText}</p>
      )}
      {answer.modelRun && (
        <p className="pt-2 text-xs text-gray-400">
          Generated by {answer.modelRun.modelName}
          {answer.modelRun.promptTemplateVersion
            ? ` · ${answer.modelRun.promptTemplateVersion}`
            : ''}
        </p>
      )}
    </article>
  );
}

function AlacSection({ label, body }: { label: string; body: string }) {
  if (!body) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {label}
      </h4>
      <p className="mt-1 whitespace-pre-wrap leading-relaxed">{body}</p>
    </div>
  );
}

function formatResetsAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
