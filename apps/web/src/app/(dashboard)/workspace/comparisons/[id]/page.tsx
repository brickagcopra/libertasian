'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  useComparison,
  useDeleteComparison,
} from '@/features/case-comparisons/hooks/use-case-comparisons';
import {
  COMPARISON_TYPE_LABELS,
  COMPARISON_STATUS_COLORS,
} from '@/features/case-comparisons/types';
import type {
  ComparisonDimension,
  ComparisonDocumentSummary,
  CitationRef,
} from '@/features/case-comparisons/types';

export default function ComparisonDetailPage() {
  const params = useParams();
  const router = useRouter();
  const comparisonId = params['id'] as string;

  const { data: comparison, isLoading, error } = useComparison(comparisonId);
  const deleteComparison = useDeleteComparison();

  const handleDelete = useCallback(() => {
    if (!comparison) return;
    if (
      window.confirm(
        'Are you sure you want to delete this comparison? This cannot be undone.',
      )
    ) {
      deleteComparison.mutate(comparisonId, {
        onSuccess: () => router.push('/workspace/comparisons'),
      });
    }
  }, [comparison, comparisonId, deleteComparison, router]);

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

  if (error || !comparison) {
    return (
      <div className="space-y-4">
        <Link
          href="/workspace/comparisons"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back to Comparisons
        </Link>
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Comparison not found.'}
        </div>
      </div>
    );
  }

  const typeLabel =
    COMPARISON_TYPE_LABELS[comparison.comparisonType] ??
    comparison.comparisonType;
  const statusStyle =
    COMPARISON_STATUS_COLORS[comparison.status] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500">
        <Link href="/workspace/comparisons" className="hover:text-gray-700">
          Comparisons
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">{typeLabel}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            {typeLabel} — {comparison.documentIds.length} Documents
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
              {typeLabel}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs capitalize ${statusStyle}`}
            >
              {comparison.status}
            </span>
            <span>
              {new Date(comparison.createdAt).toLocaleDateString('en-PH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
          {comparison.matter && (
            <p className="mt-1 text-sm text-gray-500">
              Matter:{' '}
              <Link
                href={`/workspace/matters/${comparison.matter.id}`}
                className="text-gray-700 underline hover:text-gray-900"
              >
                {comparison.matter.title}
              </Link>
            </p>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleteComparison.isPending}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {deleteComparison.isPending ? 'Deleting...' : 'Delete'}
        </button>
      </div>

      {/* Generating state */}
      {(comparison.status === 'pending' ||
        comparison.status === 'generating') && (
        <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 p-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-800">
              {comparison.status === 'pending'
                ? 'Comparison queued for generation...'
                : 'Generating your comparison...'}
            </p>
            <p className="mt-0.5 text-xs text-blue-600">
              This may take up to 30 seconds. The page will update
              automatically.
            </p>
          </div>
        </div>
      )}

      {/* Failed state */}
      {comparison.status === 'failed' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Comparison generation failed
          </p>
          <p className="mt-0.5 text-xs text-red-600">
            The AI was unable to generate this comparison. Please try again
            with different documents.
          </p>
        </div>
      )}

      {/* Completed - Results */}
      {comparison.status === 'completed' && comparison.resultJson && (
        <div className="space-y-6">
          {/* Document Summary Cards */}
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
              Documents Compared
            </h2>
            <div className="mt-2 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {comparison.resultJson.documents.map((doc) => (
                <DocumentSummaryCard key={doc.documentId} doc={doc} />
              ))}
            </div>
          </div>

          {/* Dimension Comparisons */}
          {comparison.resultJson.dimensions.map((dimension, index) => (
            <DimensionCard
              key={index}
              dimension={dimension}
              documents={comparison.resultJson!.documents}
            />
          ))}

          {/* Overall Analysis */}
          {comparison.resultJson.overallAnalysis && (
            <div className="rounded-md border border-gray-300 bg-gray-50 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Overall Analysis
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                {comparison.resultJson.overallAnalysis}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocumentSummaryCard({ doc }: { doc: ComparisonDocumentSummary }) {
  return (
    <Link
      href={`/reader/${doc.documentId}`}
      className="block rounded-md border bg-white p-3 hover:bg-gray-50"
    >
      <p className="text-sm font-medium text-gray-900 line-clamp-2">
        {doc.title}
      </p>
      <div className="mt-1 space-y-0.5 text-xs text-gray-500">
        {doc.citationText && <p>{doc.citationText}</p>}
        {doc.court && <p>{doc.court}</p>}
        {doc.decisionDate && (
          <p>
            {new Date(doc.decisionDate).toLocaleDateString('en-PH', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        )}
      </div>
    </Link>
  );
}

function DimensionCard({
  dimension,
  documents,
}: {
  dimension: ComparisonDimension;
  documents: ComparisonDocumentSummary[];
}) {
  const docMap = new Map(documents.map((d) => [d.documentId, d]));

  return (
    <div className="rounded-md border p-4">
      <h2 className="text-base font-semibold text-gray-900">
        {dimension.dimension}
      </h2>

      {/* Side-by-side entries */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {dimension.entries.map((entry) => {
          const doc = docMap.get(entry.documentId);
          return (
            <div
              key={entry.documentId}
              className="rounded-md border bg-gray-50 p-3"
            >
              <p className="text-xs font-semibold text-gray-600">
                {doc?.title
                  ? doc.title.length > 60
                    ? doc.title.slice(0, 60) + '...'
                    : doc.title
                  : entry.documentId.slice(0, 8)}
              </p>
              {doc?.citationText && (
                <p className="text-xs text-gray-400">{doc.citationText}</p>
              )}
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {entry.content}
              </p>
              {entry.citations.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {entry.citations.map((c, i) => (
                    <CitationTag key={i} citation={c} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Analysis for this dimension */}
      {dimension.analysis && (
        <div className="mt-3 border-t pt-3">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
            Analysis
          </p>
          <p className="mt-1 text-sm leading-relaxed text-gray-700">
            {dimension.analysis}
          </p>
        </div>
      )}
    </div>
  );
}

function CitationTag({ citation }: { citation: CitationRef }) {
  if (citation.sourceId) {
    return (
      <Link
        href={`/reader/${citation.sourceId}`}
        className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 hover:underline"
        title={citation.text}
      >
        Source {citation.sourceId.slice(0, 8)}
      </Link>
    );
  }
  return (
    <span
      className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
      title={citation.text}
    >
      {citation.text.slice(0, 40)}
    </span>
  );
}
