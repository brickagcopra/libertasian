'use client';

import Link from 'next/link';

import { useActivity } from '../hooks/use-activity';
import { ROUTES } from '@/lib/constants';
import type { ActivityEntry } from '../types';

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

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function ActivityItem({ entry }: { entry: ActivityEntry }) {
  const actorName = entry.actor?.fullName ?? 'System';
  const label = ACTION_LABELS[entry.action] ?? entry.action;
  const entityTitle = (entry.metadata?.['title'] as string) ?? null;
  const entityRoute = entry.entityId && ENTITY_ROUTES[entry.entityType]
    ? ENTITY_ROUTES[entry.entityType](entry.entityId)
    : null;

  return (
    <div className="flex gap-3 py-2.5">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-[10px] font-medium text-gray-600">
        {actorName.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-medium text-gray-900">{actorName}</span>{' '}
        <span className="text-gray-600">{label}</span>
        {entityTitle && entityRoute ? (
          <>
            {' — '}
            <Link href={entityRoute} className="font-medium text-gray-900 hover:underline">
              {entityTitle}
            </Link>
          </>
        ) : entityTitle ? (
          <>
            {' — '}
            <span className="text-gray-700">{entityTitle}</span>
          </>
        ) : null}
        <div className="mt-0.5 text-xs text-gray-400">
          {formatRelativeTime(entry.createdAt)}
        </div>
      </div>
    </div>
  );
}

export function ActivityFeed({
  limit = 10,
  showViewAll = true,
}: {
  limit?: number;
  showViewAll?: boolean;
}) {
  const { data, isLoading, error } = useActivity({ limit });

  const entries = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="h-7 w-7 animate-pulse rounded-full bg-gray-100" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-1/4 animate-pulse rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-gray-400">Unable to load activity.</p>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-gray-400">No recent activity.</p>
    );
  }

  return (
    <div>
      <div className="divide-y">
        {entries.map((entry) => (
          <ActivityItem key={entry.id} entry={entry} />
        ))}
      </div>
      {showViewAll && data?.meta.hasNext && (
        <div className="mt-3 border-t pt-3">
          <Link
            href="/workspace/activity"
            className="text-sm font-medium text-gray-600 hover:text-gray-900"
          >
            View all activity
          </Link>
        </div>
      )}
    </div>
  );
}
