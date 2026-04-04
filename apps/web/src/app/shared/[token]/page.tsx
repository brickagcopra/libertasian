'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { APP_NAME } from '@/lib/constants';
import type {
  SharedContentResponse,
  SharedMatterData,
  SharedMatterDocument,
  SharedMatterNote,
  SharedMatterTask,
} from '@/features/workspace/types';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001/api/v1';

// =============================================================================
// Shared Content Viewer — Public page, no auth required
// =============================================================================

export default function SharedContentPage() {
  const routeParams = useParams();
  const token = (routeParams?.['token'] ?? '') as string;

  const [data, setData] = useState<SharedContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [submittingPassword, setSubmittingPassword] = useState(false);

  // Fetch shared content on mount
  const fetchContent = useCallback(
    async (password?: string) => {
      try {
        const url = `${API_BASE_URL}/shared/${encodeURIComponent(token)}`;
        const options: RequestInit = {
          method: password ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json' },
        };
        if (password) {
          options.body = JSON.stringify({ password });
        }

        const response = await fetch(url, options);

        if (!response.ok) {
          const body = await response.json().catch(() => ({ message: 'Request failed' }));
          if (response.status === 401) {
            setPasswordError(body.message || 'Incorrect password');
            return;
          }
          throw new Error(body.message || `HTTP ${response.status}`);
        }

        const result = (await response.json()) as { success: boolean; data: SharedContentResponse };
        setData(result.data);
        setError(null);
        setPasswordError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load shared content');
      } finally {
        setLoading(false);
        setSubmittingPassword(false);
      }
    },
    [token],
  );

  // Initial fetch
  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) return;
    setSubmittingPassword(true);
    setPasswordError(null);
    await fetchContent(passwordInput);
  };

  // -- Loading state --
  if (loading) {
    return (
      <SharedLayout>
        <div className="flex min-h-[300px] items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900" />
            <p className="mt-3 text-sm text-gray-500">Loading shared content...</p>
          </div>
        </div>
      </SharedLayout>
    );
  }

  // -- Error state --
  if (error) {
    return (
      <SharedLayout>
        <div className="flex min-h-[300px] items-center justify-center">
          <div className="max-w-md text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Unable to Access</h2>
            <p className="mt-2 text-sm text-gray-600">{error}</p>
            <p className="mt-4 text-xs text-gray-400">
              This link may have expired, been revoked, or never existed.
            </p>
          </div>
        </div>
      </SharedLayout>
    );
  }

  // -- Password required --
  if (data?.requiresPassword && !data?.data) {
    return (
      <SharedLayout>
        <div className="flex min-h-[300px] items-center justify-center">
          <div className="w-full max-w-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100">
              <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-center text-lg font-semibold text-gray-900">
              Password Required
            </h2>
            {data.label && (
              <p className="mt-1 text-center text-sm text-gray-500">{data.label}</p>
            )}
            <form onSubmit={handlePasswordSubmit} className="mt-4 space-y-3">
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="Enter password"
                autoFocus
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
              />
              {passwordError && (
                <p className="text-sm text-red-600">{passwordError}</p>
              )}
              <button
                type="submit"
                disabled={submittingPassword || !passwordInput.trim()}
                className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {submittingPassword ? 'Verifying...' : 'Access Content'}
              </button>
            </form>
          </div>
        </div>
      </SharedLayout>
    );
  }

  // -- Content display --
  if (!data?.data) {
    return (
      <SharedLayout>
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-sm text-gray-500">No content available.</p>
        </div>
      </SharedLayout>
    );
  }

  return (
    <SharedLayout>
      <SharedMatterView
        matter={data.data}
        permission={data.permission ?? 'view'}
        label={data.label}
      />
    </SharedLayout>
  );
}

// =============================================================================
// SharedLayout — Minimal layout for shared pages
// =============================================================================

function SharedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-gray-900">{APP_NAME}</span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              Shared
            </span>
          </div>
          <p className="text-xs text-gray-400">
            Shared content — view only
          </p>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>

      {/* Footer */}
      <footer className="border-t bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4">
          <p className="text-center text-xs text-gray-400">
            Powered by {APP_NAME} — Philippine Legal AI Platform.
            This shared content does not constitute legal advice.
          </p>
        </div>
      </footer>
    </div>
  );
}

// =============================================================================
// SharedMatterView — Displays a shared matter with documents, notes, tasks
// =============================================================================

function SharedMatterView({
  matter,
  permission,
  label,
}: {
  matter: SharedMatterData;
  permission: string;
  label?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<'documents' | 'notes' | 'tasks' | 'details'>(
    'documents',
  );

  return (
    <div className="space-y-6">
      {/* Label banner */}
      {label && (
        <div className="rounded-md bg-blue-50 px-4 py-2 text-sm text-blue-700">
          {label}
        </div>
      )}

      {/* Header */}
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold text-gray-900">{matter.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-500">
          <MatterStatusBadge status={matter.status} />
          {matter.matterType && (
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs capitalize">
              {matter.matterType}
            </span>
          )}
          {matter.court && <span>{matter.court}</span>}
          <span>
            {matter._count.documents} doc{matter._count.documents !== 1 ? 's' : ''},{' '}
            {matter._count.notes} note{matter._count.notes !== 1 ? 's' : ''},{' '}
            {matter._count.tasks} task{matter._count.tasks !== 1 ? 's' : ''}
          </span>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs capitalize">
            {permission} access
          </span>
        </div>
        {matter.description && (
          <p className="mt-2 text-sm text-gray-600">{matter.description}</p>
        )}
        <p className="mt-1 text-xs text-gray-400">
          Created {new Date(matter.createdAt).toLocaleDateString()} by{' '}
          {matter.owner.fullName}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(['documents', 'notes', 'tasks', 'details'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-4 py-2 text-sm font-medium capitalize ${
              activeTab === tab
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            {tab}
            {tab === 'documents' && (
              <span className="ml-1.5 text-xs text-gray-400">
                ({matter._count.documents})
              </span>
            )}
            {tab === 'notes' && (
              <span className="ml-1.5 text-xs text-gray-400">
                ({matter._count.notes})
              </span>
            )}
            {tab === 'tasks' && (
              <span className="ml-1.5 text-xs text-gray-400">
                ({matter._count.tasks})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'documents' && (
        <SharedDocumentsTab documents={matter.documents} />
      )}
      {activeTab === 'notes' && (
        <SharedNotesTab notes={matter.notes} permission={permission} />
      )}
      {activeTab === 'tasks' && <SharedTasksTab tasks={matter.tasks} />}
      {activeTab === 'details' && <SharedDetailsTab matter={matter} />}
    </div>
  );
}

// =============================================================================
// Tab Components
// =============================================================================

function SharedDocumentsTab({ documents }: { documents: SharedMatterDocument[] }) {
  if (documents.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400">
        No documents in this matter.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {documents.map((doc) => (
        <div
          key={doc.id}
          className="rounded-md border border-gray-200 bg-white p-3"
        >
          <div className="text-sm font-medium text-gray-900">
            {doc.title || doc.legalDocument?.title || 'Untitled'}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className={`rounded px-1.5 py-0.5 capitalize ${roleStyle(doc.role)}`}>
              {doc.role}
            </span>
            {doc.legalDocument?.citationText && (
              <span>{doc.legalDocument.citationText}</span>
            )}
            {doc.legalDocument?.documentType && (
              <span className="capitalize">
                {doc.legalDocument.documentType.replace(/_/g, ' ')}
              </span>
            )}
            <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SharedNotesTab({
  notes,
  permission,
}: {
  notes: SharedMatterNote[];
  permission: string;
}) {
  if (notes.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400">
        No notes in this matter.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {notes.map((note) => (
        <div
          key={note.id}
          className="rounded-md border border-gray-200 bg-white p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">
              {note.title || 'Untitled Note'}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs ${
                note.visibility === 'org'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {note.visibility}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-400">
            Updated {new Date(note.updatedAt).toLocaleDateString()}
          </p>
          {/* Show note body only for edit permission */}
          {permission === 'edit' && note.body != null && (
            <div className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-600">
              <p className="italic text-gray-400">Note content available with edit access</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SharedTasksTab({ tasks }: { tasks: SharedMatterTask[] }) {
  if (tasks.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400">
        No tasks in this matter.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="rounded-md border border-gray-200 bg-white p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-900">{task.title}</span>
            <div className="flex gap-1.5">
              <TaskStatusBadge status={task.status} />
              <TaskPriorityBadge priority={task.priority} />
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            {task.assignedTo && <span>Assigned to {task.assignedTo.fullName}</span>}
            {task.dueDate && (
              <span>Due {new Date(task.dueDate).toLocaleDateString()}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SharedDetailsTab({ matter }: { matter: SharedMatterData }) {
  return (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <SharedDetailField label="Title" value={matter.title} />
      <SharedDetailField label="Status" value={matter.status} capitalize />
      <SharedDetailField label="Type" value={matter.matterType} capitalize />
      <SharedDetailField label="Court" value={matter.court} />
      <SharedDetailField
        label="Created"
        value={new Date(matter.createdAt).toLocaleString()}
      />
      <SharedDetailField
        label="Updated"
        value={new Date(matter.updatedAt).toLocaleString()}
      />
      <SharedDetailField label="Owner" value={matter.owner.fullName} />
      <SharedDetailField
        label="Description"
        value={matter.description}
        fullWidth
      />
    </dl>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

function SharedDetailField({
  label,
  value,
  capitalize,
  fullWidth,
}: {
  label: string;
  value: string | null | undefined;
  capitalize?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd
        className={`mt-1 text-sm text-gray-900 ${capitalize ? 'capitalize' : ''}`}
      >
        {value || <span className="text-gray-400">-</span>}
      </dd>
    </div>
  );
}

function MatterStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    closed: 'bg-gray-200 text-gray-600',
    archived: 'bg-yellow-100 text-yellow-700',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs capitalize ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

function TaskStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    todo: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-blue-100 text-blue-700',
    done: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-100 text-red-600',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function TaskPriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    low: 'bg-gray-100 text-gray-600',
    medium: 'bg-yellow-100 text-yellow-700',
    high: 'bg-orange-100 text-orange-700',
    urgent: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs capitalize ${styles[priority] ?? 'bg-gray-100 text-gray-600'}`}>
      {priority}
    </span>
  );
}

function roleStyle(role: string): string {
  const styles: Record<string, string> = {
    evidence: 'bg-red-100 text-red-700',
    reference: 'bg-blue-100 text-blue-700',
    pleading: 'bg-purple-100 text-purple-700',
    research: 'bg-green-100 text-green-700',
    note: 'bg-gray-100 text-gray-600',
  };
  return styles[role] ?? 'bg-gray-100 text-gray-600';
}
