'use client';

import Link from 'next/link';
import { useState } from 'react';

import { usePleadings } from '@/features/pleadings/hooks/use-pleadings';
import { useMatters } from '@/features/workspace/hooks/use-matters';
import { GeneratePleadingDialog } from '@/features/pleadings/components/generate-pleading-dialog';
import {
  PLEADING_CATEGORY_LABELS,
  PLEADING_STATUS_COLORS,
} from '@/features/pleadings/types';
import type { PleadingListItem } from '@/features/pleadings/types';
import { UpgradeBanner } from '@/components/paywall/upgrade-banner';
import { useCanAccessPaidFeature } from '@/hooks/useCanAccessPaidFeature';

export default function PleadingsPage() {
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);

  const { canAccess } = useCanAccessPaidFeature();

  const { data, isLoading, error } = usePleadings(
    {
      category: category || undefined,
      status: status || undefined,
    },
    { enabled: canAccess },
  );

  const { data: mattersData } = useMatters({ limit: 100 }, { enabled: canAccess });
  const matters = (mattersData?.data ?? []).map((m) => ({
    id: m.id,
    title: m.title,
  }));

  const pleadings = data?.data ?? [];

  if (!canAccess) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Pleading Assistance</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI-assisted pleading drafts with template-guided generation and
            citations
          </p>
        </div>
        <UpgradeBanner
          variant="modal"
          corpus="derivatives"
          surface="workspace/pleadings"
          message="Pleading templates are included on paid plans. Upgrade to draft pleadings from templates."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pleading Assistance</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI-assisted pleading drafts with template-guided generation and
            citations
          </p>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New Pleading
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        >
          <option value="">All Categories</option>
          {Object.entries(PLEADING_CATEGORY_LABELS).map(([value, label]) => (
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
          Failed to load pleadings:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && pleadings.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-sm font-medium text-gray-900">
            No pleadings yet
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Generate your first AI-assisted pleading from a template.
          </p>
          <button
            onClick={() => setShowGenerate(true)}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            New Pleading
          </button>
        </div>
      )}

      {/* Pleading list */}
      {!isLoading && pleadings.length > 0 && (
        <div className="space-y-3">
          {pleadings.map((pleading) => (
            <PleadingCard key={pleading.id} pleading={pleading} />
          ))}
        </div>
      )}

      {/* Generate dialog */}
      <GeneratePleadingDialog
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        matters={matters}
      />
    </div>
  );
}

function PleadingCard({ pleading }: { pleading: PleadingListItem }) {
  const categoryLabel =
    PLEADING_CATEGORY_LABELS[pleading.template.category] ??
    pleading.template.category;
  const statusStyle =
    PLEADING_STATUS_COLORS[pleading.status] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/workspace/pleadings/${pleading.id}`}
            className="text-sm font-semibold text-gray-900 hover:text-gray-700"
          >
            {pleading.template.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded bg-gray-100 px-1.5 py-0.5">
              {categoryLabel}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 capitalize ${statusStyle}`}
            >
              {pleading.status}
            </span>
            <span>
              {new Date(pleading.createdAt).toLocaleDateString()}
            </span>
          </div>
          {pleading.matter && (
            <p className="mt-1 text-xs text-gray-500">
              Matter: {pleading.matter.title}
            </p>
          )}
        </div>
        {pleading.status === 'generating' && (
          <div className="flex items-center gap-1.5 text-xs text-blue-600">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            Generating...
          </div>
        )}
      </div>
    </div>
  );
}
