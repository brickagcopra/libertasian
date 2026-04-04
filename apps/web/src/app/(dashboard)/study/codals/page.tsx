'use client';

import Link from 'next/link';

import { useBarSubjects } from '@/features/study/hooks/use-bar-subjects';
import { ROUTES } from '@/lib/constants';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircleIcon } from 'lucide-react';

export default function CodalsPage() {
  const { data, isLoading, error } = useBarSubjects();
  const subjects = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link href={ROUTES.STUDY} className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Back to Study
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Codal Reader</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse codals and statutes organized by bar exam subject area
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            Failed to load subjects: {error instanceof Error ? error.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((subject) => (
            <Link key={subject.code} href={ROUTES.STUDY_CODAL(subject.code)}>
              <Card className="group transition hover:shadow-sm">
                <CardContent className="p-5">
                  <p className="text-sm font-semibold group-hover:text-muted-foreground">
                    {subject.name}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground/60">
                    {subject.documentCount} document{subject.documentCount !== 1 ? 's' : ''}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground group-hover:text-foreground">
                    Browse &rarr;
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {!isLoading && subjects.length === 0 && !error && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No bar subjects found. Subjects will appear once codals are imported.
        </p>
      )}
    </div>
  );
}
