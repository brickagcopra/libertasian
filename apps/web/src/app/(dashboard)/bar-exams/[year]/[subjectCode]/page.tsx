'use client';

import Link from 'next/link';
import { notFound, useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { EmptyState } from '@/components/empty-states/empty-state';
import { ApiClientError, apiClient } from '@/lib/api-client';
import { subjectLabelWithPart, type SittingDetail } from '../../subjects';

export default function BarExamSittingPage() {
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
                  {q.subPartsCount} sub-parts
                </span>
              )}
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
              {q.text}
            </div>
            {sitting.sourceUrl && (
              <p className="mt-4 text-xs text-gray-400">
                <a
                  href={`${sitting.sourceUrl}${
                    q.sourceSectionAnchor ? `#${q.sourceSectionAnchor}` : ''
                  }`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-gray-700"
                >
                  View on LawPhil →
                </a>
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
