'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { useBarSubjects } from '@/features/study/hooks/use-bar-subjects';
import { useFlashcardSets } from '@/features/study/hooks/use-flashcard-sets';
import { useReviewerPacks } from '@/features/study/hooks/use-reviewer-packs';
import { useStudyStats } from '@/features/study/hooks/use-study-sessions';
import { useBarExamReadiness } from '@/features/study/hooks/use-syllabus';
import { ROUTES } from '@/lib/constants';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';

const VISIBILITY_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  private: { variant: 'secondary' },
  org: { variant: 'outline', className: 'border-purple-200 bg-purple-50 text-purple-700' },
  public_editorial: { variant: 'outline', className: 'border-blue-200 bg-blue-50 text-blue-700' },
};

function VisibilityBadge({ visibility }: { visibility: string }) {
  const style = VISIBILITY_BADGE[visibility] ?? { variant: 'secondary' as const };
  return (
    <Badge variant={style.variant} className={style.className}>
      {visibility.replace(/_/g, ' ')}
    </Badge>
  );
}

function formatDuration(totalSecs: number): string {
  if (totalSecs < 60) return `${totalSecs}s`;
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

const BAR_SUBJECT_LABELS: Record<string, string> = {
  civil: 'Civil Law',
  commercial: 'Mercantile Law',
  criminal: 'Criminal Law',
  labor: 'Labor Law',
  political: 'Political Law',
  intl: "Public Int'l Law",
  remedial: 'Remedial Law',
  tax: 'Taxation',
  ethics: 'Legal Ethics',
};

export default function StudyPage() {
  const { data: subjectsData, isLoading: subjectsLoading } = useBarSubjects();
  const { data: flashcardData, isLoading: flashcardsLoading } = useFlashcardSets({ cursor: undefined });
  const { data: packsData, isLoading: packsLoading } = useReviewerPacks({ cursor: undefined });
  const { data: statsData, isLoading: statsLoading } = useStudyStats();
  const { data: readiness, isLoading: readinessLoading } = useBarExamReadiness();

  const subjects = subjectsData?.data ?? [];
  const flashcardSets = flashcardData?.data ?? [];
  const reviewerPacks = packsData?.data ?? [];
  const stats = statsData?.data;

  // Compute max time for subject breakdown bar chart scaling
  const maxSubjectTime = useMemo(() => {
    if (!stats?.subjectBreakdown?.length) return 0;
    return Math.max(...stats.subjectBreakdown.map((s) => s.totalTimeSecs));
  }, [stats?.subjectBreakdown]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Study Mode</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Codal reader, flashcards, reviewer packs, and study tools for bar exam preparation
        </p>
      </div>

      {/* Study Stats Row */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* Streak Widget */}
        <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-white">
          <CardContent className="p-5">
            <p className="text-sm font-medium text-orange-700">Study Streak</p>
            {statsLoading ? (
              <Skeleton className="mt-1 h-8 w-12" />
            ) : (
              <>
                <p className="mt-1 text-3xl font-bold text-orange-600">
                  {stats?.streak.current ?? 0}
                </p>
                <p className="mt-1 text-xs text-orange-600/70">
                  day{(stats?.streak.current ?? 0) !== 1 ? 's' : ''}
                  {stats?.streak.longest ? ` · Best: ${stats.streak.longest}` : ''}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Total Study Time */}
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Total Study Time</p>
            {statsLoading ? (
              <Skeleton className="mt-1 h-8 w-16" />
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold">
                  {formatDuration(stats?.totalStudyTimeSecs ?? 0)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {stats?.totalSessions ?? 0} session{(stats?.totalSessions ?? 0) !== 1 ? 's' : ''} total
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Study Days */}
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Study Days</p>
            {statsLoading ? (
              <Skeleton className="mt-1 h-8 w-10" />
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold">
                  {stats?.streak.totalStudyDays ?? 0}
                </p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {stats?.streak.lastStudyDate
                    ? `Last: ${new Date(stats.streak.lastStudyDate).toLocaleDateString()}`
                    : 'No sessions yet'}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Quick Content Stats */}
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Content</p>
            {subjectsLoading || flashcardsLoading || packsLoading ? (
              <Skeleton className="mt-1 h-8 w-12" />
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold">{flashcardSets.length + reviewerPacks.length}</p>
                <p className="mt-1 text-xs text-muted-foreground/70">
                  {flashcardSets.length} sets · {reviewerPacks.length} packs
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Subject Time Breakdown */}
      {stats?.subjectBreakdown && stats.subjectBreakdown.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Study Time by Subject</h2>
          <Card>
            <CardContent className="p-5">
              <div className="space-y-3">
                {stats.subjectBreakdown
                  .sort((a, b) => b.totalTimeSecs - a.totalTimeSecs)
                  .map((item) => {
                    const pct = maxSubjectTime > 0 ? (item.totalTimeSecs / maxSubjectTime) * 100 : 0;
                    const label = item.barSubject
                      ? BAR_SUBJECT_LABELS[item.barSubject] ?? item.barSubject
                      : 'Uncategorized';
                    return (
                      <div key={item.barSubject ?? 'none'} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{label}</span>
                          <span className="text-muted-foreground">
                            {formatDuration(item.totalTimeSecs)} · {item.sessionCount} session{item.sessionCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <Progress value={pct} className="h-2" />
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      <Separator />

      {/* Syllabus Mode Section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Syllabus Mode</h2>
          <Link
            href={ROUTES.STUDY_SYLLABUS}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View full syllabus &rarr;
          </Link>
        </div>
        <Link href={ROUTES.STUDY_SYLLABUS}>
          <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-white transition hover:shadow-sm">
            <CardContent className="flex items-center gap-5 p-5">
              {readinessLoading ? (
                <Skeleton className="h-14 w-14 rounded-full" />
              ) : (
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
                  <svg className="h-14 w-14 -rotate-90" viewBox="0 0 56 56">
                    <circle cx="28" cy="28" r="24" fill="none" stroke="#e0e7ff" strokeWidth="5" />
                    <circle
                      cx="28"
                      cy="28"
                      r="24"
                      fill="none"
                      stroke="#4f46e5"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray={`${(readiness?.overallPct ?? 0) * 1.508} 150.8`}
                    />
                  </svg>
                  <span className="absolute text-sm font-bold text-indigo-700">
                    {readiness?.overallPct ?? 0}%
                  </span>
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-indigo-900">Bar Exam Readiness</p>
                <p className="mt-0.5 text-xs text-indigo-700/70">
                  {readiness
                    ? // study_8 taxonomy
                      `${readiness.completedTopics} of ${readiness.totalTopics} topics across 8 subjects`
                    : 'Track your progress across all bar exam subjects'}
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </section>

      {/* Codal Reader Section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Codal Reader</h2>
          <Link
            href={ROUTES.STUDY_CODALS}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View all subjects &rarr;
          </Link>
        </div>
        {subjectsLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {subjects.slice(0, 6).map((subject) => (
              <Link key={subject.code} href={ROUTES.STUDY_CODAL(subject.code)}>
                <Card className="transition hover:shadow-sm">
                  <CardContent className="p-4">
                    <p className="text-sm font-medium">{subject.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {subject.documentCount} document{subject.documentCount !== 1 ? 's' : ''}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Flashcard Sets Section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Flashcard Sets</h2>
          <Link
            href={ROUTES.STUDY_FLASHCARDS}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View all &rarr;
          </Link>
        </div>
        {flashcardsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : flashcardSets.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center">
              <p className="text-sm text-muted-foreground">No flashcard sets yet.</p>
              <Link
                href={ROUTES.STUDY_FLASHCARDS}
                className="mt-2 inline-block text-sm font-medium hover:underline"
              >
                Create your first set &rarr;
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {flashcardSets.slice(0, 5).map((set) => (
              <Link key={set.id} href={ROUTES.STUDY_FLASHCARD(set.id)}>
                <Card className="transition hover:shadow-sm">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{set.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {set.cardCount} card{set.cardCount !== 1 ? 's' : ''}
                        {set.barSubject && ` · ${set.barSubject}`}
                      </p>
                    </div>
                    <VisibilityBadge visibility={set.visibility} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Reviewer Packs Section */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Reviewer Packs</h2>
          <Link
            href={ROUTES.STUDY_REVIEWER_PACKS}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            View all &rarr;
          </Link>
        </div>
        {packsLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : reviewerPacks.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-6 text-center">
              <p className="text-sm text-muted-foreground">No reviewer packs yet.</p>
              <Link
                href={ROUTES.STUDY_REVIEWER_PACKS}
                className="mt-2 inline-block text-sm font-medium hover:underline"
              >
                Create your first pack &rarr;
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {reviewerPacks.slice(0, 5).map((pack) => (
              <Link key={pack.id} href={ROUTES.STUDY_REVIEWER_PACK(pack.id)}>
                <Card className="transition hover:shadow-sm">
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{pack.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {pack.itemCount} item{pack.itemCount !== 1 ? 's' : ''}
                        {pack.barSubject && ` · ${pack.barSubject}`}
                        {pack.creator && ` · by ${pack.creator.fullName}`}
                      </p>
                    </div>
                    <VisibilityBadge visibility={pack.visibility} />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
