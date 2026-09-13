'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Sparkles } from 'lucide-react';

import {
  isJobActive,
  useApproveBarExamAnswer,
  useBarExamAnswerCoverage,
  useBarExamAnswerDetail,
  useBarExamAnswerGenerationJob,
  useBarExamAnswerGenerationJobs,
  useBarExamAnswers,
  useBulkReviewBarExamAnswers,
  useCancelGenerationJob,
  useDispatchAnswerGeneration,
  useInvalidateBarExamAnswerViews,
  useRejectBarExamAnswer,
  useRetryGenerationJobFailures,
  type BarExamAnswerRow,
  type BulkReviewResult,
  type ReviewStatusFilter,
} from '@/features/admin/hooks/use-admin-bar-exam-answers';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AdminCardSkeleton, AdminListSkeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

import { BulkApprovePanel, type BulkConfidenceFilter } from './bulk-approve-panel';
import { CoverageGrid } from './coverage-grid';
import {
  DispatchGenerationDialog,
  type DispatchFormValue,
  type DispatchPreview,
} from './dispatch-generation-dialog';
import { GenerationJobsPanel } from './generation-jobs-panel';

const STATUS_FILTERS: { value: ReviewStatusFilter; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];

export default function BarExamAnswersAdminPage() {
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>('pending');
  const [yearFilter, setYearFilter] = useState<number | undefined>(undefined);
  const [subjectFilter, setSubjectFilter] = useState<string | undefined>(
    undefined,
  );
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkConfirm, setBulkConfirm] = useState<'approve' | 'reject' | null>(
    null,
  );

  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchInitial, setDispatchInitial] = useState<DispatchFormValue>({});
  const [dispatchPreview, setDispatchPreview] = useState<DispatchPreview | null>(
    null,
  );
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [confidencePreview, setConfidencePreview] =
    useState<BulkReviewResult | null>(null);

  const queryParams = {
    // Always sent, 'all' included: 'all' is a real filter value meaning "no
    // status filter". Sending nothing lands on the API's 'pending' default,
    // which is exactly what made the All chip show only pending rows.
    reviewStatus: statusFilter,
    ...(yearFilter !== undefined ? { year: yearFilter } : {}),
    ...(subjectFilter ? { subjectCode: subjectFilter } : {}),
    ...(cursor ? { cursor } : {}),
  };
  const { data, isLoading, error } = useBarExamAnswers(queryParams);

  const coverage = useBarExamAnswerCoverage();
  const jobs = useBarExamAnswerGenerationJobs();
  const expandedJob = useBarExamAnswerGenerationJob(expandedJobId);
  const invalidateViews = useInvalidateBarExamAnswerViews();

  const dispatch = useDispatchAnswerGeneration();
  const cancelJob = useCancelGenerationJob();
  const retryJob = useRetryGenerationJobFailures();
  const bulkApprove = useBulkReviewBarExamAnswers('approve');
  const bulkReject = useBulkReviewBarExamAnswers('reject');

  // When a job stops being active, the corpus changed underneath the coverage
  // grid and the review queue. Refresh both once, on the transition.
  const previousActiveIds = useRef<string[]>([]);
  useEffect(() => {
    const activeIds = (jobs.data?.items ?? []).filter(isJobActive).map((j) => j.id);
    const finished = previousActiveIds.current.filter(
      (id) => !activeIds.includes(id),
    );
    if (finished.length > 0) invalidateViews();
    previousActiveIds.current = activeIds;
  }, [jobs.data, invalidateViews]);

  const rows = data?.items ?? [];
  const pageIds = rows.map((r) => r.id);
  const selectableIds = rows
    .filter((r) => r.reviewStatus === 'pending')
    .map((r) => r.id);
  const selectedOnPage = selectedIds.filter((id) => pageIds.includes(id));
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id));

  const toggleRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleAllOnPage = () => {
    setSelectedIds((prev) =>
      allSelected
        ? prev.filter((id) => !selectableIds.includes(id))
        : [...new Set([...prev, ...selectableIds])],
    );
  };

  const openDispatch = (initial: DispatchFormValue) => {
    setDispatchInitial(initial);
    setDispatchPreview(null);
    dispatch.reset();
    setDispatchOpen(true);
  };

  const handlePreview = (value: DispatchFormValue) => {
    dispatch.mutate(
      { ...value, dryRun: true },
      {
        onSuccess: (result) => {
          if (result.dryRun) {
            setDispatchPreview({
              total: result.total,
              byYearSubject: result.byYearSubject,
            });
          }
        },
      },
    );
  };

  const handleConfirmDispatch = (value: DispatchFormValue) => {
    dispatch.mutate(value, {
      onSuccess: () => {
        setDispatchOpen(false);
        setDispatchPreview(null);
      },
    });
  };

  const runBulkOnSelection = (action: 'approve' | 'reject') => {
    const mutation = action === 'approve' ? bulkApprove : bulkReject;
    mutation.mutate(
      { ids: selectedOnPage },
      {
        onSuccess: () => {
          setSelectedIds([]);
          setBulkConfirm(null);
        },
      },
    );
  };

  const handleConfidencePreview = (filter: BulkConfidenceFilter) => {
    bulkApprove.mutate(
      { filter, dryRun: true },
      { onSuccess: (result) => setConfidencePreview(result) },
    );
  };

  const handleConfidenceConfirm = (filter: BulkConfidenceFilter) => {
    bulkApprove.mutate(
      { filter },
      { onSuccess: () => setConfidencePreview(null) },
    );
  };

  const totalMissing = coverage.data?.totals.missing ?? 0;

  return (
    <div className="space-y-6 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bar Exam Answers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review AI-generated ALAC answers for past bar exam questions.
            Approved answers become eligible for public display (Phase 3b).
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => openDispatch({})}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            Generate answers
          </Button>
          <Button
            variant="outline"
            disabled={totalMissing === 0}
            onClick={() => openDispatch({ allMissing: true })}
          >
            Generate all missing ({totalMissing})
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/bar-exams">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Sittings
            </Link>
          </Button>
        </div>
      </div>

      {dispatch.isSuccess && dispatch.data && !dispatch.data.dryRun && (
        <Alert>
          <AlertDescription className="text-green-700">
            Queued {dispatch.data.total} question
            {dispatch.data.total === 1 ? '' : 's'} for generation (job{' '}
            <code className="text-xs">{dispatch.data.jobId}</code>). Progress
            appears below.
          </AlertDescription>
        </Alert>
      )}

      {coverage.isLoading ? (
        <AdminCardSkeleton />
      ) : coverage.data ? (
        <CoverageGrid
          coverage={coverage.data}
          onGenerateMissing={(cell) =>
            openDispatch({
              year: cell.year,
              subjectCode: cell.subjectCode ?? undefined,
            })
          }
          onReviewPending={(cell) => {
            setStatusFilter('pending');
            setYearFilter(cell.year);
            setSubjectFilter(cell.subjectCode ?? undefined);
            setCursor(undefined);
          }}
        />
      ) : null}

      <GenerationJobsPanel
        jobs={jobs.data?.items ?? []}
        expandedJobId={expandedJobId}
        expandedJob={expandedJob.data}
        isLoadingExpanded={expandedJob.isLoading}
        busyJobId={
          cancelJob.isPending || retryJob.isPending
            ? (cancelJob.variables ?? retryJob.variables ?? null)
            : null
        }
        onToggleExpand={(id) =>
          setExpandedJobId((prev) => (prev === id ? null : id))
        }
        onCancel={(id) => cancelJob.mutate(id)}
        onRetryFailed={(id) => retryJob.mutate(id)}
      />

      <BulkApprovePanel
        isChecking={bulkApprove.isPending && confidencePreview === null}
        isApplying={bulkApprove.isPending && confidencePreview !== null}
        preview={confidencePreview}
        errorMessage={
          bulkApprove.isError
            ? bulkApprove.error instanceof Error
              ? bulkApprove.error.message
              : 'Bulk approve failed'
            : null
        }
        onPreview={handleConfidencePreview}
        onConfirm={handleConfidenceConfirm}
        onResetPreview={() => setConfidencePreview(null)}
      />

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={statusFilter === f.value ? 'default' : 'outline'}
            onClick={() => {
              setStatusFilter(f.value);
              setCursor(undefined);
            }}
          >
            {f.label}
          </Button>
        ))}
        {(yearFilter !== undefined || subjectFilter) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setYearFilter(undefined);
              setSubjectFilter(undefined);
              setCursor(undefined);
            }}
          >
            Clear {yearFilter ?? ''} {subjectFilter ?? ''} filter
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load answers'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <AdminListSkeleton count={5} />
      ) : rows.length > 0 ? (
        <div className="space-y-3">
          {selectableIds.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="Select all pending answers on this page"
                checked={allSelected}
                onChange={toggleAllOnPage}
              />
              Select all pending on this page ({selectableIds.length})
            </label>
          )}

          {rows.map((row) => (
            <AnswerRow
              key={row.id}
              row={row}
              selected={selectedIds.includes(row.id)}
              onToggleSelect={() => toggleRow(row.id)}
              onView={() => setSelectedId(row.id)}
            />
          ))}

          {data?.meta.hasNext && data.meta.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setCursor(data.meta.nextCursor ?? undefined)}
              >
                Load More
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No answers in this view.
        </p>
      )}

      {selectedOnPage.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
            <span className="text-sm">
              {selectedOnPage.length} selected
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setSelectedIds([])}>
                Clear
              </Button>
              <Button onClick={() => setBulkConfirm('approve')}>
                Approve {selectedOnPage.length}
              </Button>
              <Button variant="outline" onClick={() => setBulkConfirm('reject')}>
                Reject {selectedOnPage.length}
              </Button>
            </div>
          </div>
        </div>
      )}

      {bulkConfirm && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm bulk review"
            className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg"
          >
            <h2 className="text-lg font-semibold">
              {bulkConfirm === 'approve' ? 'Approve' : 'Reject'}{' '}
              {selectedOnPage.length} answer
              {selectedOnPage.length === 1 ? '' : 's'}?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {bulkConfirm === 'approve'
                ? 'Approved answers become publicly visible editorial content.'
                : 'Rejected answers stay private.'}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBulkConfirm(null)}>
                Cancel
              </Button>
              <Button
                disabled={bulkApprove.isPending || bulkReject.isPending}
                onClick={() => runBulkOnSelection(bulkConfirm)}
              >
                Confirm
              </Button>
            </div>
          </div>
        </div>
      )}

      <DispatchGenerationDialog
        open={dispatchOpen}
        initialValue={dispatchInitial}
        isChecking={dispatch.isPending && dispatchPreview === null}
        isDispatching={dispatch.isPending && dispatchPreview !== null}
        preview={dispatchPreview}
        errorMessage={
          dispatch.isError
            ? dispatch.error instanceof Error
              ? dispatch.error.message
              : 'Dispatch failed'
            : null
        }
        onCancel={() => {
          setDispatchOpen(false);
          setDispatchPreview(null);
        }}
        onPreview={handlePreview}
        onConfirm={handleConfirmDispatch}
        onResetPreview={() => setDispatchPreview(null)}
      />

      <AnswerDetailDrawer id={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

// ---- Row ----

function AnswerRow({
  row,
  selected,
  onToggleSelect,
  onView,
}: {
  row: BarExamAnswerRow;
  selected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
}) {
  const approve = useApproveBarExamAnswer();
  const reject = useRejectBarExamAnswer();
  const isPending = row.reviewStatus === 'pending';

  const statusColor: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    approved: 'bg-green-100 text-green-800',
    rejected: 'bg-muted text-muted-foreground',
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {isPending && (
            <input
              type="checkbox"
              className="mt-1"
              aria-label={`Select answer for ${row.question.sittingYear} Q${row.question.questionNumber}`}
              checked={selected}
              onChange={onToggleSelect}
            />
          )}
          <button onClick={onView} className="flex-1 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={statusColor[row.reviewStatus] ?? ''}>
                {row.reviewStatus}
              </Badge>
              <Badge variant="outline">
                {row.question.sittingYear}
                {row.question.subjectStudyCode
                  ? ` · ${row.question.subjectStudyCode}`
                  : ''}
              </Badge>
              <Badge variant="outline">Q{row.question.questionNumber}</Badge>
              {row.confidence !== null ? (
                <Badge variant="outline">
                  conf {(row.confidence * 100).toFixed(0)}%
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  unscored
                </Badge>
              )}
              {row.modelRun && (
                <span className="text-xs text-muted-foreground">
                  {row.modelRun.modelName}
                </span>
              )}
            </div>
            <p className="mt-2 text-sm line-clamp-2">{row.question.excerpt}</p>
          </button>
        </div>

        {isPending && (
          <>
            <Separator className="my-3" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onView}>
                View
              </Button>
              <Button
                size="sm"
                onClick={() => approve.mutate(row.id)}
                disabled={approve.isPending}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => reject.mutate({ id: row.id })}
                disabled={reject.isPending}
              >
                Reject
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Detail drawer ----

function AnswerDetailDrawer({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useBarExamAnswerDetail(id);
  const approve = useApproveBarExamAnswer();
  const reject = useRejectBarExamAnswer();

  if (!id) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-background p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Answer detail</h2>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        {isLoading ? (
          <div className="mt-4">
            <AdminCardSkeleton />
          </div>
        ) : data ? (
          <div className="mt-4 space-y-5">
            <section>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Question — {data.question.sittingYear}{' '}
                {data.question.subjectStudyCode ?? ''} · Q
                {data.question.questionNumber}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {data.question.questionText}
              </p>
            </section>

            <Separator />

            <section className="space-y-3 text-sm">
              <AlacBlock label="Answer" body={data.structuredAnswerJson?.answer} />
              <AlacBlock label="Law" body={data.structuredAnswerJson?.law} />
              <AlacBlock
                label="Analysis"
                body={data.structuredAnswerJson?.analysis}
              />
              <AlacBlock
                label="Conclusion"
                body={data.structuredAnswerJson?.conclusion}
              />
            </section>

            {data.reviewStatus === 'pending' && (
              <div className="flex gap-2">
                <Button
                  onClick={() => approve.mutate(data.id, { onSuccess: onClose })}
                  disabled={approve.isPending}
                >
                  Approve
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    reject.mutate({ id: data.id }, { onSuccess: onClose })
                  }
                  disabled={reject.isPending}
                >
                  Reject
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Answer not found.</p>
        )}
      </div>
    </div>
  );
}

function AlacBlock({ label, body }: { label: string; body?: string }) {
  if (!body) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      <p className="mt-1 whitespace-pre-wrap">{body}</p>
    </div>
  );
}
