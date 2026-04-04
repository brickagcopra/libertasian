'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { useNote, useUpdateNote, useDeleteNote } from '@/features/workspace/hooks/use-notes';
import { ROUTES } from '@/lib/constants';
import { Skeleton } from '@/components/ui/skeleton';

const TiptapEditor = dynamic(
  () => import('@/components/editor/tiptap-editor').then((mod) => mod.TiptapEditor),
  { ssr: false, loading: () => <Skeleton className="h-40 w-full" /> },
);
const TiptapViewer = dynamic(
  () => import('@/components/editor/tiptap-editor').then((mod) => mod.TiptapViewer),
  { ssr: false, loading: () => <Skeleton className="h-24 w-full" /> },
);
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircleIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import type { NoteVisibility } from '@/features/workspace/types';

export default function NoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const noteId = params['id'] as string;

  const { data: note, isLoading, error } = useNote(noteId);
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [noteVisibility, setNoteVisibility] = useState<NoteVisibility>('private');
  const bodyRef = useRef<Record<string, unknown> | null>(null);

  const startEditing = useCallback(() => {
    if (!note) return;
    setTitle(note.title ?? '');
    bodyRef.current = note.body;
    setNoteVisibility(note.visibility as NoteVisibility);
    setEditing(true);
  }, [note]);

  const handleSave = async () => {
    try {
      await updateNote.mutateAsync({
        id: noteId,
        title: title || undefined,
        body: bodyRef.current ?? { type: 'doc', content: [{ type: 'paragraph' }] },
        visibility: noteVisibility,
      });
      setEditing(false);
    } catch {
      // Error handled by mutation state
    }
  };

  const handleDelete = useCallback(() => {
    if (!note) return;
    const name = note.title || 'this note';
    if (window.confirm(`Delete "${name}"?`)) {
      deleteNote.mutate(noteId, {
        onSuccess: () => router.push(ROUTES.WORKSPACE_NOTES),
      });
    }
  }, [note, noteId, deleteNote, router]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon className="size-4" />
        <AlertDescription>
          Failed to load note: {error instanceof Error ? error.message : 'Unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  if (!note) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">Note not found.</div>
    );
  }

  const isEmptyBody =
    !note.body ||
    !Array.isArray((note.body as Record<string, unknown>)['content']) ||
    ((note.body as Record<string, unknown>)['content'] as unknown[]).length === 0;

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-muted-foreground">
        <Link href={ROUTES.WORKSPACE_NOTES} className="hover:text-foreground">
          Notes
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{note.title || 'Untitled'}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title"
              className="text-2xl font-bold"
            />
          ) : (
            <h1 className="text-2xl font-bold">
              {note.title || 'Untitled Note'}
            </h1>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              variant={note.visibility === 'org' ? 'outline' : 'secondary'}
              className={note.visibility === 'org' ? 'border-blue-200 bg-blue-50 text-blue-700' : ''}
            >
              {note.visibility === 'org' ? 'Shared' : 'Private'}
            </Badge>
            {note.matter && (
              <Link href={ROUTES.WORKSPACE_MATTER(note.matter.id)}>
                <Badge variant="secondary" className="hover:bg-accent">
                  Matter: {note.matter.title}
                </Badge>
              </Link>
            )}
            <span className="text-sm text-muted-foreground">by {note.user.fullName}</span>
            <span className="text-sm text-muted-foreground">
              Updated {new Date(note.updatedAt).toLocaleString()}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {editing ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={updateNote.isPending}
              >
                {updateNote.isPending ? 'Saving...' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={startEditing}>
                <PencilIcon className="mr-2 size-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={deleteNote.isPending}
                className="text-destructive hover:text-destructive"
              >
                <Trash2Icon className="mr-2 size-4" />
                Delete
              </Button>
            </>
          )}
        </div>
      </div>

      <Separator />

      {/* Visibility toggle when editing */}
      {editing && (
        <div className="flex items-center gap-3">
          <Label>Visibility:</Label>
          <Select
            value={noteVisibility}
            onValueChange={(v) => setNoteVisibility(v as NoteVisibility)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="org">Organization</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {updateNote.error && (
        <p className="text-sm text-destructive">
          {updateNote.error instanceof Error
            ? updateNote.error.message
            : 'Failed to save note'}
        </p>
      )}

      {/* Note Body */}
      {editing ? (
        <TiptapEditor
          content={bodyRef.current ?? note.body}
          editable
          placeholder="Start writing your note..."
          onChange={(json) => {
            bodyRef.current = json;
          }}
        />
      ) : isEmptyBody ? (
        <Card>
          <CardContent className="min-h-[300px] p-6">
            <p className="text-sm italic text-muted-foreground">
              This note is empty. Click Edit to start writing.
            </p>
          </CardContent>
        </Card>
      ) : (
        <TiptapViewer content={note.body} />
      )}
    </div>
  );
}
