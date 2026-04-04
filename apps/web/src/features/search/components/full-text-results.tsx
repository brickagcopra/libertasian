import { Button } from '@/components/ui/button';
import { SearchResultListSkeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderIcon,
} from 'lucide-react';

import type { SearchMeta, SearchResultItem } from '../types';
import { SearchResultCard } from './search-result-card';

interface FullTextResultsProps {
  results: SearchResultItem[];
  meta: SearchMeta | undefined;
  page: number;
  onPageChange: (page: number) => void;
  isLoading: boolean;
  error: Error | null;
}

export function FullTextResults({
  results,
  meta,
  page,
  onPageChange,
  isLoading,
  error,
}: FullTextResultsProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderIcon className="size-4 animate-spin" />
          Searching...
        </div>
        <SearchResultListSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon className="size-4" />
        <AlertDescription>
          Search failed: {error.message}
        </AlertDescription>
      </Alert>
    );
  }

  if (!meta) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {meta.total.toLocaleString()} result{meta.total !== 1 ? 's' : ''}
          {meta.timedOut && ' (results may be incomplete)'}
        </span>
        {meta.total > 0 && (
          <span>
            Page {page + 1} of {Math.ceil(meta.total / meta.limit)}
          </span>
        )}
      </div>

      {results.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No results found. Try adjusting your search terms or filters.
        </p>
      )}

      <div className="space-y-3">
        {results.map((item) => (
          <SearchResultCard key={item.id} item={item} />
        ))}
      </div>

      {meta.total > meta.limit && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0}
          >
            <ChevronLeftIcon />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {Math.ceil(meta.total / meta.limit)}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={(page + 1) * meta.limit >= meta.total}
          >
            Next
            <ChevronRightIcon />
          </Button>
        </div>
      )}
    </div>
  );
}
