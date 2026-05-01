'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Play } from 'lucide-react';

import {
  useDuplicates,
  useDuplicateStats,
  useRunDuplicateDetection,
  useMergeDuplicate,
  useDismissDuplicate,
} from '@/features/admin/hooks/use-admin';
import type { DocumentSimilarityItem } from '@/features/admin/types';
import { AdminCardSkeleton, AdminListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function DuplicatesPage() {
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const { data: stats, isLoading: statsLoading } = useDuplicateStats();
  const { data, isLoading, error } = useDuplicates({
    status: statusFilter || undefined,
    similarityType: typeFilter || undefined,
    cursor,
  });
  const detect = useRunDuplicateDetection();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Duplicate Detection</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Detect and manage duplicate documents in the corpus
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
      </div>

      {/* Stats Overview */}
      {statsLoading ? (
        <div className="grid gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      ) : stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Total Pairs" value={stats.total ?? 0} />
          <StatCard label="Pending" value={stats.pending ?? 0} accent="yellow" />
          <StatCard label="Merged" value={stats.merged ?? 0} accent="green" />
          <StatCard
            label="Dismissed"
            value={(stats.dismissed ?? 0) + (stats.autoDismissed ?? 0)}
          />
          {stats.byType.map((t) => (
            <StatCard key={t.type} label={formatType(t.type)} value={t.count} />
          ))}
        </div>
      ) : null}

      {/* Detection Actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => detect.mutate(undefined)}
          disabled={detect.isPending}
        >
          <Play className="mr-1.5 h-4 w-4" />
          {detect.isPending ? 'Running...' : 'Run Full Detection'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => detect.mutate('checksum')}
          disabled={detect.isPending}
        >
          Checksum Only
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => detect.mutate('title')}
          disabled={detect.isPending}
        >
          Title Only
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => detect.mutate('citation')}
          disabled={detect.isPending}
        >
          Citation Only
        </Button>
      </div>

      {detect.isSuccess && (
        <Alert>
          <AlertDescription className="text-green-700">
            Detection complete: {detect.data.pairsCreated} new pairs found
            ({detect.data.similarityType}, {detect.data.duration}ms)
          </AlertDescription>
        </Alert>
      )}

      {detect.isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Detection failed: {detect.error instanceof Error ? detect.error.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <Select
          value={statusFilter || '__all__'}
          onValueChange={(val) => { setStatusFilter(val === '__all__' ? '' : val); setCursor(undefined); }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="merged">Merged</SelectItem>
            <SelectItem value="dismissed">Dismissed</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={typeFilter || '__all__'}
          onValueChange={(val) => { setTypeFilter(val === '__all__' ? '' : val); setCursor(undefined); }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Types</SelectItem>
            <SelectItem value="checksum">Checksum</SelectItem>
            <SelectItem value="title">Title</SelectItem>
            <SelectItem value="citation">Citation</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load duplicates'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton count={5} />
      ) : data && data.items.length > 0 ? (
        <div className="space-y-3">
          {data.items.map((pair) => (
            <DuplicateCard key={pair.id} pair={pair} />
          ))}

          {data.meta.hasNext && data.meta.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => setCursor(data.meta.nextCursor)}>
                Load More
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">No duplicate pairs found.</p>
      )}
    </div>
  );
}

// ---- Duplicate Card ----

function DuplicateCard({ pair }: { pair: DocumentSimilarityItem }) {
  const merge = useMergeDuplicate();
  const dismiss = useDismissDuplicate();
  const [expanded, setExpanded] = useState(false);
  const [actionMsg, setActionMsg] = useState('');

  const handleMerge = async (keepDocumentId: string) => {
    try {
      await merge.mutateAsync({ id: pair.id, keepDocumentId });
      setActionMsg('Merged.');
    } catch {
      setActionMsg('Merge failed.');
    }
  };

  const handleDismiss = async () => {
    try {
      await dismiss.mutateAsync(pair.id);
      setActionMsg('Dismissed.');
    } catch {
      setActionMsg('Dismiss failed.');
    }
  };

  if (actionMsg) {
    return (
      <Card className="bg-muted">
        <CardContent className="px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Pair #{pair.id.slice(0, 8)} — {actionMsg}
          </p>
        </CardContent>
      </Card>
    );
  }

  const isPending = pair.status === 'pending';

  const similarityVariants: Record<string, string> = {
    checksum: 'bg-red-100 text-red-700',
    title: 'bg-blue-100 text-blue-700',
    citation: 'bg-purple-100 text-purple-700',
  };

  const statusVariants: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    merged: 'bg-green-100 text-green-700',
    dismissed: 'bg-muted text-muted-foreground',
  };

  const scoreColor =
    pair.similarityScore >= 0.9
      ? 'bg-red-100 text-red-700'
      : pair.similarityScore >= 0.7
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-muted text-muted-foreground';

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <button onClick={() => setExpanded(!expanded)} className="flex-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={similarityVariants[pair.similarityType] ?? 'bg-muted text-muted-foreground'}>
                {pair.similarityType}
              </Badge>
              <Badge className={scoreColor}>
                {(pair.similarityScore * 100).toFixed(0)}% match
              </Badge>
              <Badge className={statusVariants[pair.status] ?? 'bg-muted text-muted-foreground'}>
                {pair.status}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(pair.createdAt).toLocaleDateString()}
              </span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <DocSummary label="Document A" doc={pair.documentA} />
              <DocSummary label="Document B" doc={pair.documentB} />
            </div>
          </button>
        </div>

        {expanded && isPending && (
          <>
            <Separator className="my-3" />
            <div className="flex flex-wrap gap-2">
              {pair.documentA && (
                <Button
                  size="sm"
                  onClick={() => handleMerge(pair.documentA!.id)}
                  disabled={merge.isPending}
                >
                  Keep A
                </Button>
              )}
              {pair.documentB && (
                <Button
                  size="sm"
                  onClick={() => handleMerge(pair.documentB!.id)}
                  disabled={merge.isPending}
                >
                  Keep B
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={handleDismiss}
                disabled={dismiss.isPending}
              >
                Dismiss
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DocSummary({
  label,
  doc,
}: {
  label: string;
  doc?: {
    id: string;
    title: string;
    citationText: string | null;
    grNo: string | null;
    documentType: string;
    court: string | null;
    checksum: string | null;
  };
}) {
  if (!doc) {
    return (
      <Card className="bg-muted">
        <CardContent className="p-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">Document not found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-muted">
      <CardContent className="p-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-sm font-medium line-clamp-2">{doc.title}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {doc.grNo && <span className="text-xs text-muted-foreground">{doc.grNo}</span>}
          {doc.court && <span className="text-xs text-muted-foreground">&middot; {doc.court}</span>}
          <span className="text-xs text-muted-foreground">{doc.documentType.replace('_', ' ')}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Sub-components ----

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'yellow' | 'red' | 'green';
}) {
  const valueColor =
    accent === 'red'
      ? 'text-red-600'
      : accent === 'yellow'
        ? 'text-yellow-600'
        : accent === 'green'
          ? 'text-green-600'
          : '';

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${valueColor}`}>{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}

function formatType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}
