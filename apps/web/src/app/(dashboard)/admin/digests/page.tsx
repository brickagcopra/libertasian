'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, FileTextIcon, ArrowUpDown } from 'lucide-react';

import {
  useEnhancedReviewQueue,
  useReviewQueueStats,
} from '@/features/admin/hooks/use-admin';
import type { ReviewQueueItem, ReviewQueueStats } from '@/features/admin/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';

const TAB_VALUES = ['all', 'needs_human_review', 'approved', 'rejected'] as const;
type TabValue = (typeof TAB_VALUES)[number];

const TAB_LABELS: Record<TabValue, string> = {
  all: 'All',
  needs_human_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
};

const SORT_OPTIONS = [
  { value: 'updatedAt', label: 'Recently updated' },
  { value: 'createdAt', label: 'Recently created' },
  { value: 'confidenceScore', label: 'Confidence' },
] as const;

const ORIGIN_OPTIONS = [
  { value: '__all__', label: 'All origins' },
  { value: 'official_pipeline', label: 'Official pipeline' },
  { value: 'admin_generated', label: 'Admin generated' },
  { value: 'user_scan', label: 'User scan' },
  { value: 'user_upload', label: 'User upload' },
  { value: 'camera_capture', label: 'Camera capture' },
];

const REVIEW_STATUS_VARIANT: Record<string, string> = {
  needs_human_review: 'bg-yellow-100 text-yellow-700',
  ai_generated: 'bg-blue-100 text-blue-700',
  draft: 'bg-muted text-muted-foreground',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function DigestsListPage() {
  const [tab, setTab] = useState<TabValue>('all');
  const [origin, setOrigin] = useState<string>('__all__');
  const [sortBy, setSortBy] = useState<string>('updatedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [limit, setLimit] = useState<number>(20);
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const reviewStatus = tab === 'all' ? undefined : tab;
  const sourceOrigin = origin === '__all__' ? undefined : origin;

  const { data: stats } = useReviewQueueStats();
  const { data, isLoading, error } = useEnhancedReviewQueue({
    reviewStatus,
    sourceOrigin,
    sortBy,
    sortOrder,
    limit,
    cursor,
  });

  const tabCounts = useMemo(() => buildTabCounts(stats), [stats]);

  const handleTabChange = (val: string) => {
    if (TAB_VALUES.includes(val as TabValue)) {
      setTab(val as TabValue);
      setCursor(undefined);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/admin"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Digests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse all digests in the corpus, filter by status, and drill into details.
          </p>
        </div>
        <Button variant="outline" asChild className="self-start sm:self-auto">
          <Link href="/admin/review" aria-label="Open review queue">
            Open review queue
            <ArrowRight className="ml-1.5 size-4" />
          </Link>
        </Button>
      </div>

      {/* Status tabs */}
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="flex flex-wrap">
          {TAB_VALUES.map((v) => (
            <TabsTrigger key={v} value={v}>
              {TAB_LABELS[v]}
              {tabCounts[v] !== undefined && (
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                  ({tabCounts[v]?.toLocaleString()})
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={origin}
          onValueChange={(val) => {
            setOrigin(val);
            setCursor(undefined);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ORIGIN_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Sort:</span>
          <Select
            value={sortBy}
            onValueChange={(val) => {
              setSortBy(val);
              setCursor(undefined);
            }}
          >
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-2"
            aria-label={`Sort direction: ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
            onClick={() => {
              setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
              setCursor(undefined);
            }}
          >
            <ArrowUpDown className="mr-1 size-3.5" />
            {sortOrder === 'asc' ? 'Asc' : 'Desc'}
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Limit:</span>
          <Select
            value={String(limit)}
            onValueChange={(val) => {
              setLimit(Number(val));
              setCursor(undefined);
            }}
          >
            <SelectTrigger className="h-9 w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Errors */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load digests'}
          </AlertDescription>
        </Alert>
      )}

      {/* List */}
      {isLoading ? (
        <AdminListSkeleton count={5} />
      ) : data && data.items.length > 0 ? (
        <>
          <div className="space-y-2">
            {data.items.map((item) => (
              <DigestRow key={item.id} item={item} />
            ))}
          </div>
          {data.meta.hasNext && data.meta.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setCursor(data.meta.nextCursor)}
              >
                Next page
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

// ---- Sub-components ----

function DigestRow({ item }: { item: ReviewQueueItem }) {
  const citation =
    item.legalDocument?.grNo ??
    item.legalDocument?.citationText ??
    item.legalDocument?.shortTitle ??
    null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/admin/digests/${item.id}`}
              className="text-sm font-medium hover:underline"
            >
              {item.title}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {citation && <span className="truncate">{citation}</span>}
              <Badge
                className={
                  REVIEW_STATUS_VARIANT[item.reviewStatus] ??
                  'bg-muted text-muted-foreground'
                }
              >
                {item.reviewStatus.replace(/_/g, ' ')}
              </Badge>
              {item.confidenceScore !== null && (
                <span className="tabular-nums">
                  {(item.confidenceScore * 100).toFixed(0)}% confidence
                </span>
              )}
              <span>· updated {formatRelative(item.updatedAt)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/admin/digests/${item.id}`}
                aria-label={`View digest ${item.title}`}
              >
                View
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
        <FileTextIcon className="size-8 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">No digests match this view</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Try a different status tab, or jump into the review queue or ingestion pipeline.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/review">Open review queue</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/ingestion">View ingestion pipeline</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function buildTabCounts(stats: ReviewQueueStats | undefined): Partial<Record<TabValue, number>> {
  if (!stats) return {};
  const byStatus: Record<string, number> = {};
  for (const row of stats.byStatus) {
    byStatus[row.status] = row.count;
  }
  return {
    all: stats.total,
    needs_human_review: byStatus['needs_human_review'] ?? 0,
    approved: byStatus['approved'] ?? 0,
    rejected: byStatus['rejected'] ?? 0,
  };
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const absSec = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (absSec < 60) return rtf.format(diffSec, 'second');
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (absSec < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day');
  if (absSec < 86400 * 365)
    return rtf.format(Math.round(diffSec / (86400 * 30)), 'month');
  return rtf.format(Math.round(diffSec / (86400 * 365)), 'year');
}
