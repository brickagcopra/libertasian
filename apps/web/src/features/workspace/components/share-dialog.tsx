'use client';

import { useCallback, useState } from 'react';
import {
  useShares,
  useCreateShare,
  useUpdateShare,
  useRevokeShare,
} from '../hooks/use-shares';
import type {
  SharePermission,
  ShareEntityType,
  ShareListItem,
  CreateShareInput,
} from '../types';

// =============================================================================
// ShareDialog — Modal for creating and managing share links
// =============================================================================

interface ShareDialogProps {
  entityType: ShareEntityType;
  entityId: string;
  entityTitle: string;
  onClose: () => void;
}

export function ShareDialog({
  entityType,
  entityId,
  entityTitle,
  onClose,
}: ShareDialogProps) {
  const { data: sharesData, isLoading: loadingShares } = useShares({
    entityType,
    entityId,
  });
  const shares = sharesData?.data ?? [];

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const handleShareCreated = useCallback((token: string) => {
    setCreatedToken(token);
    setShowCreateForm(false);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg bg-white shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Share</h2>
            <p className="text-sm text-gray-500">{entityTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {/* Newly created token banner */}
          {createdToken && (
            <TokenBanner
              token={createdToken}
              onDismiss={() => setCreatedToken(null)}
            />
          )}

          {/* Create new share */}
          {showCreateForm ? (
            <CreateShareForm
              entityType={entityType}
              entityId={entityId}
              onCreated={handleShareCreated}
              onCancel={() => setShowCreateForm(false)}
            />
          ) : (
            <button
              onClick={() => setShowCreateForm(true)}
              className="w-full rounded-md border border-dashed border-gray-300 px-4 py-3 text-sm font-medium text-gray-600 hover:border-gray-400 hover:bg-gray-50"
            >
              + Create Share Link
            </button>
          )}

          {/* Active shares list */}
          <div className="mt-6">
            <h3 className="text-sm font-medium text-gray-700">
              Active Links{' '}
              {!loadingShares && (
                <span className="text-gray-400">({shares.length})</span>
              )}
            </h3>

            {loadingShares && (
              <div className="mt-3 space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-md bg-gray-100" />
                ))}
              </div>
            )}

            {!loadingShares && shares.length === 0 && (
              <p className="mt-3 text-center text-sm text-gray-400">
                No share links yet.
              </p>
            )}

            {!loadingShares && shares.length > 0 && (
              <div className="mt-3 space-y-3">
                {shares.map((share) => (
                  <ShareListEntry key={share.id} share={share} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Token Banner — Shown once after creating a share link
// =============================================================================

function TokenBanner({
  token,
  onDismiss,
}: {
  token: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/shared/${token}`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);

  return (
    <div className="mb-4 rounded-md border border-green-200 bg-green-50 p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-green-800">
            Share link created
          </p>
          <p className="mt-1 text-xs text-green-700">
            Copy this link — it will only be shown once.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="block min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-xs text-gray-700">
              {shareUrl}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="ml-2 shrink-0 text-green-600 hover:text-green-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// CreateShareForm — Form to create a new share link
// =============================================================================

function CreateShareForm({
  entityType,
  entityId,
  onCreated,
  onCancel,
}: {
  entityType: ShareEntityType;
  entityId: string;
  onCreated: (token: string) => void;
  onCancel: () => void;
}) {
  const createShare = useCreateShare();
  const [permission, setPermission] = useState<SharePermission>('view');
  const [label, setLabel] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [useExpiry, setUseExpiry] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payload: CreateShareInput = {
      entityType,
      entityId,
      permission,
    };
    if (label.trim()) payload.label = label.trim();
    if (usePassword && password.length >= 4) payload.password = password;
    if (useExpiry && expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();

    try {
      const result = await createShare.mutateAsync(payload);
      onCreated(result.data.token);
    } catch {
      // Error handled by mutation state
    }
  };

  // Default expiry to 7 days from now
  const defaultExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-md border border-gray-200 bg-gray-50 p-4"
    >
      <h4 className="text-sm font-medium text-gray-700">New Share Link</h4>

      <div className="mt-3 space-y-3">
        {/* Permission */}
        <div>
          <label className="block text-xs font-medium text-gray-600">
            Permission Level
          </label>
          <div className="mt-1 flex gap-2">
            {(['view', 'comment', 'edit'] as SharePermission[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPermission(p)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${
                  permission === p
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-100'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {permission === 'view' && 'Recipient can view titles and documents.'}
            {permission === 'comment' && 'Recipient can view and leave comments.'}
            {permission === 'edit' && 'Recipient can view all details including note content.'}
          </p>
        </div>

        {/* Label */}
        <div>
          <label className="block text-xs font-medium text-gray-600">
            Label (optional)
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g., For client review"
            maxLength={255}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
          />
        </div>

        {/* Password */}
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
            <input
              type="checkbox"
              checked={usePassword}
              onChange={(e) => {
                setUsePassword(e.target.checked);
                if (!e.target.checked) setPassword('');
              }}
              className="rounded border-gray-300"
            />
            Password Protection
          </label>
          {usePassword && (
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 4 characters"
              minLength={4}
              maxLength={128}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
            />
          )}
        </div>

        {/* Expiry */}
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
            <input
              type="checkbox"
              checked={useExpiry}
              onChange={(e) => {
                setUseExpiry(e.target.checked);
                if (e.target.checked && !expiresAt) setExpiresAt(defaultExpiry);
                if (!e.target.checked) setExpiresAt('');
              }}
              className="rounded border-gray-300"
            />
            Set Expiry Date
          </label>
          {useExpiry && (
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
            />
          )}
        </div>
      </div>

      {createShare.error && (
        <p className="mt-3 text-sm text-red-600">
          {createShare.error instanceof Error
            ? createShare.error.message
            : 'Failed to create share link'}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={createShare.isPending || (usePassword && password.length < 4)}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {createShare.isPending ? 'Creating...' : 'Create Link'}
        </button>
      </div>
    </form>
  );
}

// =============================================================================
// ShareListEntry — Single share link in the active shares list
// =============================================================================

function ShareListEntry({ share }: { share: ShareListItem }) {
  const updateShare = useUpdateShare();
  const revokeShare = useRevokeShare();
  const [editing, setEditing] = useState(false);
  const [editPermission, setEditPermission] = useState<SharePermission>(
    share.permission as SharePermission,
  );
  const [editIsActive, setEditIsActive] = useState(share.isActive);

  const handleRevoke = useCallback(() => {
    if (window.confirm('Revoke this share link? Recipients will lose access immediately.')) {
      revokeShare.mutate(share.id);
    }
  }, [share.id, revokeShare]);

  const handleSave = async () => {
    try {
      await updateShare.mutateAsync({
        id: share.id,
        permission: editPermission,
        isActive: editIsActive,
      });
      setEditing(false);
    } catch {
      // Error handled by mutation state
    }
  };

  const isExpired = share.expiresAt && new Date(share.expiresAt) < new Date();

  return (
    <div
      className={`rounded-md border p-3 ${
        !share.isActive || isExpired
          ? 'border-gray-200 bg-gray-50 opacity-60'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Label and badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-gray-900">
              {share.label || 'Share link'}
            </span>
            <PermissionBadge permission={share.permission} />
            {share.isPasswordProtected && (
              <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-700">
                Password
              </span>
            )}
            {!share.isActive && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                Inactive
              </span>
            )}
            {isExpired && (
              <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                Expired
              </span>
            )}
          </div>

          {/* Meta info */}
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span>
              Created {new Date(share.createdAt).toLocaleDateString()} by{' '}
              {share.createdBy.fullName}
            </span>
            <span>{share.accessCount} access{share.accessCount !== 1 ? 'es' : ''}</span>
            {share.expiresAt && (
              <span>
                Expires {new Date(share.expiresAt).toLocaleDateString()}
              </span>
            )}
            {share.lastAccessedAt && (
              <span>
                Last used {new Date(share.lastAccessedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 gap-1">
          <button
            onClick={() => setEditing(!editing)}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button
            onClick={handleRevoke}
            disabled={revokeShare.isPending}
            className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Revoke
          </button>
        </div>
      </div>

      {/* Inline edit form */}
      {editing && (
        <div className="mt-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600">Permission</label>
              <div className="mt-1 flex gap-1">
                {(['view', 'comment', 'edit'] as SharePermission[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setEditPermission(p)}
                    className={`rounded px-2 py-1 text-xs font-medium capitalize ${
                      editPermission === p
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Active
              </label>
            </div>
          </div>

          {updateShare.error && (
            <p className="mt-2 text-xs text-red-600">
              {updateShare.error instanceof Error
                ? updateShare.error.message
                : 'Failed to update'}
            </p>
          )}

          <div className="mt-2 flex justify-end">
            <button
              onClick={handleSave}
              disabled={updateShare.isPending}
              className="rounded-md bg-gray-900 px-3 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {updateShare.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// PermissionBadge
// =============================================================================

function PermissionBadge({ permission }: { permission: string }) {
  const styles: Record<string, string> = {
    view: 'bg-blue-100 text-blue-700',
    comment: 'bg-purple-100 text-purple-700',
    edit: 'bg-green-100 text-green-700',
  };
  const style = styles[permission] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs capitalize ${style}`}>
      {permission}
    </span>
  );
}
