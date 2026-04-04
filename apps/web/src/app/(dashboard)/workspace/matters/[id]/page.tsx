'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import {
  useMatter,
  useUpdateMatter,
  useDeleteMatter,
  useAddMatterDocument,
  useRemoveMatterDocument,
} from '@/features/workspace/hooks/use-matters';
import {
  useMatterComments,
  useCreateMatterComment,
  useDeleteMatterComment,
} from '@/features/workspace/hooks/use-matter-comments';
import { ShareDialog } from '@/features/workspace/components/share-dialog';
import { MatterDetailSkeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { AlertCircleIcon, ShareIcon, Trash2Icon } from 'lucide-react';
import type {
  MatterDetail,
  MatterDocument,
  MatterComment,
  NoteListItem,
  AddMatterDocumentInput,
  MatterDocumentRole,
} from '@/features/workspace/types';

const STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  active: { variant: 'outline', className: 'border-green-200 bg-green-50 text-green-700' },
  closed: { variant: 'secondary' },
  archived: { variant: 'outline', className: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
};

const ROLE_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  evidence: { variant: 'outline', className: 'border-red-200 bg-red-50 text-red-700' },
  reference: { variant: 'outline', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  pleading: { variant: 'outline', className: 'border-purple-200 bg-purple-50 text-purple-700' },
  research: { variant: 'outline', className: 'border-green-200 bg-green-50 text-green-700' },
  note: { variant: 'secondary' },
};

export default function MatterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const matterId = params['id'] as string;

  const { data: matter, isLoading, error } = useMatter(matterId);
  const deleteMatter = useDeleteMatter();
  const [showShareDialog, setShowShareDialog] = useState(false);

  const handleDelete = useCallback(() => {
    if (!matter) return;
    if (
      window.confirm(
        `Delete "${matter.title}"? This will also remove all attached documents and notes.`,
      )
    ) {
      deleteMatter.mutate(matter.id, {
        onSuccess: () => router.push(ROUTES.WORKSPACE_MATTERS),
      });
    }
  }, [matter, deleteMatter, router]);

  if (isLoading) return <MatterDetailSkeleton />;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon className="size-4" />
        <AlertDescription>
          Failed to load matter: {error instanceof Error ? error.message : 'Unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  if (!matter) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        Matter not found.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="text-sm text-muted-foreground">
        <Link href={ROUTES.WORKSPACE_MATTERS} className="hover:text-foreground">
          Matters
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{matter.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold">{matter.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              variant={STATUS_BADGE[matter.status]?.variant ?? 'secondary'}
              className={STATUS_BADGE[matter.status]?.className}
            >
              {matter.status}
            </Badge>
            {matter.matterType && (
              <Badge variant="secondary" className="capitalize">
                {matter.matterType}
              </Badge>
            )}
            {matter.court && (
              <span className="text-sm text-muted-foreground">{matter.court}</span>
            )}
            <span className="text-sm text-muted-foreground">
              {matter._count.documents} documents, {matter._count.notes} notes
            </span>
          </div>
          {matter.description && (
            <p className="mt-2 text-sm text-muted-foreground">{matter.description}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground/70">
            Created {new Date(matter.createdAt).toLocaleDateString()} by{' '}
            {matter.owner.fullName}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowShareDialog(true)}>
            <ShareIcon className="mr-2 size-4" />
            Share
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={deleteMatter.isPending}
            className="text-destructive hover:text-destructive"
          >
            <Trash2Icon className="mr-2 size-4" />
            Delete
          </Button>
        </div>
      </div>

      <Separator />

      {/* Tabs */}
      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">
            Documents ({matter._count.documents})
          </TabsTrigger>
          <TabsTrigger value="notes">
            Notes ({matter._count.notes})
          </TabsTrigger>
          <TabsTrigger value="comments">Comments</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="documents">
          <DocumentsTab matter={matter} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab matterId={matter.id} notes={matter.notes} />
        </TabsContent>
        <TabsContent value="comments">
          <CommentsTab matterId={matter.id} />
        </TabsContent>
        <TabsContent value="details">
          <DetailsTab matter={matter} />
        </TabsContent>
      </Tabs>

      {/* Share Dialog */}
      {showShareDialog && (
        <ShareDialog
          entityType="matter"
          entityId={matter.id}
          entityTitle={matter.title}
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </div>
  );
}

// -- Documents Tab ------------------------------------------------------------

function DocumentsTab({ matter }: { matter: MatterDetail }) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const removeDocument = useRemoveMatterDocument();

  const handleRemove = useCallback(
    (doc: MatterDocument) => {
      const name =
        doc.title ||
        doc.legalDocument?.title ||
        doc.userUpload?.originalFilename ||
        'this document';
      if (window.confirm(`Remove "${name}" from this matter?`)) {
        removeDocument.mutate({ matterId: matter.id, docId: doc.id });
      }
    },
    [matter.id, removeDocument],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Documents linked to this matter
        </p>
        <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)}>
          Add Document
        </Button>
      </div>

      {matter.documents.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground/70">
          No documents linked yet. Add a corpus document or upload to get started.
        </div>
      )}

      <div className="space-y-2">
        {matter.documents.map((doc) => (
          <Card key={doc.id}>
            <CardContent className="flex items-center justify-between p-3">
              <div className="min-w-0 flex-1">
                {doc.legalDocument ? (
                  <Link
                    href={ROUTES.READER(doc.legalDocument.id)}
                    className="text-sm font-medium hover:underline"
                  >
                    {doc.title || doc.legalDocument.title}
                  </Link>
                ) : doc.userUpload ? (
                  <span className="text-sm font-medium">
                    {doc.title || doc.userUpload.originalFilename || 'Uploaded file'}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {doc.title || 'Unknown document'}
                  </span>
                )}
                <div className="mt-0.5 flex items-center gap-2">
                  <Badge
                    variant={ROLE_BADGE[doc.role]?.variant ?? 'secondary'}
                    className={`text-xs ${ROLE_BADGE[doc.role]?.className ?? ''}`}
                  >
                    {doc.role}
                  </Badge>
                  {doc.legalDocument?.citationText && (
                    <span className="text-xs text-muted-foreground">
                      {doc.legalDocument.citationText}
                    </span>
                  )}
                  {doc.legalDocument?.documentType && (
                    <span className="text-xs capitalize text-muted-foreground">
                      {doc.legalDocument.documentType.replace(/_/g, ' ')}
                    </span>
                  )}
                  {doc.userUpload && (
                    <span className="text-xs capitalize text-muted-foreground">
                      {doc.userUpload.uploadType.replace(/_/g, ' ')}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(doc.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRemove(doc)}
                disabled={removeDocument.isPending}
                className="ml-3 text-destructive hover:text-destructive"
              >
                Remove
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <AddDocumentDialog
        matterId={matter.id}
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
      />
    </div>
  );
}

// -- Add Document Dialog ------------------------------------------------------

function AddDocumentDialog({
  matterId,
  open,
  onOpenChange,
}: {
  matterId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const addDocument = useAddMatterDocument();
  const [mode, setMode] = useState<'corpus' | 'upload'>('corpus');
  const [form, setForm] = useState<AddMatterDocumentInput>({
    legalDocumentId: '',
    userUploadId: '',
    title: '',
    role: 'reference',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const payload: AddMatterDocumentInput & { matterId: string } = {
      matterId,
      role: form.role,
      title: form.title || undefined,
    };

    if (mode === 'corpus' && form.legalDocumentId) {
      payload.legalDocumentId = form.legalDocumentId;
    } else if (mode === 'upload' && form.userUploadId) {
      payload.userUploadId = form.userUploadId;
    } else {
      return;
    }

    try {
      await addDocument.mutateAsync(payload);
      onOpenChange(false);
    } catch {
      // Error handled by mutation state
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Document to Matter</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            variant={mode === 'corpus' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('corpus')}
          >
            Legal Document
          </Button>
          <Button
            type="button"
            variant={mode === 'upload' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMode('upload')}
          >
            User Upload
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'corpus' && (
            <div className="space-y-2">
              <Label htmlFor="doc-id">
                Legal Document ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="doc-id"
                value={form.legalDocumentId}
                onChange={(e) =>
                  setForm({ ...form, legalDocumentId: e.target.value })
                }
                placeholder="Paste document UUID"
                required
              />
              <p className="text-xs text-muted-foreground/70">
                Find document IDs from the search or reader pages.
              </p>
            </div>
          )}

          {mode === 'upload' && (
            <div className="space-y-2">
              <Label htmlFor="upload-id">
                Upload ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="upload-id"
                value={form.userUploadId}
                onChange={(e) =>
                  setForm({ ...form, userUploadId: e.target.value })
                }
                placeholder="Paste upload UUID"
                required
              />
              <p className="text-xs text-muted-foreground/70">
                Find upload IDs from the scans page.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="doc-title">Display Title (optional)</Label>
            <Input
              id="doc-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Override display title"
            />
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <Select
              value={form.role}
              onValueChange={(v) =>
                setForm({ ...form, role: v as MatterDocumentRole })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reference">Reference</SelectItem>
                <SelectItem value="evidence">Evidence</SelectItem>
                <SelectItem value="pleading">Pleading</SelectItem>
                <SelectItem value="research">Research</SelectItem>
                <SelectItem value="note">Note</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {addDocument.error && (
            <p className="text-sm text-destructive">
              {addDocument.error instanceof Error
                ? addDocument.error.message
                : 'Failed to add document'}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={addDocument.isPending}>
              {addDocument.isPending ? 'Adding...' : 'Add Document'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -- Notes Tab ----------------------------------------------------------------

function NotesTab({
  matterId,
  notes,
}: {
  matterId: string;
  notes: NoteListItem[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Recent notes for this matter
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href={`${ROUTES.WORKSPACE_NOTES}?matterId=${matterId}`}>
            View All Notes
          </Link>
        </Button>
      </div>

      {notes.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground/70">
          No notes yet. Create a note from the Notes page and link it to this matter.
        </div>
      )}

      <div className="space-y-2">
        {notes.map((note) => (
          <Card key={note.id} className="transition hover:shadow-sm">
            <CardContent className="p-3">
              <Link href={ROUTES.WORKSPACE_NOTE(note.id)} className="block">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {note.title || 'Untitled Note'}
                  </span>
                  <Badge variant={note.visibility === 'org' ? 'outline' : 'secondary'}
                    className={note.visibility === 'org' ? 'border-blue-200 bg-blue-50 text-blue-700' : ''}
                  >
                    {note.visibility === 'org' ? 'Shared' : 'Private'}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  Updated {new Date(note.updatedAt).toLocaleDateString()}
                </p>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// -- Comments Tab -------------------------------------------------------------

function CommentsTab({ matterId }: { matterId: string }) {
  const { data: comments, isLoading } = useMatterComments(matterId);
  const createComment = useCreateMatterComment();
  const deleteComment = useDeleteMatterComment();
  const [body, setBody] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    try {
      await createComment.mutateAsync({ matterId, body: trimmed });
      setBody('');
    } catch {
      // Error handled by mutation state
    }
  };

  const handleDelete = useCallback(
    (comment: MatterComment) => {
      if (window.confirm('Delete this comment?')) {
        deleteComment.mutate({ matterId, commentId: comment.id });
      }
    },
    [matterId, deleteComment],
  );

  return (
    <div className="space-y-4">
      {/* Comment form */}
      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment..."
          rows={3}
          maxLength={5000}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{body.length}/5000</span>
          <Button
            type="submit"
            size="sm"
            disabled={!body.trim() || createComment.isPending}
          >
            {createComment.isPending ? 'Posting...' : 'Post Comment'}
          </Button>
        </div>
        {createComment.error && (
          <p className="text-sm text-destructive">
            {createComment.error instanceof Error
              ? createComment.error.message
              : 'Failed to post comment'}
          </p>
        )}
      </form>

      <Separator />

      {/* Comments list */}
      {isLoading && (
        <div className="py-4 text-center text-sm text-muted-foreground">
          Loading comments...
        </div>
      )}

      {!isLoading && (!comments || comments.length === 0) && (
        <div className="py-8 text-center text-sm text-muted-foreground/70">
          No comments yet. Start a discussion about this matter.
        </div>
      )}

      <div className="space-y-3">
        {comments?.map((comment) => (
          <Card key={comment.id}>
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {comment.user.fullName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(comment.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {comment.body}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(comment)}
                  disabled={deleteComment.isPending}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// -- Details Tab --------------------------------------------------------------

function DetailsTab({ matter }: { matter: MatterDetail }) {
  const updateMatter = useUpdateMatter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: matter.title,
    description: matter.description ?? '',
    matterType: matter.matterType ?? '',
    court: matter.court ?? '',
    status: matter.status,
  });

  const handleSave = async () => {
    try {
      await updateMatter.mutateAsync({
        id: matter.id,
        title: form.title,
        description: form.description || undefined,
        matterType: form.matterType || undefined,
        court: form.court || undefined,
        status: form.status as 'active' | 'closed' | 'archived',
      });
      setEditing(false);
    } catch {
      // Error handled by mutation state
    }
  };

  if (!editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Matter metadata</p>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
        <Card>
          <CardContent className="p-4">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <DetailField label="Title" value={matter.title} />
              <DetailField label="Status" value={matter.status} capitalize />
              <DetailField label="Type" value={matter.matterType} capitalize />
              <DetailField label="Court" value={matter.court} />
              <DetailField
                label="Created"
                value={new Date(matter.createdAt).toLocaleString()}
              />
              <DetailField
                label="Updated"
                value={new Date(matter.updatedAt).toLocaleString()}
              />
              <DetailField label="Owner" value={matter.owner.fullName} />
              <DetailField
                label="Description"
                value={matter.description}
                fullWidth
              />
            </dl>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Edit matter details</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateMatter.isPending || !form.title.trim()}
          >
            {updateMatter.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
      {updateMatter.error && (
        <p className="text-sm text-destructive">
          {updateMatter.error instanceof Error
            ? updateMatter.error.message
            : 'Failed to save'}
        </p>
      )}
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Title</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v })}
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
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.matterType || 'none'}
                onValueChange={(v) => setForm({ ...form, matterType: v === 'none' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="civil">Civil</SelectItem>
                  <SelectItem value="criminal">Criminal</SelectItem>
                  <SelectItem value="labor">Labor</SelectItem>
                  <SelectItem value="commercial">Commercial</SelectItem>
                  <SelectItem value="tax">Tax</SelectItem>
                  <SelectItem value="admin">Administrative</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Court</Label>
              <Input
                value={form.court}
                onChange={(e) => setForm({ ...form, court: e.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Description</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// -- Helper Components --------------------------------------------------------

function DetailField({
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
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-sm ${capitalize ? 'capitalize' : ''}`}>
        {value || <span className="text-muted-foreground/50">-</span>}
      </dd>
    </div>
  );
}
