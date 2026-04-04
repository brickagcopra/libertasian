'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useTimelines } from '@/features/timelines/hooks/use-timelines';
import { useMatters } from '@/features/workspace/hooks/use-matters';
import { GenerateTimelineDialog } from '@/features/timelines/components/generate-timeline-dialog';
import {
  TIMELINE_STATUS_COLORS,
  TIMELINE_STATUS_LABELS,
} from '@/features/timelines/types';
import type { CaseTimelineListItem } from '@/features/timelines/types';

export default function TimelinesPage() {
  const [status, setStatus] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);

  const { data, isLoading, error } = useTimelines({
    status: status || undefined,
  });

  const { data: mattersData } = useMatters({ limit: 100 });
  const matters = (mattersData?.data ?? []).map((m) => ({
    id: m.id,
    title: m.title,
  }));

  const timelines = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Timelines</h1>
          <p className="mt-1 text-sm text-gray-500">
            Generate chronological event timelines from legal documents
          </p>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New Timeline
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
          Failed to load timelines:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && timelines.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-sm font-medium text-gray-900">
            No timelines yet
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Generate a timeline to visualize the chronological progression of
            legal events across cases and statutes.
          </p>
          <button
            onClick={() => setShowGenerate(true)}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Generate Timeline
          </button>
        </div>
      )}

      {/* Timeline list */}
      {!isLoading && timelines.length > 0 && (
        <div className="space-y-3">
          {timelines.map((timeline) => (
            <TimelineCard key={timeline.id} timeline={timeline} />
          ))}
        </div>
      )}

      {/* Generate dialog */}
      <GenerateTimelineDialog
        open={showGenerate}
        onClose={() => setShowGenerate(false)}
        matters={matters}
      />
    </div>
  );
}

function TimelineCard({ timeline }: { timeline: CaseTimelineListItem }) {
  const statusLabel =
    TIMELINE_STATUS_LABELS[timeline.status] ?? timeline.status;
  const statusStyle =
    TIMELINE_STATUS_COLORS[timeline.status] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/workspace/timelines/${timeline.id}`}
            className="text-sm font-semibold text-gray-900 hover:text-gray-700"
          >
            {timeline.title}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded bg-gray-100 px-1.5 py-0.5">
              {timeline.documentIds.length} document
              {timeline.documentIds.length !== 1 ? 's' : ''}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 capitalize ${statusStyle}`}
            >
              {statusLabel}
            </span>
            <span>
              {new Date(timeline.createdAt).toLocaleDateString()}
            </span>
          </div>
          {timeline.matter && (
            <p className="mt-1 text-xs text-gray-500">
              Matter: {timeline.matter.title}
            </p>
          )}
        </div>
        {timeline.status === 'generating' && (
          <div className="flex items-center gap-1.5 text-xs text-blue-600">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            Generating...
          </div>
        )}
      </div>
    </div>
  );
}
