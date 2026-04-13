'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Sparkles,
  Trash2,
  ChevronRight,
} from 'lucide-react';

import {
  useGoldenSets,
  useGoldenSetStats,
  useApproveGoldenSet,
  useRejectGoldenSet,
  useBulkApproveGoldenSets,
  useDeleteGoldenSet,
  useGenerateDraftDigests,
  useGenerateDraftClassifications,
  useSampleMcqGoldenSet,
} from '@/features/admin/hooks/use-golden-sets';
import type { GoldenSetEntry } from '@/features/admin/types';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TAB_TYPES = [
  { value: 'case_digest', label: 'Case Digests' },
  { value: 'subject_classification', label: 'Subject Classification' },
  { value: 'mcq_question', label: 'MCQ Questions' },
] as const;

const STATUS_VARIANTS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function GoldenSetsPage() {
  const [activeTab, setActiveTab] = useState<string>('case_digest');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailEntry, setDetailEntry] = useState<GoldenSetEntry | null>(null);
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; id: string }>({
    open: false,
    id: '',
  });
  const [rejectNotes, setRejectNotes] = useState('');

  const { data: stats, isLoading: statsLoading } = useGoldenSetStats();
  const { data: listData, isLoading: listLoading } = useGoldenSets({
    type: activeTab,
    page,
    limit: 50,
  });

  const approveMutation = useApproveGoldenSet();
  const rejectMutation = useRejectGoldenSet();
  const bulkApproveMutation = useBulkApproveGoldenSets();
  const deleteMutation = useDeleteGoldenSet();
  const generateDigestsMutation = useGenerateDraftDigests();
  const generateClassificationsMutation = useGenerateDraftClassifications();
  const sampleMcqMutation = useSampleMcqGoldenSet();

  const entries = listData?.entries ?? [];
  const total = listData?.total ?? 0;

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setPage(1);
    setSelected(new Set());
    setDetailEntry(null);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.id)));
    }
  };

  const handleBulkApprove = () => {
    bulkApproveMutation.mutate([...selected], {
      onSuccess: () => setSelected(new Set()),
    });
  };

  const handleReject = () => {
    rejectMutation.mutate(
      { id: rejectDialog.id, notes: rejectNotes },
      {
        onSuccess: () => {
          setRejectDialog({ open: false, id: '' });
          setRejectNotes('');
        },
      },
    );
  };

  const handleGenerate = () => {
    if (activeTab === 'case_digest') generateDigestsMutation.mutate(20);
    else if (activeTab === 'subject_classification') generateClassificationsMutation.mutate(100);
    else sampleMcqMutation.mutate(50);
  };

  const isGenerating =
    generateDigestsMutation.isPending ||
    generateClassificationsMutation.isPending ||
    sampleMcqMutation.isPending;

  const currentStats = stats
    ? activeTab === 'case_digest'
      ? stats.caseDigest
      : activeTab === 'subject_classification'
        ? stats.subjectClassification
        : stats.mcqQuestion
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="text-2xl font-bold">Golden Sets</h1>
        </div>
        <Button onClick={handleGenerate} disabled={isGenerating}>
          <Sparkles className="mr-2 size-4" />
          {isGenerating ? 'Generating...' : 'Generate Drafts'}
        </Button>
      </div>

      {/* Stats Cards */}
      {statsLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Loading...</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-8 w-16 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-3 gap-4">
          <StatsCard
            label="Case Digests"
            stats={stats.caseDigest}
            active={activeTab === 'case_digest'}
          />
          <StatsCard
            label="Subject Classification"
            stats={stats.subjectClassification}
            active={activeTab === 'subject_classification'}
          />
          <StatsCard
            label="MCQ Questions"
            stats={stats.mcqQuestion}
            active={activeTab === 'mcq_question'}
          />
        </div>
      ) : null}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="flex items-center justify-between">
          <TabsList>
            {TAB_TYPES.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {selected.size > 0 && (
            <Button
              size="sm"
              onClick={handleBulkApprove}
              disabled={bulkApproveMutation.isPending}
            >
              <CheckCircle className="mr-2 size-4" />
              {bulkApproveMutation.isPending
                ? 'Approving...'
                : `Approve ${selected.size} Selected`}
            </Button>
          )}
        </div>

        {TAB_TYPES.map((tab) => (
          <TabsContent key={tab.value} value={tab.value}>
            {listLoading ? (
              <AdminListSkeleton count={5} />
            ) : entries.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <p className="text-muted-foreground">
                    No golden set entries for {tab.label}. Click &ldquo;Generate Drafts&rdquo; to
                    create AI-drafted entries.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10">
                          <input
                            type="checkbox"
                            checked={selected.size === entries.length && entries.length > 0}
                            onChange={toggleSelectAll}
                            className="size-4"
                          />
                        </TableHead>
                        <TableHead>Source Document</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Reviewed By</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((entry) => (
                        <TableRow
                          key={entry.id}
                          className="cursor-pointer"
                          onClick={() => setDetailEntry(entry)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected.has(entry.id)}
                              onChange={() => toggleSelect(entry.id)}
                              className="size-4"
                            />
                          </TableCell>
                          <TableCell className="max-w-xs truncate font-medium">
                            {entry.sourceDocument?.title ?? entry.sourceDocument?.citationText ?? entry.id.slice(0, 8)}
                          </TableCell>
                          <TableCell>
                            <Badge className={STATUS_VARIANTS[entry.status] ?? ''}>
                              {entry.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {entry.reviewedByUser?.fullName ?? '—'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleDateString()}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1">
                              {entry.status !== 'approved' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => approveMutation.mutate({ id: entry.id })}
                                  disabled={approveMutation.isPending}
                                  title="Approve"
                                >
                                  <CheckCircle className="size-4 text-green-600" />
                                </Button>
                              )}
                              {entry.status !== 'rejected' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() =>
                                    setRejectDialog({ open: true, id: entry.id })
                                  }
                                  title="Reject"
                                >
                                  <XCircle className="size-4 text-red-600" />
                                </Button>
                              )}
                              {entry.status === 'draft' && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => deleteMutation.mutate(entry.id)}
                                  disabled={deleteMutation.isPending}
                                  title="Delete"
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDetailEntry(entry)}
                                title="View details"
                              >
                                <ChevronRight className="size-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* Pagination */}
                <div className="flex items-center justify-between pt-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {entries.length} of {total} entries
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={entries.length < 50}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Detail Panel */}
      {detailEntry && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Entry Detail</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => setDetailEntry(null)}>
              Close
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-muted-foreground">ID:</span>{' '}
                <span className="font-mono text-xs">{detailEntry.id}</span>
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Type:</span>{' '}
                {detailEntry.goldenSetType}
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Status:</span>{' '}
                <Badge className={STATUS_VARIANTS[detailEntry.status] ?? ''}>
                  {detailEntry.status}
                </Badge>
              </div>
              <div>
                <span className="font-medium text-muted-foreground">Source:</span>{' '}
                {detailEntry.sourceDocument?.title ?? '—'}
              </div>
              {detailEntry.reviewedByUser && (
                <div>
                  <span className="font-medium text-muted-foreground">Reviewed by:</span>{' '}
                  {detailEntry.reviewedByUser.fullName}
                </div>
              )}
              {detailEntry.reviewedAt && (
                <div>
                  <span className="font-medium text-muted-foreground">Reviewed at:</span>{' '}
                  {new Date(detailEntry.reviewedAt).toLocaleString()}
                </div>
              )}
              {detailEntry.reviewNotes && (
                <div className="col-span-2">
                  <span className="font-medium text-muted-foreground">Notes:</span>{' '}
                  {detailEntry.reviewNotes}
                </div>
              )}
            </div>
            <div>
              <span className="text-sm font-medium text-muted-foreground">Reference Data:</span>
              <pre className="mt-1 max-h-64 overflow-auto rounded bg-muted p-3 text-xs">
                {JSON.stringify(detailEntry.referenceDataJson, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reject Dialog */}
      <Dialog
        open={rejectDialog.open}
        onOpenChange={(open) => setRejectDialog({ open, id: open ? rejectDialog.id : '' })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Entry</DialogTitle>
            <DialogDescription>Provide a reason for rejecting this golden set entry.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Notes</Label>
            <Input
              value={rejectNotes}
              onChange={(e) => setRejectNotes(e.target.value)}
              placeholder="Reason for rejection"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRejectDialog({ open: false, id: '' })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleReject}
              disabled={!rejectNotes || rejectMutation.isPending}
            >
              {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatsCard({
  label,
  stats,
  active,
}: {
  label: string;
  stats: { total: number; approved: number; pending: number };
  active: boolean;
}) {
  return (
    <Card className={active ? 'ring-2 ring-primary' : ''}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{stats.total}</div>
        <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
          <span className="text-green-600">{stats.approved} approved</span>
          <span className="text-yellow-600">{stats.pending} pending</span>
        </div>
      </CardContent>
    </Card>
  );
}
