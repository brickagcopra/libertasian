'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  useResearchWorkspace,
  useDeleteResearchWorkspace,
  useResearchQueries,
  useAskResearchQuery,
} from '@/features/research-workspaces/hooks/use-research-workspaces';
import type { ResearchQueryListItem } from '@/features/research-workspaces/types';

export default function ResearchWorkspaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const workspaceId = params['id'] as string;

  const { data: workspace, isLoading, error } = useResearchWorkspace(workspaceId);
  const { data: queries } = useResearchQueries(workspaceId);
  const deleteWorkspace = useDeleteResearchWorkspace();
  const askQuery = useAskResearchQuery(workspaceId);

  const [queryInput, setQueryInput] = useState('');

  const handleDelete = useCallback(() => {
    if (!workspace) return;
    if (
      window.confirm(
        'Delete this workspace and all queries? This cannot be undone.',
      )
    ) {
      deleteWorkspace.mutate(workspaceId, {
        onSuccess: () => router.push('/workspace/research-workspaces'),
      });
    }
  }, [workspace, workspaceId, deleteWorkspace, router]);

  const handleAsk = useCallback(() => {
    const trimmed = queryInput.trim();
    if (trimmed.length < 10) return;

    askQuery.mutate(
      { query: trimmed },
      { onSuccess: () => setQueryInput('') },
    );
  }, [queryInput, askQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAsk();
      }
    },
    [handleAsk],
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-8 w-96 animate-pulse rounded bg-gray-200" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="space-y-4">
        <Link
          href="/workspace/research-workspaces"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          &larr; Back to Research Workspaces
        </Link>
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error instanceof Error ? error.message : 'Workspace not found.'}
        </div>
      </div>
    );
  }

  const queryList = queries ?? [];

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500">
        <Link
          href="/workspace/research-workspaces"
          className="hover:text-gray-700"
        >
          Research Workspaces
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">{workspace.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-gray-900">
            {workspace.title}
          </h1>
          {workspace.description && (
            <p className="mt-1 text-sm text-gray-500">
              {workspace.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded bg-gray-100 px-1.5 py-0.5">
              {workspace.queryCount} quer
              {workspace.queryCount !== 1 ? 'ies' : 'y'}
            </span>
            {workspace.contextJson?.pinnedDocumentIds?.length > 0 && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5">
                {workspace.contextJson.pinnedDocumentIds.length} pinned doc
                {workspace.contextJson.pinnedDocumentIds.length !== 1
                  ? 's'
                  : ''}
              </span>
            )}
            <span>
              Created{' '}
              {new Date(workspace.createdAt).toLocaleDateString('en-PH', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
        </div>
        <button
          onClick={handleDelete}
          disabled={deleteWorkspace.isPending}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {deleteWorkspace.isPending ? 'Deleting...' : 'Delete'}
        </button>
      </div>

      {/* Conversation thread */}
      <div className="space-y-4">
        {queryList.length === 0 && (
          <div className="rounded-lg border-2 border-dashed p-8 text-center">
            <p className="text-sm font-medium text-gray-900">
              No queries yet
            </p>
            <p className="mt-1 text-sm text-gray-500">
              Ask your first research question below to get started.
            </p>
          </div>
        )}

        {queryList.map((q) => (
          <QueryThread key={q.id} query={q} />
        ))}
      </div>

      {/* Query input */}
      <div className="sticky bottom-0 border-t bg-white pt-4">
        <div className="flex gap-3">
          <textarea
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a legal research question (min 10 characters)... Press Enter to submit, Shift+Enter for new line"
            rows={2}
            className="flex-1 resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
          />
          <button
            onClick={handleAsk}
            disabled={askQuery.isPending || queryInput.trim().length < 10}
            className="self-end rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {askQuery.isPending ? 'Sending...' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}

function QueryThread({ query }: { query: ResearchQueryListItem }) {
  const isLoading = !query.responseJson;
  const hasError = query.responseJson?.error === true;

  return (
    <div className="space-y-2">
      {/* User question */}
      <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs font-medium text-gray-400">Question</p>
        <p className="mt-1 text-sm text-gray-800">{query.query}</p>
        <p className="mt-1 text-xs text-gray-400">
          {new Date(query.createdAt).toLocaleString()}
        </p>
      </div>

      {/* AI response */}
      {isLoading && (
        <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 p-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
          <p className="text-sm text-blue-700">Researching...</p>
        </div>
      )}

      {hasError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">
            {query.responseJson?.answer ??
              'Failed to generate a response. Please try again.'}
          </p>
        </div>
      )}

      {query.responseJson && !hasError && (
        <div className="rounded-md border border-gray-200 bg-white p-3">
          <p className="text-xs font-medium text-gray-400">Answer</p>
          <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
            {query.responseJson.answer}
          </div>

          {/* Citations */}
          {query.citationsJson.length > 0 && (
            <div className="mt-3 border-t pt-2">
              <p className="text-xs font-medium text-gray-400">
                Sources ({query.citationsJson.length})
              </p>
              <ul className="mt-1 space-y-0.5">
                {query.citationsJson.map((citation, i) => (
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
                        View
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Follow-up suggestions */}
          {query.responseJson.followUpSuggestions.length > 0 && (
            <div className="mt-3 border-t pt-2">
              <p className="text-xs font-medium text-gray-400">
                Follow-up questions
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                {query.responseJson.followUpSuggestions.map((suggestion, i) => (
                  <span
                    key={i}
                    className="rounded-full border bg-gray-50 px-2.5 py-1 text-xs text-gray-600"
                  >
                    {suggestion}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
