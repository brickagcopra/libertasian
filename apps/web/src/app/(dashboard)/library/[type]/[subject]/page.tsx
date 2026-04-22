'use client';

import { notFound, useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircleIcon, SearchIcon } from 'lucide-react';

import { DerivativeCard } from '@/features/derivatives/components/derivative-card';
import { LibraryBreadcrumb } from '@/features/derivatives/components/library-breadcrumb';
import { useDerivatives } from '@/features/derivatives/hooks/use-derivatives';
import { subjectFromSlug, typeFromSlug } from '@/features/derivatives/taxonomy';

export default function LibrarySubjectPage() {
  const params = useParams<{ type: string; subject: string }>();
  const typeMeta = params?.type ? typeFromSlug(params.type) : undefined;
  const subjectMeta = params?.subject ? subjectFromSlug(params.subject) : undefined;

  if (!typeMeta || !subjectMeta) {
    notFound();
  }

  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const queryParams = useMemo(
    () => ({
      subjectCode: subjectMeta.code,
      derivativeType: typeMeta.enum,
      taxonomyVersion: 'study_8',
      search: appliedSearch.trim() || undefined,
    }),
    [subjectMeta.code, typeMeta.enum, appliedSearch],
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

  return (
    <div className="space-y-6">
      <LibraryBreadcrumb
        segments={[
          { href: '/library', label: 'Library' },
          { href: `/library/${typeMeta.slug}`, label: typeMeta.label },
          { label: subjectMeta.name },
        ]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {subjectMeta.name} {typeMeta.label}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{typeMeta.description}</p>
        </div>
        <form
          className="relative w-full sm:w-72"
          onSubmit={(e) => {
            e.preventDefault();
            setAppliedSearch(search);
          }}
        >
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${typeMeta.label.toLowerCase()}...`}
            className="pl-9"
            aria-label="Search within subject"
          />
        </form>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            Failed to load: {error instanceof Error ? error.message : 'Unknown error'}
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
            No {typeMeta.label.toLowerCase()} available for {subjectMeta.name} yet.
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
