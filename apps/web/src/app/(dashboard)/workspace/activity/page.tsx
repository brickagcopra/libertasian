'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useActivity } from '@/features/workspace/hooks/use-activity';
import { ROUTES } from '@/lib/constants';
import type { ActivityEntry } from '@/features/workspace/types';

const ACTION_LABELS: Record<string, string> = {
  'matter.create': 'created a matter',
  'matter.update': 'updated a matter',
  'matter.delete': 'deleted a matter',
  'matter_document.create': 'linked a document to a matter',
  'matter_document.delete': 'removed a document from a matter',
  'note.create': 'created a note',
  'note.update': 'updated a note',
  'note.delete': 'deleted a note',
  'annotation.create': 'added an annotation',
  'annotation.delete': 'removed an annotation',
  'task.create': 'created a task',
  'task.update': 'updated a task',
  'task.delete': 'deleted a task',
  'task_comment.create': 'commented on a task',
  'task_comment.delete': 'removed a task comment',
};

const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  matter: (id) => ROUTES.WORKSPACE_MATTER(id),
  note: (id) => ROUTES.WORKSPACE_NOTE(id),
  task: (id) => ROUTES.WORKSPACE_TASK(id),
};

const ENTITY_FILTER_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'matter', label: 'Matters' },
  { value: 'note', label: 'Notes' },
  { value: 'task', label: 'Tasks' },
  { value: 'annotation', label: 'Annotations' },
  { value: 'task_comment', label: 'Comments' },
];

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const actorName = entry.actor?.fullName ?? 'System';
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  const entityTitle = (entry.metadata?.['title'] as string) ?? null;
  const entityRoute =
    entry.entityId && ENTITY_ROUTES[entry.entityType]
      ? ENTITY_ROUTES[entry.entityType](entry.entityId)
      : null;

  return (
    <div className="flex gap-3 rounded-md border bg-white p-4">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
        {actorName.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm">
          <span className="font-medium text-gray-900">{actorName}</span>{' '}
          <span className="text-gray-600">{label}</span>
          {entityTitle && entityRoute ? (
            <>
              {' — '}
              <Link
                href={entityRoute}
                className="font-medium text-gray-900 hover:underline"
              >
                {entityTitle}
              </Link>
            </>
          ) : entityTitle ? (
            <>
              {' — '}
              <span className="text-gray-700">{entityTitle}</span>
            </>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
            {entry.entityType}
          </span>
          <span>{formatRelativeTime(entry.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

export default function ActivityPage() {
  const [entityTypeFilter, setEntityTypeFilter] = useState('');

  const { data, isLoading, error } = useActivity({
    entityType: entityTypeFilter || undefined,
    limit: 50,
  });

  const entries = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Activity</h1>
          <p className="mt-1 text-sm text-gray-500">
            Recent workspace actions by your team
          </p>
        </div>
        <Link
          href={ROUTES.WORKSPACE}
          className="rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Workspace
        </Link>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <select
          value={entityTypeFilter}
          onChange={(e) => setEntityTypeFilter(e.target.value)}
          className="rounded-md border px-3 py-2 text-sm"
        >
          {ENTITY_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Activity list */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-md border bg-gray-100" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-800">
          Failed to load activity. Please try again.
        </div>
      )}

      {!isLoading && !error && entries.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-sm text-gray-500">
            {entityTypeFilter
              ? 'No activity matching this filter.'
              : 'No activity yet. Actions in the workspace will appear here.'}
          </p>
        </div>
      )}

      {!isLoading && entries.length > 0 && (
        <div className="space-y-2">
          {entries.map((entry) => (
            <ActivityItem key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
