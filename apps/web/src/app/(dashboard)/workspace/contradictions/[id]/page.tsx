'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  useContradiction,
  useDeleteContradiction,
} from '@/features/contradictions/hooks/use-contradictions';
import {
  CONTRADICTION_STATUS_COLORS,
  CONTRADICTION_STATUS_LABELS,
  SEVERITY_COLORS,
  SEVERITY_LABELS,
  SCOPE_LABELS,
} from '@/features/contradictions/types';
import type { ContradictionItem } from '@/features/contradictions/types';

export default function ContradictionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const reportId = params['id'] as string;

  const { data: report, isLoading, error } = useContradiction(reportId);
  const deleteContradiction = useDeleteContradiction();

  const handleDelete = useCallback(() => {
    if (!report) return;
    if (
      window.confirm(
        'Are you sure you want to delete this report? This cannot be undone.',
      )
    ) {
      deleteContradiction.mutate(reportId, {
        onSuccess: () => router.push('/workspace/contradictions'),
      });
    }
  }, [report, reportId, deleteContradiction, router]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-8 w-96 animate-pulse rounded bg-gray-200" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="space-y-4">
        <Link
          href="/workspace/contradictions"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back to Contradictions
        </Link>
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Report not found.'}
        </div>
      </div>
    );
  }

  const statusLabel =
    CONTRADICTION_STATUS_LABELS[report.status] ?? report.status;
  const statusStyle =
    CONTRADICTION_STATUS_COLORS[report.status] ?? 'bg-gray-100 text-gray-600';
  const scopeLabel = SCOPE_LABELS[report.scope] ?? report.scope;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500">
        <Link
          href="/workspace/contradictions"
          className="hover:text-gray-700"
        >
          Contradictions
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">
          {report.topic ? `Analysis: ${report.topic}` : 'Contradiction Report'}
        </span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            {report.topic
              ? `Contradictions: ${report.topic}`
              : `Contradiction Analysis`}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
              {report.documentIds.length} document
              {report.documentIds.length !== 1 ? 's' : ''}
            </span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
              {scopeLabel}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs capitalize ${statusStyle}`}
            >
              {statusLabel}
            </span>
            <span>
              {new Date(report.createdAt).toLocaleDateString('en-PH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleteContradiction.isPending}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {deleteContradiction.isPending ? 'Deleting...' : 'Delete'}
        </button>
      </div>

      {/* Generating state */}
      {(report.status === 'pending' || report.status === 'generating') && (
        <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 p-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-800">
              {report.status === 'pending'
                ? 'Analysis queued for processing...'
                : 'Analyzing documents for contradictions...'}
            </p>
            <p className="mt-0.5 text-xs text-blue-600">
              This may take up to 30 seconds. The page will update
              automatically.
            </p>
          </div>
        </div>
      )}

      {/* Failed state */}
      {report.status === 'failed' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Contradiction analysis failed
          </p>
          <p className="mt-0.5 text-xs text-red-600">
            The AI was unable to analyze these documents. Please try again with
            different documents.
          </p>
        </div>
      )}

      {/* Completed - Results */}
      {report.status === 'completed' && report.resultJson && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="rounded-md border border-gray-300 bg-gray-50 p-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
              Summary
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-800">
              {report.resultJson.summary}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              {report.resultJson.documentsAnalyzed} documents analyzed
              {' · '}
              {report.resultJson.contradictions.length} contradiction
              {report.resultJson.contradictions.length !== 1 ? 's' : ''} found
            </p>
          </div>

          {/* Contradiction Items */}
          {report.resultJson.contradictions.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed p-8 text-center">
              <p className="text-sm font-medium text-gray-900">
                No contradictions found
              </p>
              <p className="mt-1 text-sm text-gray-500">
                The analyzed documents appear to be consistent with each other.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Contradictions ({report.resultJson.contradictions.length})
              </h2>
              {report.resultJson.contradictions.map((item, index) => (
                <ContradictionCard key={index} item={item} index={index} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContradictionCard({
  item,
  index,
}: {
  item: ContradictionItem;
  index: number;
}) {
  const severityLabel = SEVERITY_LABELS[item.severity] ?? item.severity;
  const severityStyle =
    SEVERITY_COLORS[item.severity] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="rounded-md border p-4">
      {/* Contradiction header */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">
          {index + 1}. {item.description}
        </h3>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${severityStyle}`}
        >
          {severityLabel}
        </span>
      </div>

      {item.doctrineArea && (
        <p className="mt-1 text-xs text-gray-500">
          Doctrine area: {item.doctrineArea}
        </p>
      )}

      {/* Side-by-side passages */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border bg-gray-50 p-3">
          <p className="text-xs font-semibold text-gray-600">
            {item.documentATitle.length > 60
              ? item.documentATitle.slice(0, 60) + '...'
              : item.documentATitle}
          </p>
          <Link
            href={`/reader/${item.documentAId}`}
            className="text-xs text-blue-600 hover:underline"
          >
            View document
          </Link>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
            &ldquo;{item.documentAPassage}&rdquo;
          </p>
        </div>

        <div className="rounded-md border bg-gray-50 p-3">
          <p className="text-xs font-semibold text-gray-600">
            {item.documentBTitle.length > 60
              ? item.documentBTitle.slice(0, 60) + '...'
              : item.documentBTitle}
          </p>
          <Link
            href={`/reader/${item.documentBId}`}
            className="text-xs text-blue-600 hover:underline"
          >
            View document
          </Link>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
            &ldquo;{item.documentBPassage}&rdquo;
          </p>
        </div>
      </div>
    </div>
  );
}
