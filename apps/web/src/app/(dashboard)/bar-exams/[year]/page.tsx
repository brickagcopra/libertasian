'use client';

import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';

import { EmptyState } from '@/components/empty-states/empty-state';
import { StaggerGrid } from '@/components/ui/stagger-grid';
import { apiClient } from '@/lib/api-client';
import { ApiClientError } from '@/lib/api-client';
import {
  subjectLabelWithPart,
  type SubjectSummary,
} from '../subjects';

interface YearDetail {
  year: number;
  subjects: SubjectSummary[];
}

export default function BarExamsYearPage() {
  const params = useParams<{ year: string }>();
  const yearParam = params?.year ?? '';
  const year = Number(yearParam);

  if (!Number.isInteger(year) || year < 2006 || year > 2030) {
    notFound();
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['bar-exams', 'year', year],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: YearDetail }>(
        `/bar-exams/${year}`,
      );
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

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/bar-exams" className="hover:text-gray-900">
          Bar Examinations
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">{year}</span>
      </nav>

      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          {year} Bar Examinations
        </h1>
        {data && (
          <p className="mt-2 text-base text-gray-600">
            {data.subjects.length}{' '}
            {data.subjects.length === 1 ? 'subject paper' : 'subject papers'}{' '}
            on file.
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-gray-200 bg-gray-50"
            />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          illustration="scales"
          title="Unable to load this year"
          message="Something went wrong fetching the subjects. Refresh to try again."
        />
      ) : data ? (
        <StaggerGrid className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.subjects.map((s) => (
            <SubjectCard key={s.sittingId} year={year} subject={s} />
          ))}
        </StaggerGrid>
      ) : null}
    </div>
  );
}

function SubjectCard({
  year,
  subject,
}: {
  year: number;
  subject: SubjectSummary;
}) {
  if (!subject.code) return null;
  const partQuery = subject.part ? `?part=${subject.part}` : '';
  const href = `/bar-exams/${year}/${subject.code}${partQuery}`;
  return (
    <Link
      href={href}
      className="block rounded-xl border border-gray-200 bg-white p-5 transition hover:border-gray-400 hover:shadow-md"
    >
      <h2 className="text-base font-semibold text-gray-900">
        {subjectLabelWithPart(subject.code, subject.part)}
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        <span className="font-semibold text-gray-900">
          {subject.questionCount}
        </span>{' '}
        {subject.questionCount === 1 ? 'question' : 'questions'}
      </p>
      {subject.chairperson && (
        <p className="mt-1 text-xs text-gray-500">
          Chairperson: {subject.chairperson}
        </p>
      )}
    </Link>
  );
}
