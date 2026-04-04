'use client';

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DigestListSkeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/lib/constants';
import { AlertCircleIcon } from 'lucide-react';

import { useSearchDigests } from '../hooks/use-search-digests';
import type { SearchDigestItem } from '../types';

interface DigestsResultsProps {
  documentIds: string[] | null;
}

export function DigestsResults({ documentIds }: DigestsResultsProps) {
  const { data, isLoading, error } = useSearchDigests(
    documentIds,
    !!documentIds && documentIds.length > 0,
  );

  if (!documentIds || documentIds.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Run a search first to find digests for matching documents.
      </p>
    );
  }

  if (isLoading) {
    return <DigestListSkeleton count={3} />;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon className="size-4" />
        <AlertDescription>
          Failed to load digests: {error instanceof Error ? error.message : 'Unknown error'}
        </AlertDescription>
      </Alert>
    );
  }

  const digests = data?.data ?? [];

  if (digests.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No digests found for documents matching your search.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {digests.length} digest{digests.length !== 1 ? 's' : ''} found
      </p>
      {digests.map((digest) => (
        <DigestCard key={digest.id} digest={digest} />
      ))}
    </div>
  );
}

function DigestCard({ digest }: { digest: SearchDigestItem }) {
  const displayType = digest.digestType?.replace(/_/g, ' ') ?? 'Digest';

  return (
    <Card className="transition-colors hover:border-border/80">
      <CardContent className="p-4">
        <div className="min-w-0">
          <Link
            href={ROUTES.DIGEST(digest.id)}
            className="text-sm font-semibold hover:underline"
          >
            {digest.title}
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary" className="capitalize">
              {displayType}
            </Badge>
            <ReviewStatusBadge status={digest.reviewStatus} />
            {digest.confidenceScore != null && (
              <ConfidenceIndicator score={digest.confidenceScore} />
            )}
            {digest.legalDocument?.court && (
              <span className="text-xs text-muted-foreground">
                {digest.legalDocument.court.replace(/_/g, ' ')}
              </span>
            )}
            {digest.legalDocument?.grNo && (
              <span className="text-xs text-muted-foreground">
                {digest.legalDocument.grNo}
              </span>
            )}
          </div>
          {digest.summary && (
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
              {digest.summary}
            </p>
          )}
          {digest.legalDocument && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Source:{' '}
              <Link
                href={ROUTES.READER(digest.legalDocument.id)}
                className="hover:underline"
              >
                {digest.legalDocument.shortTitle ?? digest.legalDocument.title}
              </Link>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'approved':
      return (
        <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
          Approved
        </Badge>
      );
    case 'needs_human_review':
      return (
        <Badge variant="outline" className="border-yellow-200 bg-yellow-50 text-yellow-700">
          Needs Review
        </Badge>
      );
    case 'draft':
      return (
        <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-600">
          Draft
        </Badge>
      );
    case 'rejected':
      return (
        <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
          Rejected
        </Badge>
      );
    default:
      return (
        <Badge variant="outline">
          {status.replace(/_/g, ' ')}
        </Badge>
      );
  }
}

function ConfidenceIndicator({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.8
      ? 'text-green-600'
      : score >= 0.5
        ? 'text-yellow-600'
        : 'text-red-600';

  return <span className={`text-xs font-medium ${color}`}>{pct}% confidence</span>;
}
