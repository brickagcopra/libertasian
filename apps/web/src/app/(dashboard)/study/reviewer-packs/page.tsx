'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';

import { useBarSubjects } from '@/features/study/hooks/use-bar-subjects';
import {
  useReviewerPacks,
  useCreateReviewerPack,
  useDeleteReviewerPack,
} from '@/features/study/hooks/use-reviewer-packs';
import { ROUTES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
import { PlusIcon, AlertCircleIcon } from 'lucide-react';

const VISIBILITY_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  private: { variant: 'secondary' },
  org: { variant: 'outline', className: 'border-purple-200 bg-purple-50 text-purple-700' },
  public_editorial: { variant: 'outline', className: 'border-blue-200 bg-blue-50 text-blue-700' },
};

function VisibilityBadge({ visibility }: { visibility: string }) {
  const style = VISIBILITY_BADGE[visibility] ?? { variant: 'secondary' as const };
  return (
    <Badge variant={style.variant} className={style.className}>
      {visibility.replace(/_/g, ' ')}
    </Badge>
  );
}

export default function ReviewerPacksPage() {
  const [barSubject, setBarSubject] = useState('all');
  const [showCreate, setShowCreate] = useState(false);

  const { data: subjectsData } = useBarSubjects();
  const { data, isLoading, error } = useReviewerPacks({
    barSubject: barSubject !== 'all' ? barSubject : undefined,
  });
  const deleteMutation = useDeleteReviewerPack();

  const subjects = subjectsData?.data ?? [];
  const packs = data?.data ?? [];

  const handleDelete = useCallback(
    (id: string) => {
      if (window.confirm('Delete this reviewer pack? This cannot be undone.')) {
        deleteMutation.mutate(id);
      }
    },
    [deleteMutation],
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href={ROUTES.STUDY} className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Back to Study
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Reviewer Packs</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Curated collections of digests, provisions, and study materials
            </p>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <PlusIcon className="mr-2 size-4" />
            New Pack
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={barSubject} onValueChange={setBarSubject}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All subjects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All subjects</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s.code} value={s.code}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            Failed to load reviewer packs: {error instanceof Error ? error.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      )}

      {!isLoading && packs.length === 0 && (
        <div className="rounded-lg border-2 border-dashed p-12 text-center">
          <p className="text-sm text-muted-foreground">
            No reviewer packs found. Create your first pack to get started.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {packs.map((pack) => (
          <Card key={pack.id} className="transition hover:shadow-sm">
            <CardContent className="flex items-center justify-between p-4">
              <Link href={ROUTES.STUDY_REVIEWER_PACK(pack.id)} className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{pack.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {pack.itemCount} item{pack.itemCount !== 1 ? 's' : ''}
                  </span>
                  {pack.barSubject && (
                    <Badge variant="secondary">{pack.barSubject}</Badge>
                  )}
                  <VisibilityBadge visibility={pack.visibility} />
                  {pack.creator && <span>by {pack.creator.fullName}</span>}
                  <span>{new Date(pack.updatedAt).toLocaleDateString()}</span>
                </div>
                {pack.description && (
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/60">{pack.description}</p>
                )}
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(pack.id)}
                disabled={deleteMutation.isPending}
                className="ml-4 shrink-0 text-destructive hover:text-destructive"
              >
                Delete
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <CreateReviewerPackDialog
        subjects={subjects}
        open={showCreate}
        onClose={() => setShowCreate(false)}
      />
    </div>
  );
}

// -- Create Dialog ------------------------------------------------------------

function CreateReviewerPackDialog({
  subjects,
  open,
  onClose,
}: {
  subjects: { code: string; name: string }[];
  open: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newBarSubject, setNewBarSubject] = useState('none');
  const createMutation = useCreateReviewerPack();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim()) return;

      createMutation.mutate(
        {
          title: title.trim(),
          description: description.trim() || undefined,
          barSubject: newBarSubject !== 'none' ? newBarSubject : undefined,
        },
        {
          onSuccess: () => {
            setTitle('');
            setDescription('');
            setNewBarSubject('none');
            onClose();
          },
        },
      );
    },
    [title, description, newBarSubject, createMutation, onClose],
  );

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Reviewer Pack</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rp-title">Title *</Label>
            <Input
              id="rp-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Obligations & Contracts Reviewer"
              required
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rp-desc">Description</Label>
            <Input
              id="rp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div className="space-y-2">
            <Label>Bar Subject</Label>
            <Select value={newBarSubject} onValueChange={setNewBarSubject}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {createMutation.error && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof Error ? createMutation.error.message : 'Failed to create'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !title.trim()}>
              {createMutation.isPending ? 'Creating...' : 'Create Pack'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
