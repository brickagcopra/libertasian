'use client';

import { useState } from 'react';
import { LoaderIcon, PlusIcon, Trash2Icon } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import {
  useDeepResearchRuns,
  useDeleteDeepResearchRun,
} from '../hooks/use-deep-research-runs';
import type { DeepResearchRunListItem, DeepResearchRunStatus } from '../schemas';

const STATUS_LABEL: Record<DeepResearchRunStatus, string | null> = {
  completed: null,
  running: 'Running',
  abstained: 'No answer',
  failed: 'Failed',
};

function relativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

export function HistoryRail({
  activeRunId,
  onSelect,
  onNew,
  onDeleted,
}: {
  activeRunId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeleted?: (id: string) => void;
}) {
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useDeepResearchRuns();
  const del = useDeleteDeepResearchRun();
  const [pendingDelete, setPendingDelete] = useState<DeepResearchRunListItem | null>(null);
  const runs = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="history-rail">
      <Button variant="pill" onClick={onNew} className="w-full">
        <PlusIcon aria-hidden />
        New research
      </Button>
      <p className="px-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-warm-ink-faint">
        History
      </p>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {isLoading && (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}
        {isError && (
          <p className="px-1 text-xs text-warm-ink-mid">Couldn’t load your history.</p>
        )}
        {!isLoading && !isError && runs.length === 0 && (
          <p className="px-1 text-xs text-warm-ink-mid">Your research runs will appear here.</p>
        )}
        {runs.map((run) => {
          const status = STATUS_LABEL[run.status];
          const active = run.id === activeRunId;
          return (
            <div
              key={run.id}
              className={cn(
                'group flex items-start gap-1 rounded-md transition-colors',
                active ? 'bg-warm-ink text-warm-cream' : 'hover:bg-warm-cream-2',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(run.id)}
                aria-current={active ? 'true' : undefined}
                className="min-w-0 flex-1 px-3 py-2 text-left"
              >
                <span
                  className={cn(
                    'line-clamp-2 text-sm leading-5',
                    active ? 'text-warm-cream' : 'text-warm-ink',
                  )}
                >
                  {run.question}
                </span>
                <span
                  className={cn(
                    'mt-0.5 block text-[11px]',
                    active ? 'text-warm-cream/70' : 'text-warm-ink-faint',
                  )}
                >
                  {relativeDate(run.createdAt)}
                  {status && ` · ${status}`}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Delete “${run.question}”`}
                onClick={() => setPendingDelete(run)}
                className={cn(
                  'm-1 rounded p-1.5 opacity-60 transition hover:opacity-100 focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-60',
                  active ? 'text-warm-cream' : 'text-warm-ink-mid',
                )}
              >
                <Trash2Icon className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
        {hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage && <LoaderIcon className="animate-spin" aria-hidden />}
            Load more
          </Button>
        )}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this research run?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved answer and its sources will be removed. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const run = pendingDelete;
                setPendingDelete(null);
                if (!run) return;
                del.mutate(run.id, { onSuccess: () => onDeleted?.(run.id) });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
