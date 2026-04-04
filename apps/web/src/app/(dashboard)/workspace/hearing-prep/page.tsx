'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useHearingPreps } from '@/features/hearing-prep/hooks/use-hearing-prep';
import { useMatters } from '@/features/workspace/hooks/use-matters';
import { GenerateHearingPrepDialog } from '@/features/hearing-prep/components/generate-hearing-prep-dialog';
import {
  HEARING_PREP_STATUS_COLORS,
  HEARING_PREP_STATUS_LABELS,
} from '@/features/hearing-prep/types';
import type { HearingPrepListItem } from '@/features/hearing-prep/types';

export default function HearingPrepPage() {
  const [status, setStatus] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);

  const { data, isLoading, error } = useHearingPreps({
    status: status || undefined,
  });

  const { data: mattersData } = useMatters({ limit: 100 });
  const matters = (mattersData?.data ?? []).map((m) => ({
    id: m.id,
    title: m.title,
  }));

  const packs = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Hearing Prep</h1>
          <p className="mt-1 text-sm text-gray-500">
            Generate hearing preparation packs with relevant cases, provisions,
            arguments, and suggested questions
          </p>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New Prep Pack
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
          Failed to load hearing prep packs:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && packs.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-sm font-medium text-gray-900">
            No hearing prep packs yet
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Generate a preparation pack to compile cases, provisions, arguments,
            and questions for your next hearing.
          </p>
          <button
            onClick={() => setShowGenerate(true)}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Create Prep Pack
          </button>
        </div>
      )}

      {/* Pack list */}
      {!isLoading && packs.length > 0 && (
        <div className="space-y-3">
          {packs.map((pack) => (
            <HearingPrepCard key={pack.id} pack={pack} />
          ))}
        </div>
      )}

      {/* Generate dialog */}
      <GenerateHearingPrepDialog
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        matters={matters}
      />
    </div>
  );
}

function HearingPrepCard({ pack }: { pack: HearingPrepListItem }) {
  const statusLabel =
    HEARING_PREP_STATUS_LABELS[pack.status] ?? pack.status;
  const statusStyle =
    HEARING_PREP_STATUS_COLORS[pack.status] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/workspace/hearing-prep/${pack.id}`}
            className="text-sm font-semibold text-gray-900 hover:text-gray-700"
          >
            {pack.topic}
          </Link>
          {pack.issue && (
            <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">
              {pack.issue}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span
              className={`rounded px-1.5 py-0.5 capitalize ${statusStyle}`}
            >
              {statusLabel}
            </span>
            <span>
              {new Date(pack.createdAt).toLocaleDateString()}
            </span>
          </div>
          {pack.matter && (
            <p className="mt-1 text-xs text-gray-500">
              Matter: {pack.matter.title}
            </p>
          )}
        </div>
        {pack.status === 'generating' && (
          <div className="flex items-center gap-1.5 text-xs text-blue-600">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            Generating...
          </div>
        )}
      </div>
    </div>
  );
}
