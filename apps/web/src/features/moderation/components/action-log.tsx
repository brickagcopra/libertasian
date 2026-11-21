'use client';

import { useMemo } from 'react';
import Link from 'next/link';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/lib/constants';

import { useModerationLog } from '../hooks/use-moderation';
import { formatDateTime } from '../sla';
import { REASON_LABELS, type ModerationActionEntry } from '../types';
import { ACTION_LABELS, targetTypeLabel } from './moderation-badges';

/** One line of a moderation action. Shared by the log tab and the case timelines. */
export function ActionEntryRow({
  entry,
  linkTarget = false,
}: {
  entry: ModerationActionEntry;
  linkTarget?: boolean;
}) {
  const target =
    entry.targetType === 'user' ? null : (
      <span>
        {' '}
        on{' '}
        {linkTarget ? (
          <Link
            href={ROUTES.ADMIN_MODERATION_CASE(entry.targetType, entry.targetId)}
            className="underline-offset-2 hover:underline"
          >
            {targetTypeLabel(entry.targetType).toLowerCase()}
          </Link>
        ) : (
          targetTypeLabel(entry.targetType).toLowerCase()
        )}
      </span>
    );

  return (
    <div className="space-y-0.5 py-2 text-sm">
      <div>
        <span className="font-medium">{entry.moderator?.fullName ?? 'System'}</span>{' '}
        <span>{ACTION_LABELS[entry.action].toLowerCase()}</span>
        {entry.subjectUser && (
          <span>
            {' '}
            · <span className="font-medium">{entry.subjectUser.fullName}</span>
          </span>
        )}
        {target}
        {entry.reportsResolved > 0 && (
          <span className="text-muted-foreground">
            {' '}
            ({entry.reportsResolved} report{entry.reportsResolved === 1 ? '' : 's'} resolved)
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground">
        {formatDateTime(entry.createdAt)}
        {entry.reason && ` · ${REASON_LABELS[entry.reason] ?? entry.reason}`}
      </div>
      {entry.note && <p className="whitespace-pre-wrap text-xs text-muted-foreground">“{entry.note}”</p>}
    </div>
  );
}

export function ActionLog() {
  const { data, isLoading, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useModerationLog();
  const entries = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  if (isLoading) return <AdminListSkeleton />;

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load the moderation log'}
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent className="divide-y">
          {entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No moderation actions yet.</p>
          ) : (
            entries.map((e) => <ActionEntryRow key={e.id} entry={e} linkTarget />)
          )}
        </CardContent>
      </Card>
      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
