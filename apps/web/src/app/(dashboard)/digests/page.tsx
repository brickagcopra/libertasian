'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  DIGEST_TYPE_VALUES,
  DIGEST_REVIEW_STATUS_VALUES,
  type DigestType,
  type DigestReviewStatus,
} from '@libertasian/types';

import {
  useInfiniteDigests,
  useGenerateOnDemand,
  useSearchDigests,
  type MatchedDocument,
} from '@/features/digests/hooks/use-digests';
import { ApiClientError } from '@/lib/api-client';
import { usePlayQueueStore } from '@/features/audio';
import { UpgradeBanner } from '@/components/paywall/upgrade-banner';
import { DigestListSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircleIcon,
  FileTextIcon,
  Loader2Icon,
  SearchIcon,
  SparklesIcon,
} from 'lucide-react';

// Dropdown labels — typed as Record<…, string> over the shared filter contract so
// TS forces a label for every value the API accepts (and the maps can't drift).
const DIGEST_TYPE_LABELS: Record<DigestType, string> = {
  case_digest: 'Case Digest',
  statute_summary: 'Statute Summary',
  reviewer_note: 'Reviewer Note',
  study_digest: 'Study Digest',
};

const REVIEW_STATUS_LABELS: Record<DigestReviewStatus, string> = {
  draft: 'Draft',
  ai_generated: 'AI Generated',
  needs_human_review: 'Needs Review',
  approved: 'Approved',
  rejected: 'Rejected',
};

const REVIEW_STATUS_STYLES: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  draft: { variant: 'secondary' },
  ai_generated: { variant: 'outline', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  needs_human_review: { variant: 'outline', className: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
  approved: { variant: 'outline', className: 'border-green-200 bg-green-50 text-green-700' },
  rejected: { variant: 'destructive' },
};

function ReviewStatusBadge({ status }: { status: string }) {
  const style = REVIEW_STATUS_STYLES[status] ?? { variant: 'secondary' as const };
  return (
    <Badge variant={style.variant} className={style.className}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

function formatResetAt(resetAt: string | undefined): string {
  if (!resetAt) return 'soon';
  const d = new Date(resetAt);
  if (Number.isNaN(d.getTime())) return 'soon';
  return d.toLocaleDateString();
}

export default function DigestsPage() {
  const [digestType, setDigestType] = useState('all');
  const [reviewStatus, setReviewStatus] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<
    | { tone: 'error' | 'success'; message: string; href?: string }
    | null
  >(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Default browsing path — no query typed yet.
  const {
    data: browseData,
    isLoading: browseLoading,
    error: browseError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteDigests({
    digestType: digestType !== 'all' ? digestType : undefined,
    reviewStatus: reviewStatus !== 'all' ? reviewStatus : undefined,
  });

  // Server-side search path — activated once the user types.
  const {
    data: searchData,
    isLoading: searchLoading,
    error: searchError,
  } = useSearchDigests(searchQuery, searchQuery.length > 0);

  const generateOnDemand = useGenerateOnDemand();

  const isSearching = searchQuery.length > 0;
  const isLoading = isSearching ? searchLoading : browseLoading;
  const error = isSearching ? searchError : browseError;

  const browseMeta = browseData?.pages[0]?.meta;
  const digests = isSearching
    ? (searchData?.results ?? [])
    : (browseData?.pages.flatMap((p) => p.data) ?? []);
  const matchedDocuments: MatchedDocument[] = isSearching
    ? (searchData?.matchedDocuments ?? [])
    : [];

  const previewMode = isSearching
    ? searchData?.previewMode === true
    : browseMeta?.previewMode === true;
  const lockedCount = isSearching
    ? (searchData?.lockedCount ?? 0)
    : (browseMeta?.lockedCount ?? 0);

  const setQueue = usePlayQueueStore((s) => s.setQueue);

  // Capture the currently-loaded, ordered ids into the autoplay queue when the
  // reader opens a digest, so continuous playback can advance through this list.
  // Only the browse path carries a usable next-page cursor; search results play
  // through what's loaded and then stop.
  const captureQueue = useCallback(() => {
    const ids = digests.map((d) => d.id);
    if (isSearching) {
      setQueue({ ids, cursor: null, filters: null });
      return;
    }
    const pages = browseData?.pages ?? [];
    const lastMeta = pages[pages.length - 1]?.meta;
    const cursor = lastMeta?.hasNext ? (lastMeta.nextCursor ?? null) : null;
    setQueue({
      ids,
      cursor,
      filters: {
        digestType: digestType !== 'all' ? digestType : undefined,
        reviewStatus: reviewStatus !== 'all' ? reviewStatus : undefined,
      },
    });
  }, [digests, isSearching, browseData, digestType, reviewStatus, setQueue]);

  const handleGenerate = async (doc: MatchedDocument) => {
    setToast(null);
    try {
      const job = await generateOnDemand.mutateAsync(doc.id);
      setToast({
        tone: 'success',
        message: `Queued digest generation for "${doc.title}". Job ${job.jobId.slice(0, 8)}… will surface here once complete.`,
      });
    } catch (err) {
      if (err instanceof ApiClientError) {
        const body = (err.body ?? {}) as Record<string, unknown>;
        if (err.statusCode === 402) {
          setToast({
            tone: 'error',
            message:
              (body['message'] as string) ??
              'An active subscription is required to generate digests on demand.',
            href: (body['upgradeUrl'] as string) ?? '/pricing',
          });
          return;
        }
        if (err.statusCode === 429) {
          const resetAt = body['resetAt'] as string | undefined;
          const limit = body['limit'] as number | undefined;
          setToast({
            tone: 'error',
            message: limit
              ? `Monthly digest quota exhausted (${limit}). Comes back ${formatResetAt(resetAt)}.`
              : `Rate limit hit — try again later.`,
          });
          return;
        }
      }
      setToast({
        tone: 'error',
        message:
          err instanceof Error ? err.message : 'Failed to queue digest generation.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Case Digests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search approved case digests, or generate a new one from a legal document.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by title, case name, or citation..."
          className="pl-9"
          aria-label="Search digests"
        />
      </div>

      {/* Filters — only meaningful when browsing, not while actively searching */}
      {!isSearching && (
        <div className="flex flex-wrap gap-3">
          <Select value={digestType} onValueChange={setDigestType}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {DIGEST_TYPE_VALUES.map((v) => (
                <SelectItem key={v} value={v}>
                  {DIGEST_TYPE_LABELS[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={reviewStatus} onValueChange={setReviewStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {DIGEST_REVIEW_STATUS_VALUES.map((v) => (
                <SelectItem key={v} value={v}>
                  {REVIEW_STATUS_LABELS[v]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {toast && (
        <Alert variant={toast.tone === 'error' ? 'destructive' : 'default'}>
          {toast.tone === 'error' ? (
            <AlertCircleIcon className="size-4" />
          ) : (
            <SparklesIcon className="size-4" />
          )}
          <AlertDescription>
            {toast.message}
            {toast.href && (
              <>
                {' '}
                <Link href={toast.href} className="underline">
                  Upgrade your plan
                </Link>
                .
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      {isLoading && <DigestListSkeleton />}

      {error && (
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            Failed to load digests: {error instanceof Error ? error.message : 'Unknown error'}
          </AlertDescription>
        </Alert>
      )}

      {!isLoading && digests.length === 0 && (
        <EmptyState
          isSearching={isSearching}
          searchQuery={searchQuery}
          matchedDocuments={matchedDocuments}
          onGenerate={handleGenerate}
          generating={generateOnDemand.isPending}
        />
      )}

      <div className="space-y-3">
        {digests.map((digest) => (
          <Card key={digest.id} className="transition-colors hover:border-border/80">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/digests/${digest.id}`}
                    onClick={captureQueue}
                    className="text-sm font-semibold hover:underline"
                  >
                    {digest.title}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="capitalize">
                      {digest.digestType.replace(/_/g, ' ')}
                    </Badge>
                    <ReviewStatusBadge status={digest.reviewStatus} />
                    {digest.confidenceScore != null && (
                      <span className="text-xs text-muted-foreground">
                        Confidence: {Math.round(digest.confidenceScore * 100)}%
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(digest.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {digest.legalDocument && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Source: {digest.legalDocument.title}
                    </p>
                  )}
                  {digest.facts && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {digest.facts}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {previewMode && (
          <UpgradeBanner
            variant="inline"
            corpus="digests"
            lockedCount={lockedCount}
            surface={isSearching ? 'digests/search' : 'digests/list'}
          />
        )}

        {!isSearching && hasNextPage && (
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  isSearching,
  searchQuery,
  matchedDocuments,
  onGenerate,
  generating,
}: {
  isSearching: boolean;
  searchQuery: string;
  matchedDocuments: MatchedDocument[];
  onGenerate: (doc: MatchedDocument) => void;
  generating: boolean;
}) {
  if (!isSearching) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No digests found.
      </p>
    );
  }

  if (matchedDocuments.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No digests found matching &quot;{searchQuery}&quot;. Try a different search
        term, or browse the full corpus in the reader.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        No digests found matching &quot;{searchQuery}&quot; — but we found{' '}
        {matchedDocuments.length} legal{' '}
        {matchedDocuments.length === 1 ? 'document' : 'documents'} you can generate
        a digest from:
      </p>
      {matchedDocuments.map((doc) => (
        <Card key={doc.id}>
          <CardContent className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{doc.title}</p>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {doc.grNo && <span>{doc.grNo}</span>}
                {doc.citationText && <span>&middot; {doc.citationText}</span>}
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => onGenerate(doc)}
              disabled={generating}
            >
              {generating ? (
                <>
                  <Loader2Icon className="mr-1.5 size-3.5 animate-spin" />
                  Queuing…
                </>
              ) : (
                <>
                  <FileTextIcon className="mr-1.5 size-3.5" />
                  Generate digest
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
