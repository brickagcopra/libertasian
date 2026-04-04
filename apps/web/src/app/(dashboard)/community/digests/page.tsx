'use client';

import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircleIcon, FileTextIcon } from 'lucide-react';

import { MarketplaceFilters } from '@/features/community/components/marketplace-filters';
import { MarketplaceItemCard } from '@/features/community/components/marketplace-item-card';
import { useMarketplaceDigests } from '@/features/community/hooks/use-marketplace';
import { useBarSubjects } from '@/features/study/hooks/use-bar-subjects';
import type { MarketplaceSortBy } from '@/features/community/types';

function ListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl border p-4">
          <div className="flex gap-3">
            <div className="size-9 animate-pulse rounded-lg bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MarketplaceDigestsPage() {
  const [sortBy, setSortBy] = useState<MarketplaceSortBy>('trending');
  const [barSubject, setBarSubject] = useState('all');
  const [search, setSearch] = useState('');

  const { data: barSubjectsRes } = useBarSubjects();
  const barSubjects = barSubjectsRes?.data?.map((s) => ({ code: s.code, name: s.name }));

  const { data, isLoading, error } = useMarketplaceDigests({
    sortBy,
    barSubject: barSubject !== 'all' ? barSubject : undefined,
    search: search.trim() || undefined,
  });

  const items = data?.data?.items ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <FileTextIcon className="size-5 text-muted-foreground" />
          <h1 className="text-2xl font-bold">Community Digests</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse and vote on case digests contributed by the community. Upvote the
          best to help others find quality content.
        </p>
      </div>

      {/* Filters */}
      <MarketplaceFilters
        sortBy={sortBy}
        onSortChange={setSortBy}
        barSubject={barSubject}
        onBarSubjectChange={setBarSubject}
        search={search}
        onSearchChange={setSearch}
        barSubjects={barSubjects}
      />

      {/* States */}
      {isLoading && <ListSkeleton />}

      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            Failed to load digests: {error instanceof Error ? error.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && items.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No community digests found. Try adjusting your filters.
        </p>
      )}

      {/* List */}
      <div className="space-y-3">
        {items.map((item) => (
          <MarketplaceItemCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
