'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useMemos } from '@/features/memos/hooks/use-memos';
import { useMatters } from '@/features/workspace/hooks/use-matters';
import { GenerateMemoDialog } from '@/features/memos/components/generate-memo-dialog';
import {
  MEMO_TYPE_LABELS,
  MEMO_STATUS_COLORS,
} from '@/features/memos/types';
import { UpgradeBanner } from '@/components/paywall/upgrade-banner';
import { useCanAccessPaidFeature } from '@/hooks/useCanAccessPaidFeature';

export default function MemosPage() {
  const [memoType, setMemoType] = useState('');
  const [status, setStatus] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);

  const { canAccess } = useCanAccessPaidFeature();

  const { data, isLoading, error } = useMemos(
    {
      memoType: memoType || undefined,
      status: status || undefined,
    },
    { enabled: canAccess },
  );

  const { data: mattersData } = useMatters({ limit: 100 }, { enabled: canAccess });
  const matters = (mattersData?.data ?? []).map((m) => ({
    id: m.id,
    title: m.title,
  }));

  const memos = data?.data ?? [];

  if (!canAccess) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Legal Memos</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI-generated legal memos with structured citations
          </p>
        </div>
        <UpgradeBanner
          variant="modal"
          corpus="derivatives"
          surface="workspace/memos"
          message="Memo drafting is included on paid plans. Upgrade to draft AI-generated legal memos."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Legal Memos</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI-generated legal memos with structured citations
          </p>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New Memo
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={memoType}
          onChange={(e) => setMemoType(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        >
          <option value="">All Types</option>
          {Object.entries(MEMO_TYPE_LABELS).map(([value, label]) => (
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
          Failed to load memos:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && memos.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-sm font-medium text-gray-900">No memos yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Generate your first AI legal memo to get started.
          </p>
          <button
            onClick={() => setShowGenerate(true)}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Generate Memo
          </button>
        </div>
      )}

      {/* Memo list */}
      {!isLoading && memos.length > 0 && (
        <div className="space-y-3">
          {memos.map((memo) => (
            <MemoCard key={memo.id} memo={memo} />
          ))}
        </div>
      )}

      {/* Generate dialog */}
      <GenerateMemoDialog
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        matters={matters}
      />
    </div>
  );
}

function MemoCard({ memo }: { memo: { id: string; query: string; memoType: string; status: string; confidenceScore: number | null; createdAt: string; matter?: { id: string; title: string } | null } }) {
  const typeLabel = MEMO_TYPE_LABELS[memo.memoType] ?? memo.memoType;
  const statusStyle =
    MEMO_STATUS_COLORS[memo.status] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/workspace/memos/${memo.id}`}
            className="text-sm font-semibold text-gray-900 hover:text-gray-700"
          >
            {memo.query.length > 120
              ? memo.query.slice(0, 120) + '...'
              : memo.query}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded bg-gray-100 px-1.5 py-0.5">{typeLabel}</span>
            <span className={`rounded px-1.5 py-0.5 capitalize ${statusStyle}`}>
              {memo.status}
            </span>
            {memo.confidenceScore != null && (
              <span>
                Confidence: {Math.round(memo.confidenceScore * 100)}%
              </span>
            )}
            <span>{new Date(memo.createdAt).toLocaleDateString()}</span>
          </div>
          {memo.matter && (
            <p className="mt-1 text-xs text-gray-500">
              Matter: {memo.matter.title}
            </p>
          )}
        </div>
        {memo.status === 'generating' && (
          <div className="flex items-center gap-1.5 text-xs text-blue-600">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            Generating...
          </div>
        )}
      </div>
    </div>
  );
}
