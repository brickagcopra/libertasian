'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Sparkles, Check, X } from 'lucide-react';

import {
  useDoctrines,
  useExtractDoctrines,
  useApproveDoctrine,
  useRejectDoctrine,
  useCreateDoctrine,
} from '@/features/admin/hooks/use-admin';
import type { DoctrineListItem } from '@/features/admin/types';
import { AdminListSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const DOCTRINE_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'ratio_decidendi', label: 'Ratio Decidendi' },
  { value: 'obiter_dictum', label: 'Obiter Dictum' },
  { value: 'stare_decisis', label: 'Stare Decisis' },
  { value: 'statutory_construction', label: 'Statutory Construction' },
  { value: 'constitutional_interpretation', label: 'Constitutional Interpretation' },
  { value: 'procedural_rule', label: 'Procedural Rule' },
  { value: 'evidentiary_rule', label: 'Evidentiary Rule' },
  { value: 'other', label: 'Other' },
];

const REVIEW_STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'needs_human_review', label: 'Needs Human Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
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

export default function DoctrinesPage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);
  const [extractDocId, setExtractDocId] = useState('');

  const { data, isLoading, error } = useDoctrines({
    doctrineType: typeFilter || undefined,
    reviewStatus: statusFilter || undefined,
    cursor,
  });
  const extract = useExtractDoctrines();

  const handleExtract = () => {
    if (!extractDocId.trim()) return;
    extract.mutate(extractDocId.trim());
    setExtractDocId('');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Doctrine Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage extracted legal doctrines and their relationships
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
      </div>

      {/* Extraction Action */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-2 text-sm font-medium">Trigger Doctrine Extraction</p>
          <div className="flex gap-2">
            <Input
              value={extractDocId}
              onChange={(e) => setExtractDocId(e.target.value)}
              placeholder="Document ID"
              className="flex-1"
            />
            <Button
              onClick={handleExtract}
              disabled={extract.isPending || !extractDocId.trim()}
              size="sm"
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {extract.isPending ? 'Extracting...' : 'Extract'}
            </Button>
          </div>
          {extract.isSuccess && (
            <p className="mt-2 text-sm text-green-700">
              Extraction {extract.data.status}: {extract.data.doctrinesExtracted} doctrines from &ldquo;{extract.data.documentTitle}&rdquo;
            </p>
          )}
          {extract.isError && (
            <p className="mt-2 text-sm text-destructive">
              {extract.error instanceof Error ? extract.error.message : 'Extraction failed'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Create Doctrine */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Create Doctrine
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Doctrine</DialogTitle>
          </DialogHeader>
          <CreateDoctrineForm onDone={() => setShowCreate(false)} />
        </DialogContent>
      </Dialog>

      {/* Filters */}
      <div className="flex gap-3">
        <Select
          value={typeFilter || '__all__'}
          onValueChange={(val) => { setTypeFilter(val === '__all__' ? '' : val); setCursor(undefined); }}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            {DOCTRINE_TYPES.map((t) => (
              <SelectItem key={t.value || '__all__'} value={t.value || '__all__'}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter || '__all__'}
          onValueChange={(val) => { setStatusFilter(val === '__all__' ? '' : val); setCursor(undefined); }}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            {REVIEW_STATUSES.map((s) => (
              <SelectItem key={s.value || '__all__'} value={s.value || '__all__'}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load doctrines'}
          </AlertDescription>
        </Alert>
      )}

      {/* Results */}
      {isLoading ? (
        <AdminListSkeleton count={5} />
      ) : data && data.items.length > 0 ? (
        <div className="space-y-3">
          {data.items.map((doc) => (
            <DoctrineCard key={doc.id} doctrine={doc} />
          ))}

          {data.meta.hasNext && data.meta.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={() => setCursor(data.meta.nextCursor)}>
                Load More
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">No doctrines found.</p>
      )}
    </div>
  );
}

// ---- Doctrine Card ----

function DoctrineCard({ doctrine }: { doctrine: DoctrineListItem }) {
  const approve = useApproveDoctrine();
  const reject = useRejectDoctrine();
  const [actionMsg, setActionMsg] = useState('');

  const handleApprove = async () => {
    try {
      await approve.mutateAsync(doctrine.id);
      setActionMsg('Approved.');
    } catch {
      setActionMsg('Approve failed.');
    }
  };

  const handleReject = async () => {
    try {
      await reject.mutateAsync(doctrine.id);
      setActionMsg('Rejected.');
    } catch {
      setActionMsg('Reject failed.');
    }
  };

  if (actionMsg) {
    return (
      <Card className="bg-muted">
        <CardContent className="px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Doctrine #{doctrine.id.slice(0, 8)} — {actionMsg}
          </p>
        </CardContent>
      </Card>
    );
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
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <Link
            href={`/admin/doctrines/${doctrine.id}`}
            className="flex-1 text-left hover:opacity-80"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={doctrineTypeVariants[doctrine.doctrineType ?? ''] ?? 'bg-muted text-muted-foreground'}>
                {(doctrine.doctrineType ?? 'unknown').replace(/_/g, ' ')}
              </Badge>
              {doctrine.confidence !== null && (
                <Badge className={confidenceColor}>
                  {(doctrine.confidence * 100).toFixed(0)}%
                </Badge>
              )}
              <Badge className={reviewStatusVariants[doctrine.reviewStatus ?? ''] ?? 'bg-muted text-muted-foreground'}>
                {(doctrine.reviewStatus ?? 'unknown').replace(/_/g, ' ')}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(doctrine.createdAt).toLocaleDateString()}
              </span>
            </div>
            <p className="mt-2 text-sm line-clamp-3">{doctrine.text}</p>
            {doctrine.legalDocument && (
              <p className="mt-1 text-xs text-muted-foreground">
                Source: {doctrine.legalDocument.title}
                {doctrine.legalDocument.grNo && ` (${doctrine.legalDocument.grNo})`}
              </p>
            )}
          </Link>

          {isReviewable && (
            <div className="flex shrink-0 gap-1">
              <Button
                size="sm"
                onClick={handleApprove}
                disabled={approve.isPending}
                className="h-7 bg-green-600 hover:bg-green-700"
              >
                <Check className="mr-1 h-3 w-3" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleReject}
                disabled={reject.isPending}
                className="h-7"
              >
                <X className="mr-1 h-3 w-3" />
                Reject
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---- Create Doctrine Form ----

function CreateDoctrineForm({ onDone }: { onDone: () => void }) {
  const create = useCreateDoctrine();
  const [text, setText] = useState('');
  const [doctrineType, setDoctrineType] = useState('ratio_decidendi');
  const [legalDocumentId, setLegalDocumentId] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await create.mutateAsync({
        text: text.trim(),
        doctrineType,
        legalDocumentId: legalDocumentId.trim() || undefined,
      });
      onDone();
    } catch {
      // error shown inline
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label>Doctrine Text</Label>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          required
          className="mt-1"
        />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <Label>Type</Label>
          <Select value={doctrineType} onValueChange={setDoctrineType}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCTRINE_TYPES.filter((t) => t.value).map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <Label>Document ID (optional)</Label>
          <Input
            value={legalDocumentId}
            onChange={(e) => setLegalDocumentId(e.target.value)}
            placeholder="UUID"
            className="mt-1"
          />
        </div>
      </div>
      {create.isError && (
        <p className="text-sm text-destructive">
          {create.error instanceof Error ? create.error.message : 'Create failed'}
        </p>
      )}
      <Button type="submit" size="sm" disabled={create.isPending || !text.trim()}>
        {create.isPending ? 'Creating...' : 'Create'}
      </Button>
    </form>
  );
}
