import Link from 'next/link';
import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-states/empty-state';
import { StaggerGrid } from '@/components/ui/stagger-grid';
import { fetchAllYears, type YearGroup } from './lib';

export const metadata: Metadata = {
  title: 'Past Bar Examinations — LIBERTASIAN',
  description:
    'Browse past Philippine Bar examination question papers (2006-2022) ' +
    'sourced from LawPhil. Free, ad-free, fully searchable.',
};

export default async function BarExamsHubPage() {
  const groups = (await fetchAllYears()) ?? [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
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

      {groups.length === 0 ? (
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
