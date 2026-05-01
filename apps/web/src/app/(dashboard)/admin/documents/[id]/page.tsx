'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle,
  ShieldAlert,
  FlagIcon,
} from 'lucide-react';

import {
  useAdminDocument,
  useAdminDocumentSections,
  usePublishDocument,
  useQuarantineDocument,
  type AdminDocumentSection,
} from '@/features/admin/hooks/use-admin-documents';
import { useEditorialFlags } from '@/features/admin/hooks/use-admin';
import { ConfirmActionDialog } from '@/features/admin/components/confirm-action-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AnimatedAlert } from '@/components/ui/animated-alert';
import { AdminCardSkeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const STATUS_VARIANT: Record<string, string> = {
  published: 'bg-green-100 text-green-700',
  draft: 'bg-muted text-muted-foreground',
  unpublished: 'bg-yellow-100 text-yellow-700',
  archived: 'bg-red-100 text-red-700',
};

const TRUST_LEVEL_VARIANT: Record<string, string> = {
  official: 'bg-green-100 text-green-700',
  semi_official: 'bg-blue-100 text-blue-700',
  editorial: 'bg-yellow-100 text-yellow-700',
  community: 'bg-muted text-muted-foreground',
};

const FLAG_SEVERITY_VARIANT: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-blue-100 text-blue-700',
};

export default function AdminDocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.['id'] ?? '';

  const { data: doc, isLoading, error } = useAdminDocument(id);
  const { data: sections } = useAdminDocumentSections(id);
  const { data: openFlags } = useEditorialFlags('open');

  const publish = usePublishDocument();
  const quarantine = useQuarantineDocument();

  const [confirmOpen, setConfirmOpen] = useState<'publish' | 'quarantine' | null>(null);
  const [actionMsg, setActionMsg] = useState<
    { type: 'success' | 'error'; text: string } | null
  >(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [quarantineError, setQuarantineError] = useState<string | null>(null);

  const documentFlags = useMemo(
    () => (openFlags ?? []).filter((f) => f.legalDocumentId === id),
    [openFlags, id],
  );

  const openHighFlags = documentFlags.filter((f) => f.severity === 'high');
  const publishBlocked = openHighFlags.length > 0;

  const [showAllSections, setShowAllSections] = useState(false);
  const visibleSections = useMemo(() => {
    if (!sections) return [];
    return showAllSections ? sections : sections.slice(0, 5);
  }, [sections, showAllSections]);

  const handlePublishConfirm = async () => {
    setPublishError(null);
    try {
      await publish.mutateAsync(id);
      setConfirmOpen(null);
      setActionMsg({ type: 'success', text: 'Document published. Derivative jobs enqueued.' });
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to publish document.');
    }
  };

  const handleQuarantineConfirm = async () => {
    setQuarantineError(null);
    try {
      await quarantine.mutateAsync(id);
      setConfirmOpen(null);
      setActionMsg({ type: 'success', text: 'Document quarantined.' });
    } catch (err) {
      setQuarantineError(err instanceof Error ? err.message : 'Failed to quarantine document.');
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/documents">
            <ArrowLeft className="mr-1.5 size-4" />
            Back to Documents
          </Link>
        </Button>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <AdminCardSkeleton />
            <AdminCardSkeleton />
          </div>
          <div className="space-y-4">
            <AdminCardSkeleton />
            <AdminCardSkeleton />
          </div>
        </div>
      </div>
    );
  }

  if (error || !doc) {
    const isNotFound =
      (error instanceof Error && /not found/i.test(error.message)) || !doc;
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/documents">
            <ArrowLeft className="mr-1.5 size-4" />
            Back to Documents
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>
            {isNotFound
              ? 'Document not found. It may have been deleted or you may not have access.'
              : error instanceof Error
                ? error.message
                : 'Failed to load document.'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const canPublish = doc.status !== 'published';
  const canQuarantine = doc.status !== 'archived';

  const decisionDate = doc.decisionDate
    ? new Date(doc.decisionDate).toLocaleDateString()
    : null;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <Link href="/admin/documents" className="hover:text-foreground">
            Documents
          </Link>
          <span className="mx-2" aria-hidden>
            /
          </span>
          <span className="text-foreground" title={doc.title}>
            {doc.title.length > 60 ? `${doc.title.slice(0, 60)}…` : doc.title}
          </span>
        </nav>

        <AnimatedAlert message={actionMsg} />

        {/* Header card */}
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold leading-tight">{doc.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {doc.citationText && <span>{doc.citationText}</span>}
                  {doc.grNo && <span>· {doc.grNo}</span>}
                  {doc.court && <span>· {doc.court}</span>}
                  {decisionDate && <span>· decided {decisionDate}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  className={
                    STATUS_VARIANT[doc.status] ?? 'bg-muted text-muted-foreground'
                  }
                  aria-label={`Status: ${doc.status}`}
                >
                  {doc.status}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sticky action bar */}
        <div className="sticky top-0 z-20 -mx-2 flex flex-wrap items-center justify-end gap-2 overflow-x-auto rounded-md border bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          {canPublish && (
            <PublishButton
              blocked={publishBlocked}
              blockedCount={openHighFlags.length}
              docId={id}
              isPending={publish.isPending}
              onClick={() => {
                setPublishError(null);
                setConfirmOpen('publish');
              }}
            />
          )}
          {canQuarantine && (
            <Button
              variant="destructive"
              onClick={() => {
                setQuarantineError(null);
                setConfirmOpen('quarantine');
              }}
              disabled={quarantine.isPending || publish.isPending}
              aria-label="Quarantine document"
            >
              <ShieldAlert className="mr-1.5 size-4" aria-hidden />
              {quarantine.isPending ? 'Quarantining…' : 'Quarantine'}
            </Button>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Metadata card */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Metadata</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DefRow label="Document type" value={doc.documentType.replace(/_/g, ' ')} />
              <DefRow
                label="Source"
                value={
                  doc.source ? (
                    <span className="flex items-center gap-2">
                      {doc.source.name}
                      <Badge
                        className={
                          TRUST_LEVEL_VARIANT[doc.source.trustLevel] ??
                          'bg-muted text-muted-foreground'
                        }
                      >
                        {doc.source.trustLevel}
                      </Badge>
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
              <DefRow label="Truthfulness" value={doc.truthfulnessStatus ?? '—'} />
              {doc.confidenceScore !== null && doc.confidenceScore !== undefined && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Confidence</span>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full bg-primary"
                        style={{ width: `${Math.round(doc.confidenceScore * 100)}%` }}
                      />
                    </span>
                    <span className="tabular-nums text-xs">
                      {Math.round(doc.confidenceScore * 100)}%
                    </span>
                  </span>
                </div>
              )}
              <DefRow
                label="Created"
                value={
                  <span title={formatRelative(doc.createdAt)}>
                    {new Date(doc.createdAt).toLocaleString()}
                  </span>
                }
              />
              <DefRow
                label="Updated"
                value={
                  <span title={formatRelative(doc.updatedAt)}>
                    {new Date(doc.updatedAt).toLocaleString()}
                  </span>
                }
              />
              {doc.canonicalUrl && (
                <DefRow
                  label="Canonical URL"
                  value={
                    <a
                      href={doc.canonicalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-blue-600 hover:underline"
                    >
                      {doc.canonicalUrl}
                    </a>
                  }
                />
              )}
            </CardContent>
          </Card>

          {/* Editorial flags card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>Editorial flags</span>
                {documentFlags.length > 0 && (
                  <Badge variant="secondary">{documentFlags.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {documentFlags.length === 0 ? (
                <p className="text-muted-foreground">No editorial flags.</p>
              ) : (
                documentFlags.map((flag) => (
                  <div
                    key={flag.id}
                    className="rounded border p-2 text-xs"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <Badge
                        className={
                          FLAG_SEVERITY_VARIANT[flag.severity] ??
                          'bg-muted text-muted-foreground'
                        }
                      >
                        {flag.severity}
                      </Badge>
                      <span className="text-muted-foreground">{flag.status}</span>
                    </div>
                    <p className="text-foreground">
                      {flag.details ?? flag.flagType ?? 'No detail provided.'}
                    </p>
                    <Link
                      href="/admin/flags"
                      className="mt-1 inline-flex items-center gap-1 text-blue-600 hover:underline"
                    >
                      <FlagIcon className="size-3" aria-hidden />
                      View in Flags
                    </Link>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Sections preview card */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>Sections</span>
                {sections && sections.length > 0 && (
                  <Badge variant="secondary">{sections.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!sections ? (
                <p className="text-muted-foreground">Loading sections…</p>
              ) : sections.length === 0 ? (
                <p className="text-muted-foreground">No sections recorded.</p>
              ) : (
                <>
                  <div className="space-y-2">
                    {visibleSections.map((s) => (
                      <SectionPreview key={s.id} section={s} />
                    ))}
                  </div>
                  {sections.length > 5 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllSections((v) => !v)}
                    >
                      {showAllSections
                        ? 'Show first 5'
                        : `Show all ${sections.length} sections`}
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Section content is read-only here. To correct a section, use the
                    editorial flag workflow.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Confirm dialogs */}
        <ConfirmActionDialog
          open={confirmOpen === 'publish'}
          onOpenChange={(open) => {
            if (!open) {
              setConfirmOpen(null);
              setPublishError(null);
            }
          }}
          title="Publish document?"
          description={
            <span>
              This will set the document to <strong>status=published</strong>, mark
              <strong> truthfulnessStatus=verified</strong>, and auto-enqueue
              derivative generation jobs (digest, doctrines, MCQ, flashcards,
              outline). End-users will see this document immediately. The action is
              logged in audit_logs.
            </span>
          }
          confirmLabel="Publish document"
          pendingLabel="Publishing…"
          confirmVariant="default"
          requireTypedConfirmation={doc.title}
          onConfirm={handlePublishConfirm}
          isPending={publish.isPending}
          errorMessage={publishError}
        />

        <ConfirmActionDialog
          open={confirmOpen === 'quarantine'}
          onOpenChange={(open) => {
            if (!open) {
              setConfirmOpen(null);
              setQuarantineError(null);
            }
          }}
          title="Quarantine document?"
          description={
            <span>
              This will yank the document from public view. Users with open sessions
              may continue to see cached pages briefly until cache expires. Approved
              derivatives will remain but their source citation will be flagged. The
              action is logged in audit_logs and reversible only via re-publish.
            </span>
          }
          confirmLabel="Quarantine document"
          pendingLabel="Quarantining…"
          confirmVariant="destructive"
          requireTypedConfirmation={doc.title}
          onConfirm={handleQuarantineConfirm}
          isPending={quarantine.isPending}
          errorMessage={quarantineError}
        />
      </div>
    </TooltipProvider>
  );
}

function PublishButton({
  blocked,
  blockedCount,
  docId,
  isPending,
  onClick,
}: {
  blocked: boolean;
  blockedCount: number;
  docId: string;
  isPending: boolean;
  onClick: () => void;
}) {
  if (blocked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button
              variant="default"
              disabled
              aria-label="Publish document (blocked by editorial flags)"
              aria-disabled
            >
              <CheckCircle className="mr-1.5 size-4" aria-hidden />
              Publish
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Resolve {blockedCount} high-severity editorial flag
          {blockedCount === 1 ? '' : 's'} before publishing.{' '}
          <Link
            href={`/admin/flags?docId=${docId}`}
            className="underline"
          >
            View flags
          </Link>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      variant="default"
      onClick={onClick}
      disabled={isPending}
      aria-label="Publish document"
    >
      <CheckCircle className="mr-1.5 size-4" aria-hidden />
      {isPending ? 'Publishing…' : 'Publish'}
    </Button>
  );
}

function DefRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function SectionPreview({ section }: { section: AdminDocumentSection }) {
  const pageRange =
    section.pageStart && section.pageEnd
      ? `pp. ${section.pageStart}–${section.pageEnd}`
      : section.pageStart
        ? `p. ${section.pageStart}`
        : null;

  const text = section.plainText ?? '';
  const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;

  return (
    <div className="rounded border p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">{section.sectionType}</Badge>
        {section.sectionLabel && <span>{section.sectionLabel}</span>}
        {pageRange && <span>· {pageRange}</span>}
      </div>
      {preview ? (
        <p className="text-sm whitespace-pre-line">{preview}</p>
      ) : (
        <p className="text-xs italic text-muted-foreground">No text on file.</p>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const absSec = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (absSec < 60) return rtf.format(diffSec, 'second');
  if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (absSec < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), 'day');
  if (absSec < 86400 * 365)
    return rtf.format(Math.round(diffSec / (86400 * 30)), 'month');
  return rtf.format(Math.round(diffSec / (86400 * 365)), 'year');
}
