'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useComparisons } from '@/features/case-comparisons/hooks/use-case-comparisons';
import { useMatters } from '@/features/workspace/hooks/use-matters';
import { GenerateComparisonDialog } from '@/features/case-comparisons/components/generate-comparison-dialog';
import {
  COMPARISON_TYPE_LABELS,
  COMPARISON_STATUS_COLORS,
} from '@/features/case-comparisons/types';
import type { CaseComparisonListItem } from '@/features/case-comparisons/types';

export default function ComparisonsPage() {
  const [comparisonType, setComparisonType] = useState('');
  const [status, setStatus] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);

  const { data, isLoading, error } = useComparisons({
    comparisonType: comparisonType || undefined,
    status: status || undefined,
  });

  const { data: mattersData } = useMatters({ limit: 100 });
  const matters = (mattersData?.data ?? []).map((m) => ({
    id: m.id,
    title: m.title,
  }));

  const comparisons = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Case Comparisons</h1>
          <p className="mt-1 text-sm text-gray-500">
            Compare legal cases side-by-side across facts, doctrine, and rulings
          </p>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New Comparison
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={comparisonType}
          onChange={(e) => setComparisonType(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        >
          <option value="">All Types</option>
          {Object.entries(COMPARISON_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
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
          Failed to load comparisons:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && comparisons.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-sm font-medium text-gray-900">
            No comparisons yet
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Compare two or more cases to analyze their similarities and
            differences.
          </p>
          <button
            onClick={() => setShowGenerate(true)}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Compare Cases
          </button>
        </div>
      )}

      {/* Comparison list */}
      {!isLoading && comparisons.length > 0 && (
        <div className="space-y-3">
          {comparisons.map((comparison) => (
            <ComparisonCard key={comparison.id} comparison={comparison} />
          ))}
        </div>
      )}

      {/* Generate dialog */}
      <GenerateComparisonDialog
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        matters={matters}
      />
    </div>
  );
}

function ComparisonCard({
  comparison,
}: {
  comparison: CaseComparisonListItem;
}) {
  const typeLabel =
    COMPARISON_TYPE_LABELS[comparison.comparisonType] ??
    comparison.comparisonType;
  const statusStyle =
    COMPARISON_STATUS_COLORS[comparison.status] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/workspace/comparisons/${comparison.id}`}
            className="text-sm font-semibold text-gray-900 hover:text-gray-700"
          >
            {typeLabel} — {comparison.documentIds.length} documents
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded bg-gray-100 px-1.5 py-0.5">
              {typeLabel}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 capitalize ${statusStyle}`}
            >
              {comparison.status}
            </span>
            <span>
              {new Date(comparison.createdAt).toLocaleDateString()}
            </span>
          </div>
          {comparison.matter && (
            <p className="mt-1 text-xs text-gray-500">
              Matter: {comparison.matter.title}
            </p>
          )}
        </div>
        {comparison.status === 'generating' && (
          <div className="flex items-center gap-1.5 text-xs text-blue-600">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            Generating...
          </div>
        )}
      </div>
    </div>
  );
}
