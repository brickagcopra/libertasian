'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Trash2, Check, X, Plus, Link as LinkIcon } from 'lucide-react';

import {
  useDoctrine,
  useUpdateDoctrine,
  useDeleteDoctrine,
  useApproveDoctrine,
  useRejectDoctrine,
  useCreateDoctrineLink,
  useDeleteDoctrineLink,
} from '@/features/admin/hooks/use-admin';
import type { DoctrineLinkListItem } from '@/features/admin/types';
import { AdminCardSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const DOCTRINE_TYPES = [
  { value: 'ratio_decidendi', label: 'Ratio Decidendi' },
  { value: 'obiter_dictum', label: 'Obiter Dictum' },
  { value: 'stare_decisis', label: 'Stare Decisis' },
  { value: 'statutory_construction', label: 'Statutory Construction' },
  { value: 'constitutional_interpretation', label: 'Constitutional Interpretation' },
  { value: 'procedural_rule', label: 'Procedural Rule' },
  { value: 'evidentiary_rule', label: 'Evidentiary Rule' },
  { value: 'other', label: 'Other' },
];

const LINK_TYPES = [
  { value: 'extends', label: 'Extends' },
  { value: 'overrules', label: 'Overrules' },
  { value: 'distinguishes', label: 'Distinguishes' },
  { value: 'applies', label: 'Applies' },
  { value: 'clarifies', label: 'Clarifies' },
];

const doctrineTypeVariants: Record<string, string> = {
  ratio_decidendi: 'bg-blue-100 text-blue-700',
  obiter_dictum: 'bg-purple-100 text-purple-700',
  stare_decisis: 'bg-indigo-100 text-indigo-700',
  statutory_construction: 'bg-teal-100 text-teal-700',
  constitutional_interpretation: 'bg-amber-100 text-amber-700',
  procedural_rule: 'bg-cyan-100 text-cyan-700',
  evidentiary_rule: 'bg-orange-100 text-orange-700',
  other: 'bg-muted text-muted-foreground',
};

const reviewStatusVariants: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_review: 'bg-blue-100 text-blue-700',
  needs_human_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
};

const linkTypeVariants: Record<string, string> = {
  extends: 'bg-blue-100 text-blue-700',
  overrules: 'bg-red-100 text-red-700',
  distinguishes: 'bg-purple-100 text-purple-700',
  applies: 'bg-green-100 text-green-700',
  clarifies: 'bg-teal-100 text-teal-700',
};

export default function DoctrineDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: doctrine, isLoading, error } = useDoctrine(id);
  const updateDoctrine = useUpdateDoctrine();
  const deleteDoctrine = useDeleteDoctrine();
  const approveDoctrine = useApproveDoctrine();
  const rejectDoctrine = useRejectDoctrine();

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [editType, setEditType] = useState('');
  const [editConfidence, setEditConfidence] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const startEdit = () => {
    if (!doctrine) return;
    setEditText(doctrine.text);
    setEditType(doctrine.doctrineType);
    setEditConfidence(doctrine.confidence !== null ? String(doctrine.confidence) : '');
    setEditing(true);
  };

  const handleUpdate = async () => {
    if (!editText.trim()) return;
    try {
      await updateDoctrine.mutateAsync({
        id,
        data: {
          text: editText.trim(),
          doctrineType: editType,
          confidence: editConfidence ? Number(editConfidence) : undefined,
        },
      });
      setEditing(false);
      setActionMsg('Updated.');
    } catch {
      setActionMsg('Update failed.');
    }
  };

  const handleDelete = async () => {
    try {
      await deleteDoctrine.mutateAsync(id);
      router.push('/admin/doctrines');
    } catch {
      setActionMsg('Delete failed.');
    }
  };

  const handleApprove = async () => {
    try {
      await approveDoctrine.mutateAsync(id);
      setActionMsg('Approved.');
    } catch {
      setActionMsg('Approve failed.');
    }
  };

  const handleReject = async () => {
    try {
      await rejectDoctrine.mutateAsync(id);
      setActionMsg('Rejected.');
    } catch {
      setActionMsg('Reject failed.');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <AdminCardSkeleton />
        <AdminCardSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          {error instanceof Error ? error.message : 'Failed to load doctrine'}
        </AlertDescription>
      </Alert>
    );
  }

  if (!doctrine) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Doctrine not found.</p>;
  }

  const isReviewable = doctrine.reviewStatus !== 'approved' && doctrine.reviewStatus !== 'rejected' && doctrine.reviewStatus !== 'failed';

  const confidenceColor =
    doctrine.confidence !== null
      ? doctrine.confidence >= 0.8
        ? 'bg-green-100 text-green-700'
        : doctrine.confidence >= 0.5
          ? 'bg-yellow-100 text-yellow-700'
          : 'bg-red-100 text-red-700'
      : '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {(doctrine.doctrineType ?? 'Doctrine').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">ID: {doctrine.id}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/doctrines">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to List
          </Link>
        </Button>
      </div>

      {actionMsg && (
        <Alert>
          <AlertDescription className="text-green-700">{actionMsg}</AlertDescription>
        </Alert>
      )}

      {/* Doctrine Content */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge className={doctrineTypeVariants[doctrine.doctrineType ?? ''] ?? 'bg-muted text-muted-foreground'}>
              {(doctrine.doctrineType ?? 'unknown').replace(/_/g, ' ')}
            </Badge>
            {doctrine.confidence !== null && (
              <Badge className={confidenceColor}>
                Confidence: {(doctrine.confidence * 100).toFixed(0)}%
              </Badge>
            )}
            <Badge className={reviewStatusVariants[doctrine.reviewStatus ?? ''] ?? 'bg-muted text-muted-foreground'}>
              {(doctrine.reviewStatus ?? 'unknown').replace(/_/g, ' ')}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Created {new Date(doctrine.createdAt).toLocaleDateString()}
            </span>
            <span className="text-xs text-muted-foreground">
              Updated {new Date(doctrine.updatedAt).toLocaleDateString()}
            </span>
          </div>

          {editing ? (
            <div className="space-y-3">
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={5}
              />
              <div className="flex gap-3">
                <Select value={editType} onValueChange={setEditType}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCTRINE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  value={editConfidence}
                  onChange={(e) => setEditConfidence(e.target.value)}
                  placeholder="Confidence (0-1)"
                  step="0.01"
                  min="0"
                  max="1"
                  className="w-40"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleUpdate} disabled={updateDoctrine.isPending}>
                  {updateDoctrine.isPending ? 'Saving...' : 'Save'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border-l-4 border-blue-500 bg-blue-50/50 p-4">
                <p className="text-sm leading-relaxed text-gray-800 italic">
                  &ldquo;{doctrine.text}&rdquo;
                </p>
              </div>
              {doctrine.normalizedText && doctrine.normalizedText !== doctrine.text && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Normalized: {doctrine.normalizedText}
                </p>
              )}
            </>
          )}

          {/* Source Info */}
          <Separator className="my-4" />
          <div className="mt-4 rounded-md bg-gray-50 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Source</h3>
            {doctrine.legalDocument && (
              <p className="text-xs text-muted-foreground">
                Document:{' '}
                <Link href={`/reader/${doctrine.legalDocument.id}`} className="text-blue-600 hover:underline">
                  {doctrine.legalDocument.title}
                </Link>
                {doctrine.legalDocument.grNo && ` (${doctrine.legalDocument.grNo})`}
                {doctrine.legalDocument.court && ` — ${doctrine.legalDocument.court}`}
                {doctrine.legalDocument.decisionDate && `, ${new Date(doctrine.legalDocument.decisionDate).toLocaleDateString()}`}
              </p>
            )}
            {doctrine.digest && (
              <p className="mt-1 text-xs text-muted-foreground">
                Digest:{' '}
                <Link href={`/digests/${doctrine.digest.id}`} className="text-blue-600 hover:underline">
                  {doctrine.digest.title}
                </Link>
              </p>
            )}
            {doctrine.sourceSection && (
              <p className="mt-1 text-xs text-muted-foreground">
                Section: {doctrine.sourceSection.sectionType}
                {doctrine.sourceSection.sectionLabel && ` — ${doctrine.sourceSection.sectionLabel}`}
              </p>
            )}
          </div>

          {/* Actions */}
          <Separator className="my-4" />
          <div className="flex flex-wrap gap-2">
            {!editing && (
              <Button variant="outline" size="sm" onClick={startEdit}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit
              </Button>
            )}
            {isReviewable && (
              <>
                <Button size="sm" onClick={handleApprove} disabled={approveDoctrine.isPending} className="bg-green-600 hover:bg-green-700">
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={handleReject} disabled={rejectDoctrine.isPending}>
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Reject
                </Button>
              </>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="border-destructive text-destructive hover:bg-destructive/10" disabled={deleteDoctrine.isPending}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Doctrine</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. Are you sure you want to delete this doctrine?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* Doctrine Links */}
      <DoctrineLinksSection
        doctrineId={id}
        linksFrom={doctrine.linksFrom ?? []}
        linksTo={doctrine.linksTo ?? []}
      />
    </div>
  );
}

// ---- Doctrine Links Section ----

function DoctrineLinksSection({
  doctrineId,
  linksFrom,
  linksTo,
}: {
  doctrineId: string;
  linksFrom: DoctrineLinkListItem[];
  linksTo: DoctrineLinkListItem[];
}) {
  const createLink = useCreateDoctrineLink();
  const deleteLink = useDeleteDoctrineLink();
  const [showAddLink, setShowAddLink] = useState(false);
  const [targetDoctrineId, setTargetDoctrineId] = useState('');
  const [linkType, setLinkType] = useState('extends');

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetDoctrineId.trim()) return;
    try {
      await createLink.mutateAsync({
        fromDoctrineId: doctrineId,
        toDoctrineId: targetDoctrineId.trim(),
        linkType,
      });
      setTargetDoctrineId('');
      setShowAddLink(false);
    } catch {
      // error shown inline
    }
  };

  const handleDeleteLink = async (linkId: string) => {
    await deleteLink.mutateAsync(linkId);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">
          <LinkIcon className="mr-2 inline-block h-4 w-4" />
          Doctrine Links
        </CardTitle>
        <Button variant="outline" size="sm" onClick={() => setShowAddLink(!showAddLink)}>
          {showAddLink ? 'Cancel' : (
            <>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add Link
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {showAddLink && (
          <form onSubmit={handleAddLink} className="mb-4 space-y-3 rounded-md border p-3">
            <div className="flex gap-3">
              <Input
                value={targetDoctrineId}
                onChange={(e) => setTargetDoctrineId(e.target.value)}
                placeholder="Target Doctrine ID"
                required
                className="flex-1"
              />
              <Select value={linkType} onValueChange={setLinkType}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_TYPES.map((lt) => (
                    <SelectItem key={lt.value} value={lt.value}>{lt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" size="sm" disabled={createLink.isPending}>
                {createLink.isPending ? 'Adding...' : 'Add'}
              </Button>
            </div>
            {createLink.isError && (
              <p className="text-sm text-destructive">
                {createLink.error instanceof Error ? createLink.error.message : 'Failed to add link'}
              </p>
            )}
          </form>
        )}

        {/* Outgoing Links */}
        <div>
          <h3 className="mb-2 text-sm font-medium">
            Outgoing Links ({linksFrom.length})
          </h3>
          {linksFrom.length > 0 ? (
            <div className="space-y-2">
              {linksFrom.map((link) => (
                <LinkCard
                  key={link.id}
                  link={link}
                  direction="to"
                  onDelete={() => handleDeleteLink(link.id)}
                  isDeleting={deleteLink.isPending}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No outgoing links.</p>
          )}
        </div>

        <Separator className="my-4" />

        {/* Incoming Links */}
        <div>
          <h3 className="mb-2 text-sm font-medium">
            Incoming Links ({linksTo.length})
          </h3>
          {linksTo.length > 0 ? (
            <div className="space-y-2">
              {linksTo.map((link) => (
                <LinkCard
                  key={link.id}
                  link={link}
                  direction="from"
                  onDelete={() => handleDeleteLink(link.id)}
                  isDeleting={deleteLink.isPending}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No incoming links.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Link Card ----

function LinkCard({
  link,
  direction,
  onDelete,
  isDeleting,
}: {
  link: DoctrineLinkListItem;
  direction: 'from' | 'to';
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const relatedDoctrine = direction === 'to' ? link.toDoctrine : link.fromDoctrine;
  const relatedId = direction === 'to' ? link.toDoctrineId : link.fromDoctrineId;

  return (
    <Card className="bg-muted">
      <CardContent className="flex items-start justify-between gap-2 p-2">
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <Badge className={linkTypeVariants[link.linkType] ?? 'bg-muted text-muted-foreground'}>
              {link.linkType}
            </Badge>
            {link.confidence !== null && (
              <span className="text-xs text-muted-foreground">{(link.confidence * 100).toFixed(0)}%</span>
            )}
          </div>
          {relatedDoctrine ? (
            <Link
              href={`/admin/doctrines/${relatedId}`}
              className="mt-1 block text-xs hover:text-blue-600 line-clamp-2"
            >
              {relatedDoctrine.text}
            </Link>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">Doctrine {relatedId.slice(0, 8)}...</p>
          )}
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" disabled={isDeleting} className="h-7 text-xs text-destructive hover:text-destructive">
              Remove
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Link</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove this doctrine link?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground">
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
