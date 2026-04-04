'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { useMemo, useDeleteMemo } from '@/features/memos/hooks/use-memos';
import {
  MEMO_TYPE_LABELS,
  MEMO_STATUS_COLORS,
} from '@/features/memos/types';
import type { MemoSection } from '@/features/memos/types';
import { ExportButton } from '@/features/exports/components/export-button';

export default function MemoDetailPage() {
  const params = useParams();
  const router = useRouter();
  const memoId = params['id'] as string;

  const { data: memo, isLoading, error } = useMemo(memoId);
  const deleteMemo = useDeleteMemo();

  const handleDelete = useCallback(() => {
    if (!memo) return;
    if (
      window.confirm(
        'Are you sure you want to delete this memo? This cannot be undone.',
      )
    ) {
      deleteMemo.mutate(memoId, {
        onSuccess: () => router.push('/workspace/memos'),
      });
    }
  }, [memo, memoId, deleteMemo, router]);

  // Loading
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-8 w-96 animate-pulse rounded bg-gray-200" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  // Error
  if (error || !memo) {
    return (
      <div className="space-y-4">
        <Link
          href="/workspace/memos"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back to Memos
        </Link>
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Memo not found.'}
        </div>
      </div>
    );
  }

  const typeLabel = MEMO_TYPE_LABELS[memo.memoType] ?? memo.memoType;
  const statusStyle =
    MEMO_STATUS_COLORS[memo.status] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500">
        <Link href="/workspace/memos" className="hover:text-gray-700">
          Memos
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">{typeLabel}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            {memo.structuredOutput?.title ?? typeLabel}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
              {typeLabel}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs capitalize ${statusStyle}`}
            >
              {memo.status}
            </span>
            {memo.confidenceScore != null && (
              <ConfidenceBadge score={memo.confidenceScore} />
            )}
            <span>
              {new Date(memo.createdAt).toLocaleDateString('en-PH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
          {memo.matter && (
            <p className="mt-1 text-sm text-gray-500">
              Matter:{' '}
              <Link
                href={`/workspace/matters/${memo.matter.id}`}
                className="text-gray-700 underline hover:text-gray-900"
              >
                {memo.matter.title}
              </Link>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {memo.status === 'completed' && (
            <ExportButton contentType="memo" contentId={memoId} />
          )}
          <button
            onClick={handleDelete}
            disabled={deleteMemo.isPending}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {deleteMemo.isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Query */}
      <div className="rounded-md border bg-gray-50 p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400">
          Research Question
        </p>
        <p className="mt-1 text-sm text-gray-800">{memo.query}</p>
      </div>

      {/* Generating state */}
      {(memo.status === 'pending' || memo.status === 'generating') && (
        <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 p-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-800">
              {memo.status === 'pending'
                ? 'Memo queued for generation...'
                : 'Generating your memo...'}
            </p>
            <p className="mt-0.5 text-xs text-blue-600">
              This may take up to 30 seconds. The page will update
              automatically.
            </p>
          </div>
        </div>
      )}

      {/* Failed state */}
      {memo.status === 'failed' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Memo generation failed
          </p>
          <p className="mt-0.5 text-xs text-red-600">
            The AI was unable to generate this memo. Please try again with a
            different query.
          </p>
        </div>
      )}

      {/* Completed - Structured Output */}
      {memo.status === 'completed' && memo.structuredOutput && (
        <div className="space-y-6">
          {/* Summary */}
          {memo.structuredOutput.summary && (
            <div className="rounded-md border p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Summary
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-800">
                {memo.structuredOutput.summary}
              </p>
            </div>
          )}

          {/* Sections */}
          {memo.structuredOutput.sections.map((section, index) => (
            <MemoSectionCard key={index} section={section} index={index} />
          ))}

          {/* Conclusion */}
          {memo.structuredOutput.conclusion && (
            <div className="rounded-md border border-gray-300 bg-gray-50 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Conclusion
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-800">
                {memo.structuredOutput.conclusion}
              </p>
            </div>
          )}

          {/* Citations */}
          {memo.citationsJson && memo.citationsJson.length > 0 && (
            <div className="rounded-md border p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Sources ({memo.citationsJson.length})
              </h2>
              <ul className="mt-2 space-y-1">
                {memo.citationsJson.map((citation, i) => (
                  <li key={i} className="text-xs text-gray-600">
                    <span className="font-mono text-gray-400">
                      [{i + 1}]
                    </span>{' '}
                    {citation.text}
                    {citation.sourceId && (
                      <Link
                        href={`/reader/${citation.sourceId}`}
                        className="ml-1 text-blue-600 hover:underline"
                      >
                        View source
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MemoSectionCard({
  section,
  index,
}: {
  section: MemoSection;
  index: number;
}) {
  return (
    <div className="rounded-md border p-4">
      <h2 className="text-base font-semibold text-gray-900">
        {index + 1}. {section.heading}
      </h2>
      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
        {section.content}
      </div>
      {section.citations && section.citations.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <p className="text-xs font-medium text-gray-400">
            Citations in this section:
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {section.citations.map((c, i) => (
              <span
                key={i}
                className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700"
                title={c.text}
              >
                {c.sourceId ? (
                  <Link
                    href={`/reader/${c.sourceId}`}
                    className="hover:underline"
                  >
                    Source {c.sourceId.slice(0, 8)}
                  </Link>
                ) : (
                  c.text.slice(0, 40)
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  let color = 'bg-green-100 text-green-700';
  if (pct < 50) color = 'bg-red-100 text-red-700';
  else if (pct < 70) color = 'bg-yellow-100 text-yellow-700';

  return (
    <span className={`rounded px-2 py-0.5 text-xs ${color}`}>
      {pct}% confidence
    </span>
  );
}
