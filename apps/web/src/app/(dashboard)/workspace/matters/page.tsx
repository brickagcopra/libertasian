'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import {
  useMatters,
  useCreateMatter,
  useUpdateMatter,
  useDeleteMatter,
} from '@/features/workspace/hooks/use-matters';
import { MatterListSkeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PlusIcon, SearchIcon, AlertCircleIcon } from 'lucide-react';
import type { MatterListItem, CreateMatterInput, MatterStatus } from '@/features/workspace/types';

const MATTER_TYPES = [
  { value: 'civil', label: 'Civil' },
  { value: 'criminal', label: 'Criminal' },
  { value: 'labor', label: 'Labor' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'tax', label: 'Tax' },
  { value: 'admin', label: 'Administrative' },
  { value: 'other', label: 'Other' },
];

const STATUS_BADGE_VARIANT: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  active: { variant: 'outline', className: 'border-green-200 bg-green-50 text-green-700' },
  closed: { variant: 'secondary' },
  archived: { variant: 'outline', className: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
};

function MatterStatusBadge({ status }: { status: string }) {
  const style = STATUS_BADGE_VARIANT[status] ?? { variant: 'secondary' as const };
  return (
    <Badge variant={style.variant} className={style.className}>
      {status}
    </Badge>
  );
}

export default function MattersPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingMatter, setEditingMatter] = useState<MatterListItem | null>(null);

  const { data, isLoading, error } = useMatters({
    status: statusFilter !== 'all' ? statusFilter : undefined,
    search: search || undefined,
  });
  const deleteMatter = useDeleteMatter();

  const matters = data?.data ?? [];
  const meta = data?.meta;

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSearch(searchInput);
    },
    [searchInput],
  );

  const handleDelete = useCallback(
    (matter: MatterListItem) => {
      if (
        window.confirm(
          `Delete "${matter.title}"? This will also remove all attached documents and notes.`,
        )
      ) {
        deleteMatter.mutate(matter.id);
      }
    },
    [deleteMatter],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Matters</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your cases and matters
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <PlusIcon className="mr-2 size-4" />
          New Matter
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <form onSubmit={handleSearch} className="flex flex-1 gap-2">
          <Input
            type="text"
            placeholder="Search matters..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" variant="outline">
            <SearchIcon className="mr-2 size-4" />
            Search
          </Button>
        </form>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && <MatterListSkeleton />}

      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            Failed to load matters: {error instanceof Error ? error.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && matters.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No matters found.</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Create your first matter to start organizing your legal work.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {matters.map((matter) => (
          <MatterCard
            key={matter.id}
            matter={matter}
            onEdit={() => setEditingMatter(matter)}
            onDelete={() => handleDelete(matter)}
            isDeleting={deleteMatter.isPending}
          />
        ))}
      </div>

      {meta?.hasNext && (
        <p className="text-center text-sm text-muted-foreground/70">
          More matters available. Scroll-based pagination coming soon.
        </p>
      )}

      <CreateMatterDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />

      <EditMatterDialog
        matter={editingMatter}
        open={!!editingMatter}
        onOpenChange={(open) => { if (!open) setEditingMatter(null); }}
      />
    </div>
  );
}

// -- Matter Card --------------------------------------------------------------

function MatterCard({
  matter,
  onEdit,
  onDelete,
  isDeleting,
}: {
  matter: MatterListItem;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Link
              href={ROUTES.WORKSPACE_MATTER(matter.id)}
              className="text-sm font-semibold hover:underline"
            >
              {matter.title}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <MatterStatusBadge status={matter.status} />
              {matter.matterType && (
                <Badge variant="secondary" className="capitalize">
                  {matter.matterType}
                </Badge>
              )}
              {matter.court && (
                <span className="text-xs text-muted-foreground">{matter.court}</span>
              )}
              <span className="text-xs text-muted-foreground">{matter._count.documents} docs</span>
              <span className="text-xs text-muted-foreground">{matter._count.notes} notes</span>
            </div>
            {matter.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {matter.description}
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground/70">
              Created {new Date(matter.createdAt).toLocaleDateString()} by{' '}
              {matter.owner.fullName}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={isDeleting}
              className="text-destructive hover:text-destructive"
            >
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// -- Create Matter Dialog -----------------------------------------------------

function CreateMatterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMatter = useCreateMatter();
  const [form, setForm] = useState<CreateMatterInput>({
    title: '',
    description: '',
    matterType: '',
    court: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;

    try {
      await createMatter.mutateAsync({
        title: form.title,
        description: form.description || undefined,
        matterType: form.matterType || undefined,
        court: form.court || undefined,
      });
      setForm({ title: '', description: '', matterType: '', court: '' });
      onOpenChange(false);
    } catch {
      // Error handled by mutation state
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Matter</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="matter-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="matter-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g., Reyes v. Santos - Civil Case No. 12345"
              required
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="matter-desc">Description</Label>
            <Textarea
              id="matter-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.matterType || 'none'}
                onValueChange={(v) => setForm({ ...form, matterType: v === 'none' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select type</SelectItem>
                  {MATTER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="matter-court">Court</Label>
              <Input
                id="matter-court"
                value={form.court}
                onChange={(e) => setForm({ ...form, court: e.target.value })}
                placeholder="e.g., RTC Branch 1"
              />
            </div>
          </div>

          {createMatter.error && (
            <p className="text-sm text-destructive">
              {createMatter.error instanceof Error
                ? createMatter.error.message
                : 'Failed to create matter'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMatter.isPending || !form.title.trim()}
            >
              {createMatter.isPending ? 'Creating...' : 'Create Matter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -- Edit Matter Dialog -------------------------------------------------------

function EditMatterDialog({
  matter,
  open,
  onOpenChange,
}: {
  matter: MatterListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateMatter = useUpdateMatter();
  const [form, setForm] = useState({
    title: '',
    description: '',
    matterType: '',
    court: '',
    status: 'active' as MatterStatus,
  });

  // Sync form when matter changes
  const [prevId, setPrevId] = useState<string | null>(null);
  if (matter && matter.id !== prevId) {
    setPrevId(matter.id);
    setForm({
      title: matter.title,
      description: matter.description ?? '',
      matterType: matter.matterType ?? '',
      court: matter.court ?? '',
      status: matter.status as MatterStatus,
    });
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matter || !form.title.trim()) return;

    try {
      await updateMatter.mutateAsync({
        id: matter.id,
        title: form.title,
        description: form.description || undefined,
        matterType: form.matterType || undefined,
        court: form.court || undefined,
        status: form.status,
      });
      onOpenChange(false);
    } catch {
      // Error handled by mutation state
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Matter</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-desc">Description</Label>
            <Textarea
              id="edit-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.matterType || 'none'}
                onValueChange={(v) => setForm({ ...form, matterType: v === 'none' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Select type</SelectItem>
                  {MATTER_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-court">Court</Label>
              <Input
                id="edit-court"
                value={form.court}
                onChange={(e) => setForm({ ...form, court: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v as MatterStatus })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {updateMatter.error && (
            <p className="text-sm text-destructive">
              {updateMatter.error instanceof Error
                ? updateMatter.error.message
                : 'Failed to update matter'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateMatter.isPending || !form.title.trim()}
            >
              {updateMatter.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
