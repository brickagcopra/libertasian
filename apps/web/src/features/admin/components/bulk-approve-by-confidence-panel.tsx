'use client';

import { useState } from 'react';

import { useBulkApproveByConfidence } from '@/features/admin/hooks/use-derivatives-admin';
import type { BulkApproveByConfidenceResult } from '@/features/admin/types';

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

export function BulkApproveByConfidencePanel() {
  const mutation = useBulkApproveByConfidence();

  const [threshold, setThreshold] = useState(0.7);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    ...DERIVATIVE_TYPES,
  ]);
  const [includeDigests, setIncludeDigests] = useState(true);
  const [preview, setPreview] = useState<BulkApproveByConfidenceResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const toggleType = (t: string) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
    setPreview(null);
  };

  const handlePreview = () => {
    const allTypes = selectedTypes.length === DERIVATIVE_TYPES.length;
    mutation.mutate(
      {
        threshold,
        derivativeTypes: allTypes ? undefined : selectedTypes,
        includeDigests,
        dryRun: true,
      },
      {
        onSuccess: (data) => {
          setPreview(data);
          setResultMsg(null);
        },
      },
    );
  };

  const handleApprove = () => {
    const allTypes = selectedTypes.length === DERIVATIVE_TYPES.length;
    mutation.mutate(
      {
        threshold,
        derivativeTypes: allTypes ? undefined : selectedTypes,
        includeDigests,
        dryRun: false,
      },
      {
        onSuccess: (data) => {
          setConfirmOpen(false);
          setPreview(null);
          setResultMsg(
            `Approved ${data.artifactsPromoted} artifact(s) and ${data.digestsPromoted} digest(s). ` +
              `${data.subjectsInherited} subject assignment(s) inherited. ` +
              (data.errors.length > 0 ? `${data.errors.length} error(s).` : 'No errors.'),
          );
        },
      },
    );
  };

  const totalToApprove = preview
    ? preview.artifactsPromoted + preview.digestsPromoted
    : 0;

  return (
    <div
      className="rounded-lg border bg-white shadow-sm"
      data-testid="bulk-approve-panel"
    >
      <div className="p-4">
        <h2 className="text-lg font-semibold">Batch approve by confidence</h2>
        <p className="mt-1 text-sm text-gray-500">
          Promote private artifacts (and optionally digests) with
          confidence_score &ge; threshold. Reuses the standard review
          pipeline — audit trail, visibility flip, and subject inheritance
          are all preserved.
        </p>
      </div>

      <div className="space-y-4 border-t p-4">
        {/* Threshold slider */}
        <div>
          <label
            htmlFor="bulk-threshold"
            className="flex items-baseline justify-between text-sm font-medium text-gray-700"
          >
            <span>Confidence threshold</span>
            <span className="font-mono text-base text-gray-900">
              {threshold.toFixed(2)}
            </span>
          </label>
          <input
            id="bulk-threshold"
            type="range"
            min={0.5}
            max={0.95}
            step={0.05}
            value={threshold}
            onChange={(e) => {
              setThreshold(Number(e.target.value));
              setPreview(null);
            }}
            className="mt-2 w-full"
            aria-label="Confidence threshold"
          />
          <div className="mt-1 flex justify-between text-xs text-gray-400">
            <span>0.50</span>
            <span>0.70 (recommended)</span>
            <span>0.95</span>
          </div>
        </div>

        {/* Type multi-select */}
        <div>
          <div className="text-sm font-medium text-gray-700">Derivative types</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {DERIVATIVE_TYPES.map((t) => (
              <label
                key={t}
                className="flex items-center gap-2 rounded border p-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={selectedTypes.includes(t)}
                  onChange={() => toggleType(t)}
                  className="h-4 w-4 rounded border-gray-300"
                  aria-label={`Include ${TYPE_LABELS[t]}`}
                />
                <span>{TYPE_LABELS[t]}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Include digests toggle */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeDigests}
            onChange={(e) => {
              setIncludeDigests(e.target.checked);
              setPreview(null);
            }}
            className="h-4 w-4 rounded border-gray-300"
          />
          <span>Include digests in the sweep</span>
        </label>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handlePreview}
            disabled={mutation.isPending || selectedTypes.length === 0}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {mutation.isPending && mutation.variables?.dryRun
              ? 'Previewing...'
              : 'Preview counts'}
          </button>
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={!preview || totalToApprove === 0 || mutation.isPending}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {preview
              ? `Approve ${totalToApprove} item${totalToApprove === 1 ? '' : 's'}`
              : 'Approve'}
          </button>
        </div>

        {/* Preview card */}
        {preview && preview.dryRun && (
          <div
            className="rounded border border-blue-200 bg-blue-50 p-3 text-sm"
            data-testid="bulk-approve-preview"
          >
            <div className="font-medium text-blue-900">
              Preview at threshold &ge; {threshold.toFixed(2)}
            </div>
            <div className="mt-1 text-blue-800">
              {preview.artifactsPromoted} artifact(s),{' '}
              {preview.digestsPromoted} digest(s) will be approved.
            </div>
            {preview.perTypeBreakdown.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-6 text-xs text-blue-800">
                {preview.perTypeBreakdown.map((row) => (
                  <li key={row.derivativeType}>
                    {TYPE_LABELS[row.derivativeType] ?? row.derivativeType}:{' '}
                    {row.count}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Success/error message */}
        {resultMsg && (
          <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            {resultMsg}
          </div>
        )}
        {mutation.error && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {mutation.error instanceof Error
              ? mutation.error.message
              : 'Failed to call bulk-approve endpoint.'}
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      {confirmOpen && preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Confirm batch approval</h3>
            <p className="mt-2 text-sm text-gray-600">
              This will approve {preview.artifactsPromoted} artifact(s) and{' '}
              {preview.digestsPromoted} digest(s) with confidence_score &ge;{' '}
              {threshold.toFixed(2)}. Private artifacts will become
              public_editorial and get subject inheritance fallback. This
              action is audited but not undoable.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={mutation.isPending}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {mutation.isPending ? 'Approving...' : 'Confirm approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
