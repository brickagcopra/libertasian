'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
  BULK_MAX_CASES,
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
import { BulkActionDialog, type BulkDecision } from './bulk-action-dialog';

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

const caseKey = (c: { targetType: string; targetId: string }) => `${c.targetType}:${c.targetId}`;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function CaseQueue() {
  const router = useRouter();
  const [status, setStatus] = useState<ModerationCaseStatus>('open');
  const [type, setType] = useState<ModerationTypeFilter>('all');
  const [sort, setSort] = useState<ModerationSort>('oldest');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDecision, setBulkDecision] = useState<BulkDecision | null>(null);

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

  // Selection only applies to open cases on the current page; anything that
  // dropped off the page (resolved, paged away) silently leaves it.
  const selectable = status === 'open';
  const pageKeys = useMemo(() => cases.map(caseKey), [cases]);
  const selectedCases = cases.filter((c) => selected.has(caseKey(c)));
  const allSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k));
  const someSelected = selectedCases.length > 0;

  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const toggleAll = (on: boolean) => setSelected(on ? new Set(pageKeys.slice(0, BULK_MAX_CASES)) : new Set());
  const resetView = () => {
    setOffset(0);
    setSelected(new Set());
  };

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
                resetView();
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
            resetView();
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
            resetView();
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

      {selectable && someSelected && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 px-3 py-2"
          role="toolbar"
          aria-label="Bulk actions"
        >
          <span className="text-sm font-medium">{selectedCases.length} selected</span>
          <Button size="sm" variant="outline" onClick={() => setBulkDecision('dismiss')}>
            Dismiss reports
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setBulkDecision('remove')}>
            Remove content
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

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
                  {selectable && (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all cases on this page"
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={(v) => toggleAll(v === true)}
                        disabled={cases.length === 0}
                      />
                    </TableHead>
                  )}
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
                    <TableCell colSpan={selectable ? 8 : 7} className="py-8 text-center text-muted-foreground">
                      {status === 'open' ? 'No open cases. The queue is clear.' : 'No resolved cases.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  cases.map((c) => {
                    const href = ROUTES.ADMIN_MODERATION_CASE(c.targetType, c.targetId);
                    const key = caseKey(c);
                    return (
                      <TableRow
                        key={`${c.targetType}:${c.targetId}`}
                        className="cursor-pointer"
                        data-testid="moderation-case-row"
                        data-state={selected.has(key) ? 'selected' : undefined}
                        onClick={() => router.push(href)}
                      >
                        {selectable && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              aria-label={`Select ${TARGET_TYPE_LABELS[c.targetType].toLowerCase()} case`}
                              checked={selected.has(key)}
                              disabled={!selected.has(key) && selected.size >= BULK_MAX_CASES}
                              onCheckedChange={(v) => toggle(key, v === true)}
                            />
                          </TableCell>
                        )}
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
              onClick={() => {
                setSelected(new Set());
                setOffset((o) => Math.max(0, o - QUEUE_PAGE_SIZE));
              }}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasNext || isFetching}
              onClick={() => {
                setSelected(new Set());
                setOffset((o) => o + QUEUE_PAGE_SIZE);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <BulkActionDialog
        decision={bulkDecision}
        cases={selectedCases.map((c) => ({ targetType: c.targetType, targetId: c.targetId }))}
        onClose={() => setBulkDecision(null)}
        onDone={(result) =>
          setSelected((prev) => {
            const next = new Set(prev);
            for (const c of result.succeeded) next.delete(caseKey(c));
            return next;
          })
        }
      />
    </div>
  );
}
