'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ROUTES } from '@/lib/constants';

import { useModerationCases } from '../hooks/use-moderation';
import { formatDateTime } from '../sla';
import {
  TARGET_TYPE_LABELS,
  type ModerationCaseStatus,
  type ModerationSort,
  type ModerationTargetType,
  type ModerationTypeFilter,
} from '../types';
import {
  AutoHiddenBadge,
  ContentStatusBadge,
  SlaBadge,
  reasonLabel,
  topReasons,
} from './moderation-badges';

export const QUEUE_PAGE_SIZE = 25;

const TYPE_OPTIONS: Array<{ value: ModerationTypeFilter; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'feed', label: 'Feed (posts + comments)' },
  { value: 'community', label: 'Community study items' },
  ...(Object.keys(TARGET_TYPE_LABELS) as ModerationTargetType[]).map((t) => ({
    value: t,
    label: TARGET_TYPE_LABELS[t],
  })),
];

const SORT_OPTIONS: Array<{ value: ModerationSort; label: string }> = [
  { value: 'oldest', label: 'Oldest first' },
  { value: 'newest', label: 'Newest first' },
  { value: 'most_reported', label: 'Most reported' },
];

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function CaseQueue() {
  const router = useRouter();
  const [status, setStatus] = useState<ModerationCaseStatus>('open');
  const [type, setType] = useState<ModerationTypeFilter>('all');
  const [sort, setSort] = useState<ModerationSort>('oldest');
  const [offset, setOffset] = useState(0);

  const { data, isLoading, error, isFetching } = useModerationCases({
    status,
    type,
    sort,
    limit: QUEUE_PAGE_SIZE,
    offset,
  });

  const cases = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const hasNext = data?.meta.hasNext ?? false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2" role="group" aria-label="Case status">
          {(['open', 'resolved'] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? 'default' : 'outline'}
              onClick={() => {
                setStatus(s);
                setOffset(0);
              }}
            >
              {s === 'open' ? 'Open' : 'Resolved'}
            </Button>
          ))}
        </div>

        <Select
          value={type}
          onValueChange={(v) => {
            setType(v as ModerationTypeFilter);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-[220px]" aria-label="Content type">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={sort}
          onValueChange={(v) => {
            setSort(v as ModerationSort);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-[170px]" aria-label="Sort">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="ml-auto text-sm text-muted-foreground">
          {total} case{total === 1 ? '' : 's'}
        </span>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load cases'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{status === 'open' ? 'Age' : 'Resolved'}</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead>Author</TableHead>
                  <TableHead className="text-right">Reports</TableHead>
                  <TableHead>Top reasons</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      {status === 'open' ? 'No open cases. The queue is clear.' : 'No resolved cases.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  cases.map((c) => {
                    const href = ROUTES.ADMIN_MODERATION_CASE(c.targetType, c.targetId);
                    return (
                      <TableRow
                        key={`${c.targetType}:${c.targetId}`}
                        className="cursor-pointer"
                        data-testid="moderation-case-row"
                        onClick={() => router.push(href)}
                      >
                        <TableCell>
                          {c.status === 'open' ? (
                            <SlaBadge firstReportedAt={c.firstReportedAt} />
                          ) : (
                            <div className="flex flex-col text-xs text-muted-foreground">
                              <span>{formatDateTime(c.resolvedAt)}</span>
                              {c.resolution && <span>{c.resolution}</span>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{TARGET_TYPE_LABELS[c.targetType]}</TableCell>
                        <TableCell className="max-w-[360px]">
                          <Link
                            href={href}
                            className="block truncate text-sm hover:underline"
                            title={c.preview ?? undefined}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {c.preview ? truncate(c.preview, 120) : (
                              <span className="italic text-muted-foreground">No preview</span>
                            )}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          {c.author?.fullName ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right font-medium">{c.reportCount}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {topReasons(c.reasons).map(([reason, count]) => (
                              <Badge key={reason} variant="outline" className="font-normal">
                                {reasonLabel(reason)}
                                {count > 1 ? ` ×${count}` : ''}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            <ContentStatusBadge status={c.contentStatus} />
                            {c.autoHidden && <AutoHiddenBadge />}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {(offset > 0 || hasNext) && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {total === 0 ? 0 : offset + 1}–{offset + cases.length} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0 || isFetching}
              onClick={() => setOffset((o) => Math.max(0, o - QUEUE_PAGE_SIZE))}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext || isFetching}
              onClick={() => setOffset((o) => o + QUEUE_PAGE_SIZE)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
