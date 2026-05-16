'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { EmptyState } from '@/components/empty-states/empty-state';
import { StaggerGrid } from '@/components/ui/stagger-grid';
import { apiClient } from '@/lib/api-client';
import type { YearGroup } from './subjects';

export default function BarExamsHubPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bar-exams', 'all-years'],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: YearGroup[] }>(
        '/bar-exams',
      );
      return res.data ?? [];
    },
    staleTime: 5 * 60_000,
  });

  const groups = data ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
          Past Bar Examinations
        </h1>
        <p className="mt-3 text-base text-gray-600">
          Verbatim Philippine Bar examination question papers, sourced from{' '}
          <a
            href="https://lawphil.net/courts/bm/barQ/barQs.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-900"
          >
            LawPhil
          </a>
          . Read-only — answer keys and practice mode are not yet available.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl border border-gray-200 bg-gray-50"
            />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          illustration="scales"
          title="Unable to load bar exam papers"
          message="Something went wrong fetching the archive. Refresh to try again."
        />
      ) : groups.length === 0 ? (
        <EmptyState
          illustration="archive"
          title="No bar exam papers are loaded yet"
          message="Check back soon — we're ingesting the LawPhil archive in batches."
        />
      ) : (
        <StaggerGrid className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <YearCard key={g.year} group={g} />
          ))}
        </StaggerGrid>
      )}
    </div>
  );
}

function YearCard({ group }: { group: YearGroup }) {
  const subjectCount = group.subjects.length;
  const totalQuestions = group.subjects.reduce(
    (sum, s) => sum + s.questionCount,
    0,
  );
  return (
    <Link
      href={`/bar-exams/${group.year}`}
      className="block rounded-xl border border-gray-200 bg-white p-5 transition hover:border-gray-400 hover:shadow-md"
    >
      <p className="text-sm font-semibold uppercase tracking-wide text-gray-500">
        Bar Examinations
      </p>
      <p className="mt-1 text-3xl font-bold text-gray-900">{group.year}</p>
      <p className="mt-3 text-sm text-gray-600">
        <span className="font-semibold text-gray-900">{subjectCount}</span>{' '}
        {subjectCount === 1 ? 'subject' : 'subjects'} ·{' '}
        <span className="font-semibold text-gray-900">{totalQuestions}</span>{' '}
        questions
      </p>
    </Link>
  );
}
