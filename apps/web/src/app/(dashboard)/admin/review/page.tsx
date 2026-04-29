'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, X, RotateCcw, ArrowUpDown, UserPlus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import {
  useEnhancedReviewQueue,
  useReviewQueueStats,
  useSubmitReview,
  useBatchApprove,
  useBatchReject,
  useBatchAssign,
} from '@/features/admin/hooks/use-admin';
import type { ReviewQueueItem, ReviewQueueStats } from '@/features/admin/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AdminCardSkeleton, AdminListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function ReviewQueuePage() {
  const [statusFilter, setStatusFilter] = useState('needs_human_review');
  const [originFilter, setOriginFilter] = useState('');
  const [assignedToFilter, setAssignedToFilter] = useState('');
  const [confidenceMin, setConfidenceMin] = useState('');
  const [confidenceMax, setConfidenceMax] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchNotesOpen, setBatchNotesOpen] = useState<'approve' | 'reject' | null>(null);
  const [batchNotes, setBatchNotes] = useState('');
  const [batchAssignOpen, setBatchAssignOpen] = useState(false);

  const { data: stats, isLoading: statsLoading } = useReviewQueueStats();
  const { data, isLoading, error } = useEnhancedReviewQueue({
    reviewStatus: statusFilter || undefined,
    sourceOrigin: originFilter || undefined,
    assignedTo: assignedToFilter || undefined,
    confidenceMin: confidenceMin ? Number(confidenceMin) / 100 : undefined,
    confidenceMax: confidenceMax ? Number(confidenceMax) / 100 : undefined,
    sortBy,
    sortOrder,
    cursor,
  });

  const batchApprove = useBatchApprove();
  const batchReject = useBatchReject();
  const batchAssign = useBatchAssign();

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!data) return;
    if (selected.size === data.items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.items.map((i) => i.id)));
    }
  }, [data, selected.size]);

  const handleBatchApprove = async (notes?: string) => {
    if (selected.size === 0) return;
    try {
      await batchApprove.mutateAsync({ digestIds: Array.from(selected), notes: notes || undefined });
      setSelected(new Set());
      setBatchNotesOpen(null);
      setBatchNotes('');
    } catch {
      // Error handled by mutation state
    }
  };

  const handleBatchReject = async (reason?: string) => {
    if (selected.size === 0) return;
    try {
      await batchReject.mutateAsync({ digestIds: Array.from(selected), reason: reason || undefined });
      setSelected(new Set());
      setBatchNotesOpen(null);
      setBatchNotes('');
    } catch {
      // Error handled by mutation state
    }
  };

  const handleBatchAssign = async (reviewerUserId: string) => {
    if (selected.size === 0) return;
    try {
      await batchAssign.mutateAsync({ digestIds: Array.from(selected), reviewerUserId });
      setSelected(new Set());
      setBatchAssignOpen(false);
    } catch {
      // Error handled by mutation state
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Review Queue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Digests pending editorial review with batch operations
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
      </div>

      {/* Queue Stats */}
      {statsLoading ? (
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      ) : stats ? (
        <ReviewStatsCards stats={stats} />
      ) : null}

      {/* Filters Row 1: Status, Origin, Assigned-to */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(val) => { setStatusFilter(val === '__all__' ? '' : val); setCursor(undefined); setSelected(new Set()); }}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Statuses</SelectItem>
            <SelectItem value="needs_human_review">Needs Review</SelectItem>
            <SelectItem value="ai_generated">AI Generated</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={originFilter}
          onValueChange={(val) => { setOriginFilter(val === '__all__' ? '' : val); setCursor(undefined); setSelected(new Set()); }}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="All Origins" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Origins</SelectItem>
            <SelectItem value="official_pipeline">Official Pipeline</SelectItem>
            <SelectItem value="admin_generated">Admin Generated</SelectItem>
            <SelectItem value="user_scan">User Scan</SelectItem>
            <SelectItem value="user_upload">User Upload</SelectItem>
            <SelectItem value="camera_capture">Camera Capture</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={assignedToFilter || '__all__'}
          onValueChange={(val) => { setAssignedToFilter(val === '__all__' ? '' : val); setCursor(undefined); setSelected(new Set()); }}
        >
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="All Assignees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All Assignees</SelectItem>
            <SelectItem value="__unassigned__">Unassigned</SelectItem>
            {stats?.perReviewer.map((r) => (
              <SelectItem key={r.reviewerUserId} value={r.reviewerUserId}>
                {r.reviewerName ?? r.reviewerUserId.slice(0, 8)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Filters Row 2: Confidence Range, Sort */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Confidence:</span>
          <Input
            type="number"
            min={0}
            max={100}
            value={confidenceMin}
            onChange={(e) => { setConfidenceMin(e.target.value); setCursor(undefined); }}
            placeholder="Min"
            className="h-8 w-[70px]"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="number"
            min={0}
            max={100}
            value={confidenceMax}
            onChange={(e) => { setConfidenceMax(e.target.value); setCursor(undefined); }}
            placeholder="Max"
            className="h-8 w-[70px]"
          />
          <span className="text-xs text-muted-foreground">%</span>
        </div>

        <Separator orientation="vertical" className="h-6" />

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Sort:</span>
          <Select value={sortBy} onValueChange={(val) => { setSortBy(val); setCursor(undefined); }}>
            <SelectTrigger className="h-8 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">Date Created</SelectItem>
              <SelectItem value="confidenceScore">Confidence</SelectItem>
              <SelectItem value="updatedAt">Last Updated</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-2"
            onClick={() => setSortOrder((prev) => prev === 'asc' ? 'desc' : 'asc')}
          >
            <ArrowUpDown className="mr-1 h-3 w-3" />
            {sortOrder === 'asc' ? 'Asc' : 'Desc'}
          </Button>
        </div>
      </div>

      {/* Batch Actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {selected.size} selected
          </span>
          <Button
            size="sm"
            onClick={() => { setBatchNotes(''); setBatchNotesOpen('approve'); }}
            disabled={batchApprove.isPending}
            className="h-7 bg-green-600 px-2 text-xs hover:bg-green-700"
          >
            {batchApprove.isPending ? 'Approving...' : 'Approve All'}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => { setBatchNotes(''); setBatchNotesOpen('reject'); }}
            disabled={batchReject.isPending}
            className="h-7 px-2 text-xs"
          >
            {batchReject.isPending ? 'Rejecting...' : 'Reject All'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setBatchAssignOpen(true)}
            disabled={batchAssign.isPending}
            className="h-7 px-2 text-xs"
          >
            <UserPlus className="mr-1 h-3 w-3" />
            {batchAssign.isPending ? 'Assigning...' : 'Assign'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            Clear
          </Button>
        </div>
      )}

      {/* Batch Notes Dialog */}
      <Dialog open={batchNotesOpen !== null} onOpenChange={(open) => { if (!open) setBatchNotesOpen(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {batchNotesOpen === 'approve' ? 'Batch Approve' : 'Batch Reject'} — {selected.size} digests
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="batch-notes" className="text-sm">
                {batchNotesOpen === 'approve' ? 'Notes' : 'Reason'} (optional)
              </Label>
              <Textarea
                id="batch-notes"
                value={batchNotes}
                onChange={(e) => setBatchNotes(e.target.value)}
                rows={3}
                className="mt-1"
                placeholder={batchNotesOpen === 'approve' ? 'Add notes for this batch approval...' : 'Add a reason for this batch rejection...'}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBatchNotesOpen(null)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (batchNotesOpen === 'approve') handleBatchApprove(batchNotes);
                  else handleBatchReject(batchNotes);
                }}
                disabled={batchApprove.isPending || batchReject.isPending}
                className={batchNotesOpen === 'approve' ? 'bg-green-600 hover:bg-green-700' : ''}
                variant={batchNotesOpen === 'reject' ? 'destructive' : 'default'}
              >
                {batchApprove.isPending || batchReject.isPending ? 'Processing...' : 'Confirm'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Batch Assign Dialog */}
      <Dialog open={batchAssignOpen} onOpenChange={setBatchAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign {selected.size} digests to reviewer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {stats?.perReviewer && stats.perReviewer.length > 0 ? (
              <div className="space-y-2">
                {stats.perReviewer.map((r) => (
                  <Button
                    key={r.reviewerUserId}
                    variant="outline"
                    className="w-full justify-between"
                    onClick={() => handleBatchAssign(r.reviewerUserId)}
                    disabled={batchAssign.isPending}
                  >
                    <span>{r.reviewerName ?? r.reviewerUserId.slice(0, 8)}</span>
                    <span className="text-xs text-muted-foreground">{r.assigned} assigned</span>
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No reviewers available.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {(batchApprove.isSuccess || batchReject.isSuccess) && (
        <Alert>
          <AlertDescription className="text-green-700">
            Batch operation complete: {batchApprove.data?.processed ?? batchReject.data?.processed ?? 0} digests processed.
          </AlertDescription>
        </Alert>
      )}

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load review queue'}
          </AlertDescription>
        </Alert>
      )}

      {/* Queue List */}
      {isLoading ? (
        <AdminListSkeleton count={5} />
      ) : data && data.items.length > 0 ? (
        <div className="space-y-1">
          {/* Select All Header */}
          <div className="flex items-center gap-2 px-1 py-1">
            <Checkbox
              checked={data.items.length > 0 && selected.size === data.items.length}
              onCheckedChange={toggleSelectAll}
            />
            <span className="text-xs text-muted-foreground">Select all on this page</span>
          </div>

          <div className="space-y-3">
            {data.items.map((item) => (
              <EnhancedDigestCard
                key={item.id}
                item={item}
                isSelected={selected.has(item.id)}
                onToggleSelect={() => toggleSelect(item.id)}
              />
            ))}
          </div>

          {data.meta.hasNext && data.meta.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setCursor(data.meta.nextCursor)}
              >
                Load More
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">No digests match the current filters.</p>
      )}
    </div>
  );
}

// ---- Stats Cards ----

function ReviewStatsCards({ stats }: { stats: ReviewQueueStats }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total in Queue" value={stats.total} />
        <StatCard label="Unassigned" value={stats.unassigned} accent="yellow" />
        {stats.avgConfidence !== null && (
          <StatCard
            label="Avg Confidence"
            value={`${(stats.avgConfidence * 100).toFixed(0)}%`}
          />
        )}
        {stats.avgTimeToReviewHours !== null && (
          <StatCard
            label="Avg Review Time"
            value={`${stats.avgTimeToReviewHours.toFixed(1)}h`}
          />
        )}
        {stats.byStatus.map((s) => (
          <StatCard
            key={s.status}
            label={s.status.replace(/_/g, ' ')}
            value={s.count}
          />
        ))}
      </div>

      {stats.perReviewer.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">Reviewer Workload</h3>
          <div className="flex flex-wrap gap-2">
            {stats.perReviewer.map((r) => (
              <Card key={r.reviewerUserId} className="px-3 py-2">
                <p className="text-xs font-medium">
                  {r.reviewerName ?? r.reviewerUserId.slice(0, 8)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.assigned} assigned / {r.reviewed} reviewed
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Enhanced Digest Card ----

function EnhancedDigestCard({
  item,
  isSelected,
  onToggleSelect,
}: {
  item: ReviewQueueItem;
  isSelected: boolean;
  onToggleSelect: () => void;
}) {
  const submitReview = useSubmitReview();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState('');
  const [truthfulness, setTruthfulness] = useState(80);
  const [completeness, setCompleteness] = useState(80);
  const [citationAccuracy, setCitationAccuracy] = useState(80);
  const [actionMsg, setActionMsg] = useState('');

  const handleReview = async (verdict: string) => {
    if (submitReview.isPending) return;

    // Snapshot so we can restore on failure.
    const snapshots = queryClient.getQueriesData<{ items: ReviewQueueItem[]; meta: unknown }>({
      queryKey: ['admin', 'enhanced-review-queue'],
    });

    // Optimistically drop this row from every matching review-queue cache.
    snapshots.forEach(([key, value]) => {
      if (!value?.items) return;
      queryClient.setQueryData(key, {
        ...value,
        items: value.items.filter((i) => i.id !== item.id),
      });
    });

    try {
      await submitReview.mutateAsync({
        id: item.id,
        verdict,
        notes: notes || undefined,
        truthfulness: truthfulness / 100,
        completeness: completeness / 100,
        citationAccuracy: citationAccuracy / 100,
      });
      // onSuccess invalidation refetches the authoritative list.
    } catch {
      // Roll back the optimistic removal so the user can retry.
      snapshots.forEach(([key, value]) => queryClient.setQueryData(key, value));
      setActionMsg(`Failed to ${verdict}.`);
    }
  };

  if (actionMsg) {
    return (
      <Card className="bg-muted px-4 py-3">
        <p className="text-sm text-muted-foreground">
          {item.title} — {actionMsg}
        </p>
      </Card>
    );
  }

  const reviewStatusVariant: Record<string, string> = {
    needs_human_review: 'bg-yellow-100 text-yellow-700',
    ai_generated: 'bg-blue-100 text-blue-700',
    draft: 'bg-muted text-muted-foreground',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
  };

  return (
    <Card className={isSelected ? 'border-blue-400 bg-blue-50' : ''}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Checkbox
            checked={isSelected}
            onCheckedChange={onToggleSelect}
            className="mt-1"
          />
          <div className="flex-1">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-left text-sm font-medium hover:underline"
            >
              {item.title}
            </button>
            <div className="mt-1 flex flex-wrap gap-2">
              <Badge variant="secondary">{item.digestType}</Badge>
              <Badge variant="secondary">{item.sourceOrigin.replace(/_/g, ' ')}</Badge>
              {item.confidenceScore !== null && (
                <ConfidenceBadge score={item.confidenceScore} />
              )}
              <Badge className={reviewStatusVariant[item.reviewStatus] ?? 'bg-muted text-muted-foreground'}>
                {item.reviewStatus.replace(/_/g, ' ')}
              </Badge>
              {item.assignedReviewer && (
                <Badge className="bg-blue-100 text-blue-700">
                  Assigned: {item.assignedReviewer.fullName ?? 'Unknown'}
                </Badge>
              )}
              {item._count && item._count.reviews > 0 && (
                <span className="text-xs text-muted-foreground">
                  {item._count.reviews} review(s)
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(item.createdAt).toLocaleDateString()}
              {item.legalDocument && (
                <> &middot; {item.legalDocument.grNo ?? item.legalDocument.citationText ?? item.legalDocument.title}</>
              )}
            </p>
          </div>
        </div>

        {expanded && (
          <div className="ml-7 mt-4 space-y-3">
            <Separator />
            {item.legalDocument && (
              <Card className="bg-muted">
                <CardContent className="p-3">
                  <p className="text-xs font-semibold text-muted-foreground">Source Document</p>
                  <p className="mt-0.5 text-sm">{item.legalDocument.title}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {item.legalDocument.grNo && <span>{item.legalDocument.grNo}</span>}
                    {item.legalDocument.court && <span>&middot; {item.legalDocument.court}</span>}
                    {item.legalDocument.decisionDate && (
                      <span>&middot; {new Date(item.legalDocument.decisionDate).toLocaleDateString()}</span>
                    )}
                    <span>&middot; {item.legalDocument.documentType.replace(/_/g, ' ')}</span>
                  </div>
                </CardContent>
              </Card>
            )}

            <div>
              <Label htmlFor={`notes-${item.id}`} className="text-xs">
                Review Notes (optional)
              </Label>
              <Textarea
                id={`notes-${item.id}`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1"
                placeholder="Add notes about this review..."
              />
            </div>

            {/* Review Scores */}
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-semibold text-muted-foreground">Review Scores</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">Truthfulness: {truthfulness}%</Label>
                  <input type="range" min={0} max={100} value={truthfulness} onChange={(e) => setTruthfulness(Number(e.target.value))} className="mt-1 w-full" />
                </div>
                <div>
                  <Label className="text-xs">Completeness: {completeness}%</Label>
                  <input type="range" min={0} max={100} value={completeness} onChange={(e) => setCompleteness(Number(e.target.value))} className="mt-1 w-full" />
                </div>
                <div>
                  <Label className="text-xs">Citation Accuracy: {citationAccuracy}%</Label>
                  <input type="range" min={0} max={100} value={citationAccuracy} onChange={(e) => setCitationAccuracy(Number(e.target.value))} className="mt-1 w-full" />
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleReview('approve')}
                disabled={submitReview.isPending}
                className="bg-green-600 hover:bg-green-700"
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                {submitReview.isPending ? 'Submitting...' : 'Approve'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleReview('revise')}
                disabled={submitReview.isPending}
                className="border-yellow-400 text-yellow-700 hover:bg-yellow-50"
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Request Revision
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleReview('reject')}
                disabled={submitReview.isPending}
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Reject
              </Button>
            </div>
          </div>
        )}
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
  value: number | string;
  accent?: 'yellow' | 'red';
}) {
  const valueColor =
    accent === 'red'
      ? 'text-red-600'
      : accent === 'yellow'
        ? 'text-yellow-600'
        : '';

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-1 text-xl font-bold ${valueColor}`}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      </CardContent>
    </Card>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const color =
    score >= 0.7
      ? 'bg-green-100 text-green-700'
      : score >= 0.4
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-red-100 text-red-700';

  return (
    <Badge className={color}>
      {(score * 100).toFixed(0)}% confidence
    </Badge>
  );
}
