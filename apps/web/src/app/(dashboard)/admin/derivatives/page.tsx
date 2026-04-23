'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, RefreshCwIcon, TrashIcon } from 'lucide-react';

import {
  useDerivativeStats,
  useDerivativeSettings,
  useUpdateDerivativeSettings,
  useDerivativeJobs,
  useEnqueueGeneration,
  useRetryDerivativeJob,
  useRegenerateArtifact,
  useDeleteJobOutput,
  useJobDigest,
  useJobDoctrines,
  useJobEssay,
  useJobMcqs,
} from '@/features/admin/hooks/use-derivatives-admin';
import type { DerivativeTypeStats, DerivativeJob, JobDoctrineItem, JobMcqItem } from '@/features/admin/types';
import { DigestContentPanel } from '@/features/digests/components/digest-content-panel';
import { EssayContentPanel } from '@/features/admin/components/essay-content-panel';
import { ArtifactReviewActions } from '@/features/admin/components/artifact-review-actions';
import { BulkApproveByConfidencePanel } from '@/features/admin/components/bulk-approve-by-confidence-panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AdminCardSkeleton } from '@/components/ui/skeleton';

const DERIVATIVE_TYPES = [
  'case_digest',
  'doctrine_extract',
  'mcq_question',
  'essay_prompt',
  'flashcard',
  'subject_outline',
] as const;

const TYPE_LABELS: Record<string, string> = {
  case_digest: 'Case Digest',
  doctrine_extract: 'Doctrine Extract',
  mcq_question: 'MCQ Question',
  essay_prompt: 'Essay Prompt',
  flashcard: 'Flashcard',
  subject_outline: 'Subject Outline',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  validating: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  skipped_budget: 'bg-yellow-100 text-yellow-800',
  skipped_disabled: 'bg-yellow-100 text-yellow-800',
};

export default function DerivativesAdminPage() {
  const { data: stats, isLoading: statsLoading } = useDerivativeStats();
  const { data: settings } = useDerivativeSettings();
  const updateSettings = useUpdateDerivativeSettings();
  const enqueue = useEnqueueGeneration();
  const retryJob = useRetryDerivativeJob();
  const regenerate = useRegenerateArtifact();
  const deleteOutput = useDeleteJobOutput();

  // Job list state
  const [jobFilterType, setJobFilterType] = useState<string>('');
  const [jobFilterStatus, setJobFilterStatus] = useState<string>('');
  const [jobPage, setJobPage] = useState(1);
  const { data: jobsData } = useDerivativeJobs({
    derivativeType: jobFilterType || undefined,
    status: jobFilterStatus || undefined,
    page: jobPage,
    limit: 20,
  });

  // Generation form state
  const [genType, setGenType] = useState<string>(DERIVATIVE_TYPES[0]);
  const [genDateFrom, setGenDateFrom] = useState('');
  const [genDateTo, setGenDateTo] = useState('');
  const [genCourt, setGenCourt] = useState('');
  const [genMaxCount, setGenMaxCount] = useState(50);
  const [genRegenerate, setGenRegenerate] = useState(false);
  const [showGenPanel, setShowGenPanel] = useState(false);

  // Settings state
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const [pendingTypes, setPendingTypes] = useState<Record<string, boolean> | null>(null);

  // Detail / confirm dialogs
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Link href="/admin" className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeftIcon className="h-4 w-4" /> Back to Admin
          </Link>
          <h1 className="text-2xl font-bold">Derivative Management</h1>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <AdminCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const globalEnabled = pendingEnabled ?? stats?.globalEnabled ?? false;
  const typesEnabled = pendingTypes ?? stats?.typesEnabled ?? {};

  const handleSaveSettings = () => {
    updateSettings.mutate({
      enabled: pendingEnabled ?? undefined,
      typesEnabled: pendingTypes ?? undefined,
    }, {
      onSuccess: () => {
        setPendingEnabled(null);
        setPendingTypes(null);
      },
    });
  };

  const handleEnqueue = () => {
    enqueue.mutate({
      derivativeType: genType,
      dateFrom: genDateFrom || undefined,
      dateTo: genDateTo || undefined,
      court: genCourt || undefined,
      maxCount: genMaxCount,
      regenerateExisting: genRegenerate,
    }, {
      onSuccess: () => setConfirmGenerate(false),
    });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link href="/admin" className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeftIcon className="h-4 w-4" /> Back to Admin
        </Link>
        <h1 className="text-2xl font-bold">Derivative Management</h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage derivative generation, per-type settings, and monitor jobs
        </p>
      </div>

      {/* Action message */}
      {actionMsg && (
        <Alert variant={actionMsg.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription className={actionMsg.type === 'success' ? 'text-green-700' : ''}>
            {actionMsg.text}
          </AlertDescription>
        </Alert>
      )}

      {/* Settings Card */}
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Generation Settings</h2>
        <div className="space-y-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={globalEnabled}
              onChange={(e) => setPendingEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium">
              Global generation enabled
            </span>
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${globalEnabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {globalEnabled ? 'ON' : 'OFF'}
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DERIVATIVE_TYPES.map((dt) => (
              <label key={dt} className="flex items-center gap-2 rounded border p-2">
                <input
                  type="checkbox"
                  checked={typesEnabled[dt] ?? true}
                  onChange={(e) =>
                    setPendingTypes({
                      ...typesEnabled,
                      [dt]: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm">{TYPE_LABELS[dt]}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${(typesEnabled[dt] ?? true) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {(typesEnabled[dt] ?? true) ? 'enabled' : 'disabled'}
                </span>
              </label>
            ))}
          </div>

          {(pendingEnabled !== null || pendingTypes !== null) && (
            <button
              onClick={handleSaveSettings}
              disabled={updateSettings.isPending}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats?.byType.map((s: DerivativeTypeStats) => {
          const hasFailed = s.failedJobs > 0;
          const isDisabled = !(typesEnabled[s.derivativeType] ?? true);

          return (
            <div
              key={s.derivativeType}
              className={`rounded-lg border p-4 shadow-sm ${isDisabled ? 'bg-gray-50 opacity-60' : hasFailed ? 'border-yellow-200 bg-yellow-50' : 'bg-white'}`}
            >
              <h3 className="text-sm font-semibold text-gray-700">
                {TYPE_LABELS[s.derivativeType] ?? s.derivativeType}
              </h3>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                <div>
                  <span className="block text-lg font-bold text-gray-900">{s.totalArtifacts}</span>
                  Artifacts
                </div>
                <div>
                  <span className="block text-lg font-bold text-gray-900">{s.pendingJobs}</span>
                  Pending
                </div>
                <div>
                  <span className={`block text-lg font-bold ${s.failedJobs > 0 ? 'text-red-600' : 'text-gray-900'}`}>{s.failedJobs}</span>
                  Failed
                </div>
                <div>
                  <span className="block text-lg font-bold text-gray-900">${s.spendThisMonth.toFixed(2)}</span>
                  Spend/mo
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Generation Panel */}
      <div className="rounded-lg border bg-white shadow-sm">
        <button
          onClick={() => setShowGenPanel(!showGenPanel)}
          className="flex w-full items-center justify-between p-4 text-left"
        >
          <h2 className="text-lg font-semibold">Generate Derivatives</h2>
          <span className="text-sm text-gray-500">{showGenPanel ? 'Collapse' : 'Expand'}</span>
        </button>
        {showGenPanel && (
          <div className="border-t p-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-sm font-medium text-gray-700">Derivative Type</label>
                <select
                  value={genType}
                  onChange={(e) => setGenType(e.target.value)}
                  className="mt-1 w-full rounded border-gray-300 text-sm"
                >
                  {DERIVATIVE_TYPES.filter((dt) => typesEnabled[dt] ?? true).map((dt) => (
                    <option key={dt} value={dt}>{TYPE_LABELS[dt]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Date From</label>
                <input
                  type="date"
                  value={genDateFrom}
                  onChange={(e) => setGenDateFrom(e.target.value)}
                  className="mt-1 w-full rounded border-gray-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Date To</label>
                <input
                  type="date"
                  value={genDateTo}
                  onChange={(e) => setGenDateTo(e.target.value)}
                  className="mt-1 w-full rounded border-gray-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Court</label>
                <input
                  type="text"
                  value={genCourt}
                  onChange={(e) => setGenCourt(e.target.value)}
                  placeholder="e.g. Supreme Court"
                  className="mt-1 w-full rounded border-gray-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Max Count</label>
                <input
                  type="number"
                  value={genMaxCount}
                  onChange={(e) => setGenMaxCount(Number(e.target.value))}
                  min={1}
                  max={1000}
                  className="mt-1 w-full rounded border-gray-300 text-sm"
                />
              </div>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={genRegenerate}
                onChange={(e) => setGenRegenerate(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm">Regenerate existing</span>
              {genRegenerate && (
                <span className="text-xs text-amber-600">
                  This will soft-delete existing artifacts and regenerate them. Cost will be incurred.
                </span>
              )}
            </label>

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmGenerate(true)}
                disabled={enqueue.isPending}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Start Generation
              </button>
              {enqueue.data && (
                <span className="self-center text-sm text-green-700">
                  Enqueued {enqueue.data.enqueuedCount} jobs (est. ${enqueue.data.estimatedCostUsd.toFixed(2)})
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirm Generation Dialog */}
      {confirmGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Confirm Generation</h3>
            <p className="mt-2 text-sm text-gray-600">
              This will enqueue up to {genMaxCount} {TYPE_LABELS[genType]} generation jobs.
              {genRegenerate && ' Existing artifacts will be soft-deleted.'}
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setConfirmGenerate(false)}
                className="rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleEnqueue}
                disabled={enqueue.isPending}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {enqueue.isPending ? 'Enqueuing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch approve by confidence */}
      <BulkApproveByConfidencePanel />

      {/* Job History Table */}
      <div className="rounded-lg border bg-white shadow-sm">
        <div className="border-b p-4">
          <h2 className="text-lg font-semibold">Job History</h2>
          <div className="mt-3 flex gap-3">
            <select
              value={jobFilterType}
              onChange={(e) => { setJobFilterType(e.target.value); setJobPage(1); }}
              className="rounded border-gray-300 text-sm"
            >
              <option value="">All Types</option>
              {DERIVATIVE_TYPES.map((dt) => (
                <option key={dt} value={dt}>{TYPE_LABELS[dt]}</option>
              ))}
            </select>
            <select
              value={jobFilterStatus}
              onChange={(e) => { setJobFilterStatus(e.target.value); setJobPage(1); }}
              className="rounded border-gray-300 text-sm"
            >
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="skipped_budget">Skipped (Budget)</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                <th className="px-4 py-2 font-medium">ID</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Source Doc</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Tokens</th>
                <th className="px-4 py-2 font-medium">Cost</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(jobsData?.data ?? []).map((job: DerivativeJob) => (
                <tr key={job.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{job.id.slice(0, 8)}</td>
                  <td className="px-4 py-2">{TYPE_LABELS[job.derivativeType] ?? job.derivativeType}</td>
                  <td className="px-4 py-2 max-w-[200px] truncate" title={job.sourceDocument?.title}>
                    {job.sourceDocument?.title ?? '-'}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[job.status] ?? 'bg-gray-100 text-gray-800'}`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {job.tokensIn + job.tokensOut > 0
                      ? `${job.tokensIn}/${job.tokensOut}`
                      : '-'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {Number(job.estimatedCostUsd) > 0
                      ? `$${Number(job.estimatedCostUsd).toFixed(4)}`
                      : '-'}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {new Date(job.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      {job.status === 'failed' && (
                        <button
                          onClick={() => retryJob.mutate(job.id)}
                          title="Retry"
                          className="rounded p-1 text-blue-600 hover:bg-blue-50"
                        >
                          <RefreshCwIcon className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedJobId(selectedJobId === job.id ? null : job.id)}
                        className="rounded p-1 text-gray-500 hover:bg-gray-100 text-xs"
                      >
                        Detail
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(jobsData?.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    No jobs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {(jobsData?.total ?? 0) > 20 && (
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-sm text-gray-500">
              Page {jobPage} of {Math.ceil((jobsData?.total ?? 0) / 20)}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setJobPage((p) => Math.max(1, p - 1))}
                disabled={jobPage <= 1}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => setJobPage((p) => p + 1)}
                disabled={jobPage * 20 >= (jobsData?.total ?? 0)}
                className="rounded border px-3 py-1 text-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Job Detail Panel */}
      {selectedJobId && (
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Job Detail: {selectedJobId.slice(0, 8)}...</h3>
            <button
              onClick={() => setSelectedJobId(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Close
            </button>
          </div>
          <JobDetailPanel
            job={(jobsData?.data ?? []).find((j: DerivativeJob) => j.id === selectedJobId)}
            onRetry={(id: string) => retryJob.mutate(id)}
            onRegenerate={(id: string) => regenerate.mutate(id)}
            onDelete={(id: string) => { setDeleteConfirmId(id); }}
          />
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-red-600">Delete Job Output</h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to delete this job&apos;s output?
              This action cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteOutput.mutate(deleteConfirmId, {
                    onSuccess: () => {
                      setDeleteConfirmId(null);
                      setActionMsg({ type: 'success', text: 'Output deleted successfully.' });
                    },
                    onError: (err) => {
                      setDeleteConfirmId(null);
                      setActionMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete' });
                    },
                  });
                }}
                disabled={deleteOutput.isPending}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteOutput.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

const REVIEW_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  ai_generated: 'bg-blue-100 text-blue-700',
  needs_human_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

// DigestContentPanel and parseCitedAuthorities are imported from
// @/features/digests/components/digest-content-panel

const DOCTRINE_TYPE_COLORS: Record<string, string> = {
  rule: 'bg-blue-100 text-blue-700',
  test: 'bg-purple-100 text-purple-700',
  definition: 'bg-teal-100 text-teal-700',
  exception: 'bg-orange-100 text-orange-700',
  procedural: 'bg-gray-100 text-gray-700',
};

function DoctrineExtractsPanel({ doctrines }: { doctrines: JobDoctrineItem[] }) {
  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <h4 className="text-base font-semibold text-gray-900">
        Extracted Doctrines ({doctrines.length})
      </h4>
      {doctrines.map((d) => (
        <div key={d.id} className="rounded border bg-gray-50 p-3">
          <div className="flex items-center gap-2">
            {d.doctrineType && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DOCTRINE_TYPE_COLORS[d.doctrineType] ?? 'bg-gray-100 text-gray-700'}`}>
                {d.doctrineType}
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REVIEW_STATUS_COLORS[d.reviewStatus] ?? 'bg-gray-100 text-gray-700'}`}>
              {d.reviewStatus}
            </span>
            {d.confidence !== null && (
              <span className="text-xs text-gray-500">
                {(d.confidence * 100).toFixed(0)}% confidence
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-gray-800" style={{ whiteSpace: 'pre-line' }}>
            {d.text.length > 300 ? `${d.text.slice(0, 300)}...` : d.text}
          </p>
          <Link
            href={`/admin/doctrines/${d.id}`}
            className="mt-1 inline-block text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            View full doctrine &rarr;
          </Link>
        </div>
      ))}
    </div>
  );
}

function JobDetailPanel({
  job,
  onRetry,
  onRegenerate,
  onDelete,
}: {
  job?: DerivativeJob;
  onRetry: (id: string) => void;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const shouldFetchDigest = !!job && job.status === 'completed' && job.derivativeType === 'case_digest';
  const shouldFetchDoctrines = !!job && job.status === 'completed' && job.derivativeType === 'doctrine_extract';
  const shouldFetchEssay = !!job && job.status === 'completed' && job.derivativeType === 'essay_prompt';
  const shouldFetchMcqs = !!job && job.status === 'completed' && job.derivativeType === 'mcq_question';
  const { data: digestData, isLoading: digestLoading, error: digestError } = useJobDigest(
    job?.id ?? '',
    { enabled: shouldFetchDigest },
  );
  const { data: doctrinesData, isLoading: doctrinesLoading, error: doctrinesError } = useJobDoctrines(
    job?.id ?? '',
    { enabled: shouldFetchDoctrines },
  );
  const { data: essayData, isLoading: essayLoading, error: essayError } = useJobEssay(
    job?.id ?? '',
    { enabled: shouldFetchEssay },
  );
  const { data: mcqsData, isLoading: mcqsLoading, error: mcqsError } = useJobMcqs(
    job?.id ?? '',
    { enabled: shouldFetchMcqs },
  );

  if (!job) return <p className="mt-2 text-sm text-gray-400">Job not found in current page</p>;

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div><span className="text-gray-500">Type:</span> {TYPE_LABELS[job.derivativeType]}</div>
        <div><span className="text-gray-500">Status:</span> {job.status}</div>
        <div><span className="text-gray-500">Model:</span> {job.modelName ?? '-'}</div>
        <div><span className="text-gray-500">Template:</span> {job.promptTemplateVersion ?? '-'}</div>
        <div><span className="text-gray-500">Tokens In:</span> {job.tokensIn}</div>
        <div><span className="text-gray-500">Tokens Out:</span> {job.tokensOut}</div>
        <div><span className="text-gray-500">Cost:</span> ${Number(job.estimatedCostUsd).toFixed(4)}</div>
        <div><span className="text-gray-500">Source Doc:</span> {job.sourceDocument?.title ?? '-'}</div>
        {job.startedAt && (
          <div><span className="text-gray-500">Started:</span> {new Date(job.startedAt).toLocaleString()}</div>
        )}
        {job.finishedAt && (
          <div><span className="text-gray-500">Finished:</span> {new Date(job.finishedAt).toLocaleString()}</div>
        )}
      </div>
      {job.errorJson && (
        <div className="rounded bg-red-50 p-3">
          <h4 className="text-xs font-medium text-red-700">Error</h4>
          <pre className="mt-1 max-h-40 overflow-auto text-xs text-red-600">
            {JSON.stringify(job.errorJson, null, 2)}
          </pre>
        </div>
      )}
      <div className="flex gap-2">
        {job.status === 'failed' && (
          <button
            onClick={() => onRetry(job.id)}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            Retry Job
          </button>
        )}
        <button
          onClick={() => onRegenerate(job.id)}
          className="rounded border px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <RefreshCwIcon className="mr-1 inline h-3 w-3" />
          Regenerate
        </button>
        <button
          onClick={() => onDelete(job.id)}
          className="rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          <TrashIcon className="mr-1 inline h-3 w-3" />
          Delete
        </button>
      </div>

      {/* Digest content section */}
      {shouldFetchDigest && (
        <>
          {digestLoading && (
            <p className="text-sm text-gray-400">Loading digest...</p>
          )}
          {digestError && (
            <p className="text-sm text-red-500">
              Error loading digest: {digestError instanceof Error ? digestError.message : 'Unknown error'}
            </p>
          )}
          {digestData && !digestData.digest && (
            <p className="text-sm text-amber-600">
              Generation completed but no digest artifact was written — investigate.
            </p>
          )}
          {digestData?.digest && (
            <div className="mt-4 border-t pt-4">
              <DigestContentPanel
                digest={digestData.digest}
                citedAuthoritiesJson={digestData.digest.citedAuthoritiesJson}
                detailHref={`/admin/digests/${digestData.digest.id}`}
              />
            </div>
          )}
        </>
      )}

      {/* Doctrine extracts section */}
      {shouldFetchDoctrines && (
        <>
          {doctrinesLoading && (
            <p className="text-sm text-gray-400">Loading doctrine extracts...</p>
          )}
          {doctrinesError && (
            <p className="text-sm text-red-500">
              Error loading doctrines: {doctrinesError instanceof Error ? doctrinesError.message : 'Unknown error'}
            </p>
          )}
          {doctrinesData && doctrinesData.doctrines.length === 0 && (
            <p className="text-sm text-amber-600">
              Generation completed but no doctrine extracts were written — investigate.
            </p>
          )}
          {doctrinesData && doctrinesData.doctrines.length > 0 && (
            <DoctrineExtractsPanel doctrines={doctrinesData.doctrines} />
          )}
        </>
      )}

      {/* Essay prompt section */}
      {shouldFetchEssay && (
        <>
          {essayLoading && (
            <p className="text-sm text-gray-400">Loading essay...</p>
          )}
          {essayError && (
            <p className="text-sm text-red-500">
              Error loading essay: {essayError instanceof Error ? essayError.message : 'Unknown error'}
            </p>
          )}
          {essayData && !essayData.essay && (
            <p className="text-sm text-amber-600">
              Generation completed but no essay artifact was written — investigate.
            </p>
          )}
          {essayData?.essay && (
            <div className="mt-4 space-y-3 border-t pt-4">
              <EssayContentPanel essay={essayData.essay} />
              <ArtifactReviewActions
                artifactId={essayData.essay.id}
                reviewStatus={essayData.essay.reviewStatus}
                visibility={essayData.essay.visibility}
                hasDisclaimer={!!essayData.essay.contentDisclaimer}
              />
            </div>
          )}
        </>
      )}

      {/* MCQ questions section */}
      {shouldFetchMcqs && (
        <>
          {mcqsLoading && (
            <p className="text-sm text-gray-400">Loading MCQs...</p>
          )}
          {mcqsError && (
            <p className="text-sm text-red-500">
              Error loading MCQs: {mcqsError instanceof Error ? mcqsError.message : 'Unknown error'}
            </p>
          )}
          {mcqsData && mcqsData.mcqs.length === 0 && (
            <p className="text-sm text-amber-600">
              Generation completed but no MCQ artifacts were written — investigate.
            </p>
          )}
          {mcqsData && mcqsData.mcqs.length > 0 && (
            <div className="mt-4 space-y-4 border-t pt-4">
              <h4 className="text-base font-semibold text-gray-900">
                MCQ Questions ({mcqsData.mcqs.length})
              </h4>
              {mcqsData.mcqs.map((m, idx) => (
                <McqReviewCard key={m.id} mcq={m} index={idx} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function McqReviewCard({ mcq, index }: { mcq: JobMcqItem; index: number }) {
  if (!mcq.mcqQuestion) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-amber-800">
            MCQ #{index + 1} — child row missing
          </span>
          <span className="font-mono text-xs text-amber-700">{mcq.id.slice(0, 8)}</span>
        </div>
        <p className="mt-1 text-xs text-amber-700">
          Artifact has no mcq_questions row. Cannot render stem or options — investigate data integrity.
        </p>
        <ArtifactReviewActions
          artifactId={mcq.id}
          reviewStatus={mcq.reviewStatus}
          visibility={mcq.visibility}
          hasDisclaimer={!!mcq.contentDisclaimer}
        />
      </div>
    );
  }

  const q = mcq.mcqQuestion;
  return (
    <div className="rounded-md border bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="font-semibold text-gray-700">MCQ #{index + 1}</span>
        <span className="font-mono">{mcq.id.slice(0, 8)}</span>
        <span className="rounded bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
          {q.difficulty}
        </span>
        <span className="rounded bg-gray-100 px-2 py-0.5 font-medium text-gray-700">
          {q.questionFormat}
        </span>
        {mcq.confidenceScore !== null && (
          <span>confidence: {(mcq.confidenceScore * 100).toFixed(0)}%</span>
        )}
      </div>

      <p className="text-sm font-medium text-gray-900" style={{ whiteSpace: 'pre-line' }}>
        {q.questionStem}
      </p>

      <ul className="mt-3 space-y-2">
        {q.options.map((opt) => (
          <li
            key={opt.optionLetter}
            className={`flex items-start gap-3 rounded border p-2 ${
              opt.isCorrect ? 'border-green-400 bg-green-50' : 'border-gray-200'
            }`}
          >
            <span
              className={`mt-0.5 inline-flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-semibold ${
                opt.isCorrect ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {opt.optionLetter}
            </span>
            <div className="flex-1">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm text-gray-800">{opt.text}</p>
                {opt.isCorrect && (
                  <span className="rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">
                    ✓ Correct answer
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {(q.explanation || q.options.some((o) => o.rationale)) && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-800">
            Show explanation & rationales
          </summary>
          <div className="mt-2 space-y-2 rounded bg-gray-50 p-3 text-xs">
            {q.explanation && (
              <div>
                <p className="font-semibold text-gray-700">Explanation</p>
                <p className="mt-1 text-gray-700" style={{ whiteSpace: 'pre-line' }}>
                  {q.explanation}
                </p>
              </div>
            )}
            {q.options.filter((o) => o.rationale).length > 0 && (
              <div>
                <p className="font-semibold text-gray-700">Rationales</p>
                <ul className="mt-1 space-y-1">
                  {q.options
                    .filter((o) => o.rationale)
                    .map((o) => (
                      <li key={o.optionLetter} className="text-gray-700">
                        <span className="font-semibold">{o.optionLetter}:</span> {o.rationale}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}

      <div className="mt-3">
        <ArtifactReviewActions
          artifactId={mcq.id}
          reviewStatus={mcq.reviewStatus}
          visibility={mcq.visibility}
          hasDisclaimer={!!mcq.contentDisclaimer}
        />
      </div>
    </div>
  );
}
