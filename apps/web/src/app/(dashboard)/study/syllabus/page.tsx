'use client';

import Link from 'next/link';

import { useSyllabi } from '@/features/study/hooks/use-syllabus';
import { useBarExamReadiness } from '@/features/study/hooks/use-syllabus';
import { ROUTES } from '@/lib/constants';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

const SUBJECT_COLORS: Record<string, string> = {
  political_law: 'from-blue-50 to-white border-blue-200',
  labor_law: 'from-amber-50 to-white border-amber-200',
  civil_law: 'from-green-50 to-white border-green-200',
  taxation_law: 'from-red-50 to-white border-red-200',
  commercial_law: 'from-purple-50 to-white border-purple-200',
  criminal_law: 'from-slate-50 to-white border-slate-200',
  remedial_law: 'from-teal-50 to-white border-teal-200',
  legal_ethics: 'from-orange-50 to-white border-orange-200',
  public_international_law: 'from-cyan-50 to-white border-cyan-200',
};

export default function SyllabusPage() {
  const { data: syllabiData, isLoading: syllabiLoading } = useSyllabi();
  const { data: readiness, isLoading: readinessLoading } = useBarExamReadiness();

  const syllabi = syllabiData?.data ?? [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Bar Exam Syllabus</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Study path organized by the 9 bar exam subjects with topic-level progress tracking
        </p>
      </div>

      {/* Overall Readiness Score */}
      <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-white">
        <CardContent className="p-6">
          {readinessLoading ? (
            <div className="flex items-center gap-6">
              <Skeleton className="h-20 w-20 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="relative flex h-20 w-20 items-center justify-center">
                <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    fill="none"
                    stroke="#e0e7ff"
                    strokeWidth="8"
                  />
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    fill="none"
                    stroke="#4f46e5"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${(readiness?.overallPct ?? 0) * 2.136} 213.6`}
                  />
                </svg>
                <span className="absolute text-lg font-bold text-indigo-700">
                  {readiness?.overallPct ?? 0}%
                </span>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-indigo-900">Bar Exam Readiness</h2>
                <p className="mt-1 text-sm text-indigo-700/70">
                  {readiness?.completedTopics ?? 0} of {readiness?.totalTopics ?? 0} topics completed
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Subject Grid */}
      {syllabiLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {syllabi.map((syllabus) => {
            const subjectReadiness = readiness?.subjects.find(
              (s) => s.barSubjectCode === syllabus.barSubjectCode,
            );
            const pct = subjectReadiness?.pct ?? 0;
            const colorClass = SUBJECT_COLORS[syllabus.barSubjectCode] ?? 'from-gray-50 to-white border-gray-200';

            return (
              <Link key={syllabus.id} href={ROUTES.STUDY_SYLLABUS_SUBJECT(syllabus.barSubjectCode)}>
                <Card className={`bg-gradient-to-br ${colorClass} transition hover:shadow-md`}>
                  <CardContent className="p-5">
                    <h3 className="text-sm font-semibold">{syllabus.title}</h3>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                      {syllabus.description}
                    </p>
                    <div className="mt-3 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          {syllabus.topicCount} topic{syllabus.topicCount !== 1 ? 's' : ''}
                        </span>
                        <span className="font-medium">{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
