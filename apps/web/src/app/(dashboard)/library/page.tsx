'use client';

import { useMemo, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircleIcon, LibraryBigIcon, SearchIcon } from 'lucide-react';

import { DerivativeCard } from '@/features/derivatives/components/derivative-card';
import { DerivativeTypeFilter } from '@/features/derivatives/components/derivative-type-filter';
import { SubjectChips } from '@/features/derivatives/components/subject-chips';
import {
  useDerivativeSubjects,
  useDerivatives,
} from '@/features/derivatives/hooks/use-derivatives';

export default function LibraryPage() {
  const [subjectCode, setSubjectCode] = useState<string | null>(null);
  const [derivativeType, setDerivativeType] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const { data: subjects, isLoading: subjectsLoading } = useDerivativeSubjects('study_8');

  const queryParams = useMemo(
    () => ({
      subjectCode: subjectCode ?? undefined,
      derivativeType: derivativeType ?? undefined,
      search: debouncedSearch.trim() || undefined,
      taxonomyVersion: 'study_8',
    }),
    [subjectCode, derivativeType, debouncedSearch],
  );

  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDerivatives(queryParams);

  const items = useMemo(
    () => data?.pages.flatMap((p) => p.data) ?? [],
    [data],
  );

  const subjectChipsData = subjects ?? [];
  const activeSubject = subjectCode
    ? subjectChipsData.find((s) => s.code === subjectCode)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <LibraryBigIcon className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI-generated digests, doctrines, MCQs, and essays — organized by Philippine bar subject.
          </p>
        </div>
      </div>

      <SubjectChips
        subjects={subjectChipsData}
        activeCode={subjectCode}
        onChange={setSubjectCode}
        isLoading={subjectsLoading}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <DerivativeTypeFilter value={derivativeType} onChange={setDerivativeType} />
        <form
          className="relative w-full sm:w-80"
          onSubmit={(e) => {
            e.preventDefault();
            setDebouncedSearch(search);
          }}
        >
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search titles..."
            className="pl-9"
            aria-label="Search derivatives"
          />
        </form>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            Failed to load library: {error instanceof Error ? error.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {!isLoading && items.length === 0 && !error && (
        <div className="rounded-lg border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {activeSubject
              ? `No approved content yet for ${activeSubject.name}. Check back soon.`
              : 'No approved library content yet. Check back soon.'}
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <DerivativeCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
