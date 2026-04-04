'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

import { useNotes, useCreateNote, useDeleteNote } from '@/features/workspace/hooks/use-notes';
import { NoteListSkeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
import { PlusIcon, SearchIcon, AlertCircleIcon, InfoIcon } from 'lucide-react';
import type { Note, CreateNoteInput, NoteVisibility } from '@/features/workspace/types';

export default function NotesPage() {
  const searchParams = useSearchParams();
  const matterIdFromUrl = searchParams.get('matterId') ?? undefined;

  const [visibility, setVisibility] = useState('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const { data, isLoading, error } = useNotes({
    matterId: matterIdFromUrl,
    visibility: visibility !== 'all' ? visibility : undefined,
    search: search || undefined,
  });
  const deleteNote = useDeleteNote();

  const notes = data?.data ?? [];
  const meta = data?.meta;

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setSearch(searchInput);
    },
    [searchInput],
  );

  const handleDelete = useCallback(
    (note: Note) => {
      const name = note.title || 'this untitled note';
      if (window.confirm(`Delete "${name}"?`)) {
        deleteNote.mutate(note.id);
      }
    },
    [deleteNote],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {matterIdFromUrl
              ? 'Notes linked to this matter'
              : 'Your personal and shared notes'}
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <PlusIcon className="mr-2 size-4" />
          New Note
        </Button>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <form onSubmit={handleSearch} className="flex flex-1 gap-2">
          <Input
            type="text"
            placeholder="Search notes..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" variant="outline">
            <SearchIcon className="mr-2 size-4" />
            Search
          </Button>
        </form>
        <Select value={visibility} onValueChange={setVisibility}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All visibility" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All visibility</SelectItem>
            <SelectItem value="private">Private</SelectItem>
            <SelectItem value="org">Organization</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {matterIdFromUrl && (
        <Alert>
          <InfoIcon className="size-4" />
          <AlertDescription>
            Filtered by matter.{' '}
            <Link
              href={ROUTES.WORKSPACE_NOTES}
              className="font-medium underline"
            >
              Show all notes
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {isLoading && <NoteListSkeleton />}

      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            Failed to load notes: {error instanceof Error ? error.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && notes.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">No notes found.</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Create your first note to start taking research notes.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            onDelete={() => handleDelete(note)}
            isDeleting={deleteNote.isPending}
          />
        ))}
      </div>

      {meta?.hasNext && (
        <p className="text-center text-sm text-muted-foreground/70">
          More notes available.
        </p>
      )}

      <CreateNoteDialog
        defaultMatterId={matterIdFromUrl}
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
      />
    </div>
  );
}

// -- Note Card ----------------------------------------------------------------

function NoteCard({
  note,
  onDelete,
  isDeleting,
}: {
  note: Note;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Link
              href={ROUTES.WORKSPACE_NOTE(note.id)}
              className="text-sm font-semibold hover:underline"
            >
              {note.title || 'Untitled Note'}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Badge
                variant={note.visibility === 'org' ? 'outline' : 'secondary'}
                className={note.visibility === 'org' ? 'border-blue-200 bg-blue-50 text-blue-700' : ''}
              >
                {note.visibility === 'org' ? 'Shared' : 'Private'}
              </Badge>
              {note.matter && (
                <Link href={ROUTES.WORKSPACE_MATTER(note.matter.id)}>
                  <Badge variant="secondary" className="hover:bg-accent">
                    {note.matter.title}
                  </Badge>
                </Link>
              )}
              <span className="text-xs text-muted-foreground">by {note.user.fullName}</span>
              <span className="text-xs text-muted-foreground">
                Updated {new Date(note.updatedAt).toLocaleDateString()}
              </span>
            </div>
          </div>
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
      </CardContent>
    </Card>
  );
}

// -- Create Note Dialog -------------------------------------------------------

function CreateNoteDialog({
  defaultMatterId,
  open,
  onOpenChange,
}: {
  defaultMatterId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createNote = useCreateNote();
  const [form, setForm] = useState({
    title: '',
    matterId: defaultMatterId ?? '',
    visibility: 'private' as NoteVisibility,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const input: CreateNoteInput = {
      title: form.title || undefined,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
      matterId: form.matterId || undefined,
      visibility: form.visibility,
    };

    try {
      await createNote.mutateAsync(input);
      setForm({ title: '', matterId: defaultMatterId ?? '', visibility: 'private' });
      onOpenChange(false);
    } catch {
      // Error handled by mutation state
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="note-title">Title</Label>
            <Input
              id="note-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Note title (optional)"
              maxLength={500}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note-matter">Link to Matter (optional)</Label>
            <Input
              id="note-matter"
              value={form.matterId}
              onChange={(e) => setForm({ ...form, matterId: e.target.value })}
              placeholder="Matter UUID"
            />
          </div>
          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select
              value={form.visibility}
              onValueChange={(v) =>
                setForm({ ...form, visibility: v as NoteVisibility })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private (only you)</SelectItem>
                <SelectItem value="org">Organization (team visible)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {createNote.error && (
            <p className="text-sm text-destructive">
              {createNote.error instanceof Error
                ? createNote.error.message
                : 'Failed to create note'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createNote.isPending}>
              {createNote.isPending ? 'Creating...' : 'Create Note'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
