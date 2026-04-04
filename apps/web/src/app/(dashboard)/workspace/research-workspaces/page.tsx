'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  useResearchWorkspaces,
  useCreateResearchWorkspace,
  useDeleteResearchWorkspace,
} from '@/features/research-workspaces/hooks/use-research-workspaces';
import type { ResearchWorkspaceListItem } from '@/features/research-workspaces/types';

export default function ResearchWorkspacesPage() {
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, error } = useResearchWorkspaces();
  const deleteWorkspace = useDeleteResearchWorkspace();

  const workspaces = data?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Research Workspaces</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create persistent research sessions with context-aware AI queries
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          New Workspace
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border bg-gray-100"
            />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          Failed to load workspaces:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && workspaces.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-sm font-medium text-gray-900">
            No research workspaces yet
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Create a workspace to start context-aware legal research with pinned
            documents and conversation history.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Create Workspace
          </button>
        </div>
      )}

      {/* Workspace list */}
      {!isLoading && workspaces.length > 0 && (
        <div className="space-y-3">
          {workspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              workspace={ws}
              onDelete={(id) => {
                if (
                  window.confirm(
                    'Delete this workspace and all its queries? This cannot be undone.',
                  )
                ) {
                  deleteWorkspace.mutate(id);
                }
              }}
              isDeleting={deleteWorkspace.isPending}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      {showCreate && (
        <CreateWorkspaceDialog onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}

function WorkspaceCard({
  workspace,
  onDelete,
  isDeleting,
}: {
  workspace: ResearchWorkspaceListItem;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href={`/workspace/research-workspaces/${workspace.id}`}
            className="text-sm font-semibold text-gray-900 hover:text-gray-700"
          >
            {workspace.title}
          </Link>
          {workspace.description && (
            <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">
              {workspace.description}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="rounded bg-gray-100 px-1.5 py-0.5">
              {workspace.queryCount} quer
              {workspace.queryCount !== 1 ? 'ies' : 'y'}
            </span>
            <span>
              {new Date(workspace.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
        <button
          onClick={() => onDelete(workspace.id)}
          disabled={isDeleting}
          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function CreateWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [documentIdInput, setDocumentIdInput] = useState('');

  const createMutation = useCreateResearchWorkspace();

  const handleSubmit = () => {
    if (title.trim().length < 3) return;

    const pinnedDocumentIds = documentIdInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    createMutation.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        pinnedDocumentIds:
          pinnedDocumentIds.length > 0 ? pinnedDocumentIds : undefined,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold">New Research Workspace</h2>
        <p className="mt-1 text-sm text-gray-500">
          Create a workspace to organize your research with pinned documents and
          AI-assisted queries.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Constructive Dismissal Research"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of your research focus"
              rows={2}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Pinned Document IDs (optional, comma-separated)
            </label>
            <textarea
              value={documentIdInput}
              onChange={(e) => setDocumentIdInput(e.target.value)}
              placeholder="Enter document UUIDs to pin for context"
              rows={2}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending || title.trim().length < 3}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
