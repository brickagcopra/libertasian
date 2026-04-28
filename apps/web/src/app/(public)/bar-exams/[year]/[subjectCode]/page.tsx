import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { fetchSitting, subjectLabelWithPart } from '../../lib';

interface PageProps {
  params: Promise<{ year: string; subjectCode: string }>;
  searchParams: Promise<{ part?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const [{ year: yearParam, subjectCode }, { part }] = await Promise.all([
    params,
    searchParams,
  ]);
  const label = subjectLabelWithPart(subjectCode, part ?? null);
  return {
    title: `${yearParam} Bar — ${label} — LIBERTASIAN`,
    description: `Verbatim ${yearParam} ${label} bar examination questions.`,
  };
}

export default async function BarExamSittingPage({
  params,
  searchParams,
}: PageProps) {
  const [{ year: yearParam, subjectCode }, { part }] = await Promise.all([
    params,
    searchParams,
  ]);
  const year = Number(yearParam);
  if (!Number.isInteger(year) || year < 2006 || year > 2030) {
    notFound();
  }

  const detail = await fetchSitting(year, subjectCode, part ?? null);
  if (!detail) {
    notFound();
  }

  const { sitting, questions } = detail;
  const label = subjectLabelWithPart(sitting.subjectStudyCode, sitting.part);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
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
