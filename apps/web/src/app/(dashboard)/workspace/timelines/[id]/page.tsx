'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  useTimeline,
  useDeleteTimeline,
} from '@/features/timelines/hooks/use-timelines';
import {
  TIMELINE_STATUS_COLORS,
  TIMELINE_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_COLORS,
} from '@/features/timelines/types';
import type { TimelineEvent } from '@/features/timelines/types';

export default function TimelineDetailPage() {
  const params = useParams();
  const router = useRouter();
  const timelineId = params['id'] as string;

  const { data: timeline, isLoading, error } = useTimeline(timelineId);
  const deleteTimeline = useDeleteTimeline();

  const handleDelete = useCallback(() => {
    if (!timeline) return;
    if (
      window.confirm(
        'Are you sure you want to delete this timeline? This cannot be undone.',
      )
    ) {
      deleteTimeline.mutate(timelineId, {
        onSuccess: () => router.push('/workspace/timelines'),
      });
    }
  }, [timeline, timelineId, deleteTimeline, router]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-8 w-96 animate-pulse rounded bg-gray-200" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !timeline) {
    return (
      <div className="space-y-4">
        <Link
          href="/workspace/timelines"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back to Timelines
        </Link>
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Timeline not found.'}
        </div>
      </div>
    );
  }

  const statusLabel =
    TIMELINE_STATUS_LABELS[timeline.status] ?? timeline.status;
  const statusStyle =
    TIMELINE_STATUS_COLORS[timeline.status] ?? 'bg-gray-100 text-gray-600';

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500">
        <Link href="/workspace/timelines" className="hover:text-gray-700">
          Timelines
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">{timeline.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            {timeline.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
              {timeline.documentIds.length} document
              {timeline.documentIds.length !== 1 ? 's' : ''}
            </span>
            <span
              className={`rounded px-2 py-0.5 text-xs capitalize ${statusStyle}`}
            >
              {statusLabel}
            </span>
            <span>
              {new Date(timeline.createdAt).toLocaleDateString('en-PH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
          {timeline.matter && (
            <p className="mt-1 text-sm text-gray-500">
              Matter:{' '}
              <Link
                href={`/workspace/matters/${timeline.matter.id}`}
                className="text-gray-700 underline hover:text-gray-900"
              >
                {timeline.matter.title}
              </Link>
            </p>
          )}
        </div>
        <button
          onClick={handleDelete}
          disabled={deleteTimeline.isPending}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {deleteTimeline.isPending ? 'Deleting...' : 'Delete'}
        </button>
      </div>

      {/* Generating state */}
      {(timeline.status === 'pending' || timeline.status === 'generating') && (
        <div className="flex items-center gap-3 rounded-md border border-blue-200 bg-blue-50 p-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
          <div>
            <p className="text-sm font-medium text-blue-800">
              {timeline.status === 'pending'
                ? 'Timeline queued for generation...'
                : 'Generating your timeline...'}
            </p>
            <p className="mt-0.5 text-xs text-blue-600">
              This may take up to 30 seconds. The page will update
              automatically.
            </p>
          </div>
        </div>
      )}

      {/* Failed state */}
      {timeline.status === 'failed' && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Timeline generation failed
          </p>
          <p className="mt-0.5 text-xs text-red-600">
            The AI was unable to generate this timeline. Please try again with
            different documents.
          </p>
        </div>
      )}

      {/* Completed - Timeline Visualization */}
      {timeline.status === 'completed' && timeline.timelineJson && (
        <div className="space-y-6">
          {/* Summary */}
          {timeline.timelineJson.summary && (
            <div className="rounded-md border border-gray-300 bg-gray-50 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
                Summary
              </h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
                {timeline.timelineJson.summary}
              </p>
            </div>
          )}

          {/* Timeline Events */}
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
              Events ({timeline.timelineJson.events.length})
            </h2>
            <div className="mt-3 space-y-0">
              {timeline.timelineJson.events.map((event, index) => (
                <TimelineEventCard
                  key={index}
                  event={event}
                  isLast={
                    index === timeline.timelineJson!.events.length - 1
                  }
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineEventCard({
  event,
  isLast,
}: {
  event: TimelineEvent;
  isLast: boolean;
}) {
  const typeLabel =
    EVENT_TYPE_LABELS[event.eventType] ?? event.eventType;
  const typeStyle =
    EVENT_TYPE_COLORS[event.eventType] ?? 'bg-gray-100 text-gray-700';

  return (
    <div className="flex gap-4">
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div className="h-3 w-3 rounded-full border-2 border-gray-400 bg-white" />
        {!isLast && <div className="w-0.5 flex-1 bg-gray-200" />}
      </div>

      {/* Event content */}
      <div className={`min-w-0 flex-1 ${isLast ? 'pb-0' : 'pb-6'}`}>
        <div className="rounded-md border bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-gray-900">
              {event.date}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs ${typeStyle}`}
            >
              {typeLabel}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-gray-900">
            {event.label}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-600">
            {event.description}
          </p>
          {event.sourceDocumentId && (
            <div className="mt-2">
              <Link
                href={`/reader/${event.sourceDocumentId}`}
                className="text-xs text-blue-600 hover:underline"
              >
                View Source Document
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
