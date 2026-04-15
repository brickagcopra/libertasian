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
  useSoftDeleteArtifact,
  useJobDigest,
} from '@/features/admin/hooks/use-derivatives-admin';
import type { DerivativeTypeStats, DerivativeJob, AdminDigestDetail } from '@/features/admin/types';
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
  const softDelete = useSoftDeleteArtifact();

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
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

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
            onDelete={(id: string) => { setDeleteConfirmId(id); setDeleteConfirmText(''); }}
          />
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-red-600">Delete Artifact</h3>
            <p className="mt-2 text-sm text-gray-600">
              Type &quot;delete&quot; to confirm soft-deletion of this artifact.
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder='Type "delete"'
              className="mt-2 w-full rounded border-gray-300 text-sm"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  softDelete.mutate(deleteConfirmId);
                  setDeleteConfirmId(null);
                }}
                disabled={deleteConfirmText !== 'delete'}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Delete
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

function DigestSection({ heading, content }: { heading: string; content: string | null | undefined }) {
  if (!content) return null;
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700">{heading}</h4>
      <p className="mt-1 text-sm text-gray-800" style={{ whiteSpace: 'pre-line' }}>{content}</p>
    </div>
  );
}

function DigestContentPanel({ digest }: { digest: AdminDigestDetail }) {
  const citedAuthorities = parseCitedAuthorities(digest.citedAuthoritiesJson);

  return (
    <div className="mt-4 space-y-4 border-t pt-4">
      <div>
        <h4 className="text-base font-semibold text-gray-900">{digest.title}</h4>
        {digest.legalDocument?.citationText && (
          <p className="text-xs text-gray-500">{digest.legalDocument.citationText}</p>
        )}
        <div className="mt-1 flex items-center gap-2">
          <span className="text-xs text-gray-500">
            Confidence: {digest.confidenceScore !== null ? `${(digest.confidenceScore * 100).toFixed(0)}%` : 'N/A'}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REVIEW_STATUS_COLORS[digest.reviewStatus] ?? 'bg-gray-100 text-gray-700'}`}>
            {digest.reviewStatus}
          </span>
        </div>
      </div>

      <DigestSection heading="Summary" content={digest.summary} />
      <DigestSection heading="Facts" content={digest.facts} />
      <DigestSection heading="Petitioner Arguments" content={digest.petitionerArguments} />
      <DigestSection heading="Respondent Arguments" content={digest.respondentArguments} />
      <DigestSection heading="Issues" content={digest.issues} />
      <DigestSection heading="Ruling" content={digest.ruling} />
      <DigestSection heading="Doctrine" content={digest.doctrine} />

      {digest.dispositive && (
        <div className="rounded border border-blue-200 bg-blue-50 p-3">
          <h4 className="text-sm font-semibold text-blue-800">Dispositive</h4>
          <p className="mt-1 text-sm text-blue-900" style={{ whiteSpace: 'pre-line' }}>{digest.dispositive}</p>
        </div>
      )}

      {citedAuthorities.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700">Cited Authorities</h4>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-gray-800">
            {citedAuthorities.map((cite, i) => (
              <li key={i}>{cite}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="pt-2">
        <Link
          href={`/admin/digests/${digest.id}`}
          className="text-xs font-medium text-blue-600 hover:text-blue-800"
        >
          View full digest &rarr;
        </Link>
      </div>
    </div>
  );
}

function parseCitedAuthorities(json: unknown): string[] {
  if (!json) return [];
  try {
    const arr = Array.isArray(json) ? json : [];
    return arr
      .map((item: unknown) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'citationText' in item) {
          return String((item as { citationText: string }).citationText);
        }
        return null;
      })
      .filter((s): s is string => s !== null);
  } catch {
    return [];
  }
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
  const { data: digestData, isLoading: digestLoading, error: digestError } = useJobDigest(
    job?.id ?? '',
    { enabled: shouldFetchDigest },
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
            <DigestContentPanel digest={digestData.digest} />
          )}
        </>
      )}
    </div>
  );
}
