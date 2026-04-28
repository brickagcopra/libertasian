import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { StaggerGrid } from '@/components/ui/stagger-grid';
import {
  fetchYear,
  subjectLabelWithPart,
  type SubjectSummary,
} from '../lib';

interface PageProps {
  params: Promise<{ year: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { year } = await params;
  return {
    title: `${year} Bar Examinations — LIBERTASIAN`,
    description: `Subjects sat in the ${year} Philippine Bar examinations.`,
  };
}

export default async function BarExamsYearPage({ params }: PageProps) {
  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year) || year < 2006 || year > 2030) {
    notFound();
  }

  const detail = await fetchYear(year);
  if (!detail || detail.subjects.length === 0) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
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
        <p className="mt-2 text-base text-gray-600">
          {detail.subjects.length}{' '}
          {detail.subjects.length === 1 ? 'subject paper' : 'subject papers'}{' '}
          on file.
        </p>
      </div>

      <StaggerGrid className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {detail.subjects.map((s) => (
          <SubjectCard key={s.sittingId} year={year} subject={s} />
        ))}
      </StaggerGrid>
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
