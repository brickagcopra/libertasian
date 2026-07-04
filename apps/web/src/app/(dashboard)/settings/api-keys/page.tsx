'use client';

import { useState, useCallback } from 'react';
import {
  PlusIcon,
  CopyIcon,
  CheckIcon,
  XIcon,
  PencilIcon,
  Trash2Icon,
  PowerIcon,
  PowerOffIcon,
} from 'lucide-react';

import {
  useApiKeys,
  useCreateApiKey,
  useUpdateApiKey,
  useDeleteApiKey,
} from '@/features/api-keys/hooks/use-api-keys';
import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
} from '@/features/api-keys/types';
import type { ApiKeyListItem } from '@/features/api-keys/types';
import { ApiClientError } from '@/lib/api-client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

export default function ApiKeysPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading, error } = useApiKeys();
  const keys = data?.data ?? [];

  const handleKeyCreated = useCallback((rawKey: string) => {
    setCreatedKey(rawKey);
    setCreateOpen(false);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage API keys for programmatic access to the LIBERTASIAN External API.
          Requires an Enterprise subscription.
        </p>
      </div>

      {/* Created Key Banner */}
      {createdKey && (
        <CreatedKeyBanner rawKey={createdKey} onDismiss={() => setCreatedKey(null)} />
      )}

      {/* Create Button */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Your API Keys ({keys.length})
        </h2>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
              Create API key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create new API key</DialogTitle>
            </DialogHeader>
            <CreateApiKeyForm
              onCreated={handleKeyCreated}
              onCancel={() => setCreateOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof ApiClientError && error.statusCode === 403
              ? 'API keys require an Enterprise subscription with owner or admin role.'
              : 'Failed to load API keys.'}
          </AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {isLoading && <ApiKeysSkeleton />}

      {/* Key List */}
      {!isLoading && keys.length === 0 && !error && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No API keys yet. Create one to get started.
          </CardContent>
        </Card>
      )}

      {!isLoading && keys.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {keys.map((key) => (
                <ApiKeyRow
                  key={key.id}
                  apiKey={key}
                  isEditing={editingId === key.id}
                  onEdit={() => setEditingId(key.id)}
                  onCancelEdit={() => setEditingId(null)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---- Created Key Banner ----

function CreatedKeyBanner({ rawKey, onDismiss }: { rawKey: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(rawKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Alert className="border-green-200 bg-green-50">
      <AlertDescription>
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-semibold text-green-800">
              API key created successfully
            </p>
            <p className="text-xs text-green-700">
              Copy this key now. You will not be able to see it again.
            </p>
            <div className="flex items-center gap-2">
              <code className="block break-all rounded bg-white px-3 py-2 text-xs shadow-sm">
                {rawKey}
              </code>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? (
                  <><CheckIcon className="mr-1.5 h-3.5 w-3.5" /> Copied!</>
                ) : (
                  <><CopyIcon className="mr-1.5 h-3.5 w-3.5" /> Copy</>
                )}
              </Button>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            className="text-green-600 hover:text-green-800"
            aria-label="Dismiss"
          >
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

// ---- Create Form ----

function CreateApiKeyForm({
  onCreated,
  onCancel,
}: {
  onCreated: (rawKey: string) => void;
  onCancel: () => void;
}) {
  const createKey = useCreateApiKey();
  const [name, setName] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState('60');
  const [expiresAt, setExpiresAt] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const togglePermission = (perm: string, checked: boolean) => {
    setSelectedPermissions((prev) =>
      checked ? [...prev, perm] : prev.filter((p) => p !== perm),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Name is required.');
      return;
    }
    if (selectedPermissions.length === 0) {
      setErrorMsg('Select at least one permission.');
      return;
    }

    try {
      setErrorMsg('');
      const result = await createKey.mutateAsync({
        name: name.trim(),
        permissions: selectedPermissions,
        rateLimitPerMinute: parseInt(rateLimitPerMinute, 10) || 60,
        expiresAt: expiresAt || undefined,
      });
      onCreated(result.data.key);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorMsg(error.message);
      } else {
        setErrorMsg('Failed to create API key.');
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errorMsg && (
        <Alert variant="destructive">
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="key-name">Name</Label>
        <Input
          id="key-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Production Integration"
          maxLength={255}
        />
      </div>

      <div className="space-y-2">
        <Label>Permissions</Label>
        <div className="grid grid-cols-2 gap-2">
          {ALL_PERMISSIONS.map((perm) => (
            <div key={perm.value} className="flex items-center gap-2">
              <Checkbox
                id={`perm-${perm.value}`}
                checked={selectedPermissions.includes(perm.value)}
                onCheckedChange={(checked) => togglePermission(perm.value, !!checked)}
              />
              <Label htmlFor={`perm-${perm.value}`} className="text-sm font-normal">
                {perm.label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="rate-limit">Rate limit (requests per minute)</Label>
        <Input
          id="rate-limit"
          type="number"
          min={1}
          max={1000}
          value={rateLimitPerMinute}
          onChange={(e) => setRateLimitPerMinute(e.target.value)}
          className="w-32"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="expires-at">Expiration date (optional)</Label>
        <Input
          id="expires-at"
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          min={new Date().toISOString().split('T')[0]}
          className="w-48"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={createKey.isPending}>
          {createKey.isPending ? 'Creating...' : 'Create key'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---- API Key Row ----

function ApiKeyRow({
  apiKey,
  isEditing,
  onEdit,
  onCancelEdit,
}: {
  apiKey: ApiKeyListItem;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
}) {
  const updateKey = useUpdateApiKey();
  const deleteKey = useDeleteApiKey();

  const handleToggleActive = async () => {
    await updateKey.mutateAsync({
      id: apiKey.id,
      data: { isActive: !apiKey.isActive },
    });
  };

  const handleDelete = async () => {
    await deleteKey.mutateAsync(apiKey.id);
  };

  if (isEditing) {
    return (
      <EditApiKeyForm
        apiKey={apiKey}
        onDone={onCancelEdit}
      />
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">{apiKey.name}</p>
            <Badge variant={apiKey.isActive ? 'default' : 'secondary'}>
              {apiKey.isActive ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{apiKey.keyPrefix}...</span>
            {' \u00b7 '}
            Created {new Date(apiKey.createdAt).toLocaleDateString()}
            {apiKey.lastUsedAt && (
              <>
                {' \u00b7 '}
                Last used {new Date(apiKey.lastUsedAt).toLocaleDateString()}
              </>
            )}
            {apiKey.expiresAt && (
              <>
                {' \u00b7 '}
                Expires {new Date(apiKey.expiresAt).toLocaleDateString()}
              </>
            )}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {apiKey.permissions.map((perm) => (
              <Badge key={perm} variant="outline" className="text-xs">
                {PERMISSION_LABELS[perm] ?? perm}
              </Badge>
            ))}
          </div>
        </div>
        <div className="ml-4 flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleActive}
            disabled={updateKey.isPending}
          >
            {apiKey.isActive ? (
              <><PowerOffIcon className="mr-1 h-3.5 w-3.5" /> Deactivate</>
            ) : (
              <><PowerIcon className="mr-1 h-3.5 w-3.5" /> Activate</>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <PencilIcon className="mr-1 h-3.5 w-3.5" /> Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                <Trash2Icon className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete API key?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the key &ldquo;{apiKey.name}&rdquo;. Any integrations using this key will stop working.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  disabled={deleteKey.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleteKey.isPending ? 'Deleting...' : 'Delete'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

// ---- Edit Form ----

function EditApiKeyForm({
  apiKey,
  onDone,
}: {
  apiKey: ApiKeyListItem;
  onDone: () => void;
}) {
  const updateKey = useUpdateApiKey();
  const [name, setName] = useState(apiKey.name);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(apiKey.permissions);
  const [rateLimitPerMinute, setRateLimitPerMinute] = useState(String(apiKey.rateLimitPerMinute));
  const [expiresAt, setExpiresAt] = useState(
    apiKey.expiresAt ? apiKey.expiresAt.split('T')[0] : '',
  );
  const [errorMsg, setErrorMsg] = useState('');

  const togglePermission = (perm: string, checked: boolean) => {
    setSelectedPermissions((prev) =>
      checked ? [...prev, perm] : prev.filter((p) => p !== perm),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg('Name is required.');
      return;
    }
    if (selectedPermissions.length === 0) {
      setErrorMsg('Select at least one permission.');
      return;
    }

    try {
      setErrorMsg('');
      await updateKey.mutateAsync({
        id: apiKey.id,
        data: {
          name: name.trim(),
          permissions: selectedPermissions,
          rateLimitPerMinute: parseInt(rateLimitPerMinute, 10) || 60,
          expiresAt: expiresAt || null,
        },
      });
      onDone();
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrorMsg(error.message);
      } else {
        setErrorMsg('Failed to update API key.');
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-muted px-4 py-3 space-y-3">
      {errorMsg && (
        <Alert variant="destructive">
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-3">
        <div className="flex-1 space-y-1">
          <Label htmlFor={`edit-name-${apiKey.id}`}>Name</Label>
          <Input
            id={`edit-name-${apiKey.id}`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={255}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`edit-rate-${apiKey.id}`}>Rate limit/min</Label>
          <Input
            id={`edit-rate-${apiKey.id}`}
            type="number"
            min={1}
            max={1000}
            value={rateLimitPerMinute}
            onChange={(e) => setRateLimitPerMinute(e.target.value)}
            className="w-24"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`edit-exp-${apiKey.id}`}>Expires</Label>
          <Input
            id={`edit-exp-${apiKey.id}`}
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Permissions</Label>
        <div className="flex flex-wrap gap-3">
          {ALL_PERMISSIONS.map((perm) => (
            <div key={perm.value} className="flex items-center gap-1.5">
              <Checkbox
                id={`edit-perm-${apiKey.id}-${perm.value}`}
                checked={selectedPermissions.includes(perm.value)}
                onCheckedChange={(checked) => togglePermission(perm.value, !!checked)}
              />
              <Label htmlFor={`edit-perm-${apiKey.id}-${perm.value}`} className="text-xs font-normal">
                {perm.label}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={updateKey.isPending}>
          {updateKey.isPending ? 'Saving...' : 'Save'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---- Skeleton ----

function ApiKeysSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="mt-2 h-3 w-32" />
            <div className="mt-2 flex gap-1">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
