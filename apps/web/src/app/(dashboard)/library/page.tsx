'use client';

import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';

import { Card, CardContent } from '@/components/ui/card';
import { StaggerGrid } from '@/components/ui/stagger-grid';
import { LibraryBigIcon } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

import { DERIVATIVE_TYPES } from '@/features/derivatives/taxonomy';
import type { DerivativeTypeSubjectSummary } from '@/features/derivatives/types';

export default function LibraryHubPage() {
  const results = useQueries({
    queries: DERIVATIVE_TYPES.map((t) => ({
      queryKey: ['derivatives', 'subjects-by-type', t.enum, 'study_8'],
      queryFn: async () => {
        const res = await apiClient.get<{
          success: boolean;
          data: DerivativeTypeSubjectSummary[];
        }>(`/derivatives/types/${t.enum}/subjects/summary`, {
          params: { taxonomyVersion: 'study_8' },
        });
        return res.data ?? [];
      },
      staleTime: 5 * 60_000,
    })),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <LibraryBigIcon className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI-generated study material organised by product type.
          </p>
        </div>
      </div>

      <StaggerGrid className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DERIVATIVE_TYPES.map((t, i) => {
          const result = results[i];
          const approvedTotal = (result?.data ?? []).reduce(
            (sum, s) => sum + s.approvedCount,
            0,
          );
          const isLoading = result?.isLoading ?? false;
          const Icon = t.icon;
          return (
            <Link key={t.enum} href={`/library/${t.slug}`} className="block">
              <Card className="h-full transition hover:shadow-md">
                <CardContent className="flex h-full flex-col gap-3 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h2 className="text-base font-semibold">
                      {t.enum === 'case_digest' ? `${t.label} (corpus)` : t.label}
                    </h2>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {t.description}
                  </p>
                  <div className="mt-auto text-xs text-muted-foreground">
                    {isLoading ? (
                      <span className="inline-block h-3 w-16 animate-pulse rounded bg-muted" />
                    ) : (
                      <span>
                        <span className="font-semibold text-foreground">
                          {approvedTotal}
                        </span>{' '}
                        {(() => {
                          // Flashcards count individual cards (Study counts
                          // sets), so label them "cards" to avoid implying the
                          // two screens contradict each other.
                          const unit = t.enum === 'flashcard' ? 'card' : 'item';
                          return approvedTotal === 1 ? unit : `${unit}s`;
                        })()}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </StaggerGrid>
    </div>
  );
}
