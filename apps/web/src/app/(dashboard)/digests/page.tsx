'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useDigests } from '@/features/digests/hooks/use-digests';
import { DigestListSkeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircleIcon } from 'lucide-react';

const REVIEW_STATUS_STYLES: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  draft: { variant: 'secondary' },
  ai_generated: { variant: 'outline', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  needs_human_review: { variant: 'outline', className: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
  approved: { variant: 'outline', className: 'border-green-200 bg-green-50 text-green-700' },
  published: { variant: 'outline', className: 'border-green-300 bg-green-100 text-green-800' },
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

export default function DigestsPage() {
  const [digestType, setDigestType] = useState('all');
  const [reviewStatus, setReviewStatus] = useState('all');

  const { data, isLoading, error } = useDigests({
    digestType: digestType !== 'all' ? digestType : undefined,
    reviewStatus: reviewStatus !== 'all' ? reviewStatus : undefined,
  });

  const digests = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Case Digests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          AI-generated and manually created case digests
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={digestType} onValueChange={setDigestType}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="case_digest">Case Digest</SelectItem>
            <SelectItem value="legal_opinion">Legal Opinion</SelectItem>
            <SelectItem value="legal_memo">Legal Memo</SelectItem>
          </SelectContent>
        </Select>
        <Select value={reviewStatus} onValueChange={setReviewStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="ai_generated">AI Generated</SelectItem>
            <SelectItem value="needs_human_review">Needs Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="published">Published</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
        <p className="py-12 text-center text-sm text-muted-foreground">
          No digests found.
        </p>
      )}

      <div className="space-y-3">
        {digests.map((digest) => (
          <Card key={digest.id} className="transition-colors hover:border-border/80">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/digests/${digest.id}`}
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
      </div>
    </div>
  );
}
