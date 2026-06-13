'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  useContradictions,
  useGenerateContradiction,
} from '@/features/contradictions/hooks/use-contradictions';
import {
  CONTRADICTION_STATUS_COLORS,
  CONTRADICTION_STATUS_LABELS,
  SCOPE_LABELS,
} from '@/features/contradictions/types';
import type { ContradictionReportListItem } from '@/features/contradictions/types';

export default function ContradictionsPage() {
  const [status, setStatus] = useState('');
  const [scope, setScope] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);

  const { data, isLoading, error } = useContradictions({
    status: status || undefined,
    scope: scope || undefined,
  });

  const reports = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contradictions</h1>
          <p className="mt-1 text-sm text-gray-500">
            Detect contradictions and conflicts across legal authorities
          </p>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New Analysis
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="generating">Generating</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        >
          <option value="">All Scopes</option>
          <option value="selected">Selected Documents</option>
          <option value="topic_based">Topic-Based</option>
        </select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border bg-gray-100"
            />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          Failed to load contradiction reports:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && reports.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-sm font-medium text-gray-900">
            No contradiction reports yet
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Analyze legal documents to find contradictions, conflicts, and
            inconsistencies across authorities.
          </p>
          <button
            onClick={() => setShowGenerate(true)}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Run Analysis
          </button>
        </div>
      )}

      {/* Report list */}
      {!isLoading && reports.length > 0 && (
        <div className="space-y-3">
          {reports.map((report) => (
            <ReportCard key={report.id} report={report} />
          ))}
        </div>
      )}

      {/* Generate dialog */}
      {showGenerate && (
        <GenerateContradictionDialog onClose={() => setShowGenerate(false)} />
      )}
    </div>
  );
}

function ReportCard({ report }: { report: ContradictionReportListItem }) {
  const statusLabel =
    CONTRADICTION_STATUS_LABELS[report.status] ?? report.status;
  const statusStyle =
    CONTRADICTION_STATUS_COLORS[report.status] ?? 'bg-gray-100 text-gray-600';
  const scopeLabel = SCOPE_LABELS[report.scope] ?? report.scope;

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/workspace/contradictions/${report.id}`}
            className="text-sm font-semibold text-gray-900 hover:text-gray-700"
          >
            {report.topic
              ? `Contradictions: ${report.topic}`
              : `Contradiction Analysis`}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded bg-gray-100 px-1.5 py-0.5">
              {report.documentIds.length} document
              {report.documentIds.length !== 1 ? 's' : ''}
            </span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5">
              {scopeLabel}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 capitalize ${statusStyle}`}
            >
              {statusLabel}
            </span>
            <span>
              {new Date(report.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        {report.status === 'generating' && (
          <div className="flex items-center gap-1.5 text-xs text-blue-600">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            Analyzing...
          </div>
        )}
      </div>
    </div>
  );
}

function GenerateContradictionDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const [documentIdInput, setDocumentIdInput] = useState('');
  const [scope, setScope] = useState('selected');
  const [topic, setTopic] = useState('');

  const generateMutation = useGenerateContradiction();

  const handleSubmit = () => {
    const documentIds = documentIdInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (documentIds.length < 2) return;

    generateMutation.mutate(
      {
        documentIds,
        scope,
        topic: scope === 'topic_based' ? topic : undefined,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold">New Contradiction Analysis</h2>
        <p className="mt-1 text-sm text-gray-500">
          Select documents to check for contradictions across authorities.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Document IDs (comma-separated, minimum 2)
            </label>
            <textarea
              value={documentIdInput}
              onChange={(e) => setDocumentIdInput(e.target.value)}
              placeholder="Enter document UUIDs separated by commas"
              rows={3}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Scope
            </label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            >
              <option value="selected">Selected Documents</option>
              <option value="topic_based">Topic-Based</option>
            </select>
          </div>

          {scope === 'topic_based' && (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Topic Focus
              </label>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., constructive dismissal, due process"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              />
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={
              generateMutation.isPending ||
              documentIdInput.split(',').filter(Boolean).length < 2
            }
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {generateMutation.isPending ? 'Analyzing...' : 'Run Analysis'}
          </button>
        </div>
      </div>
    </div>
  );
}
