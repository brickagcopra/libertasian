'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { useDigest } from '@/features/digests/hooks/use-digests';
import { sanitizeRulingText } from '@/features/digests/lib/sanitize-ruling';
import { ROUTES } from '@/lib/constants';
import { UpgradeBanner, extractPaywall402 } from '@/components/paywall/upgrade-banner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeftIcon, AlertCircleIcon, ExternalLinkIcon } from 'lucide-react';
import { ExportButton } from '@/features/exports/components/export-button';
import { AudioPlayer } from '@/features/audio';

const VISIBILITY_STYLES: Record<string, { variant: 'default' | 'secondary' | 'outline'; className?: string }> = {
  private: { variant: 'secondary' },
  org: { variant: 'outline', className: 'border-purple-200 bg-purple-50 text-purple-700' },
  public_editorial: { variant: 'outline', className: 'border-blue-200 bg-blue-50 text-blue-700' },
};

export default function DigestDetailPage() {
  const params = useParams();
  const id = params['id'] as string;
  const { data: digest, isLoading, error } = useDigest(id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-3/4" />
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-2 p-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const paywall = extractPaywall402(error);
  if (paywall) {
    return (
      <UpgradeBanner
        variant="modal"
        corpus={paywall.corpus}
        previewItemId={paywall.previewItemId}
        previewHref={
          paywall.previewItemId ? `/digests/${paywall.previewItemId}` : undefined
        }
        message={paywall.message}
        surface="digests/detail"
      />
    );
  }

  if (error || !digest) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={ROUTES.DIGESTS}>
            <ArrowLeftIcon />
            Back to digests
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            {error instanceof Error ? error.message : 'Digest not found'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const displayType = digest.digestType.replace(/_/g, ' ');
  const visibilityStyle = VISIBILITY_STYLES[digest.visibility] ?? { variant: 'secondary' as const };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link href={ROUTES.DIGESTS}>
            <ArrowLeftIcon />
            Back to digests
          </Link>
        </Button>
        <ExportButton contentType="digest" contentId={id} />
      </div>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">{digest.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="capitalize">
            {displayType}
          </Badge>
          <Badge variant={visibilityStyle.variant} className={visibilityStyle.className}>
            {digest.visibility.replace(/_/g, ' ')}
          </Badge>
          {digest.confidenceScore != null && (
            <ConfidenceIndicator score={digest.confidenceScore} />
          )}
          <span className="text-xs text-muted-foreground">
            Created {new Date(digest.createdAt).toLocaleDateString()}
          </span>
        </div>
        {digest.legalDocument && (
          <Button variant="link" size="sm" className="mt-1 h-auto p-0" asChild>
            <Link href={ROUTES.READER(digest.legalDocument.id)}>
              <ExternalLinkIcon className="size-3" />
              Source: {digest.legalDocument.title}
              {digest.legalDocument.grNo && ` (${digest.legalDocument.grNo})`}
            </Link>
          </Button>
        )}
      </div>

      {/* Listen — narrated audio with synced read-along. Digest audio is free. */}
      <AudioPlayer contentType="digest" contentId={digest.id} title={digest.title} />

      <Separator />

      {/* Digest Sections — DFIR+ Gold Standard Order */}
      <div className="space-y-5">
        <DigestSection title="Summary" content={digest.summary} />
        <DigestSection title="Doctrine" content={digest.doctrine} />
        <DigestSection title="Facts" content={digest.facts} />
        <DigestSection title="Petitioner's Arguments" content={digest.petitionerArguments} />
        <DigestSection title="Respondent's Arguments" content={digest.respondentArguments} />
        <DigestSection title="Issues" content={digest.issues} />
        <DigestSection title="Ruling" content={sanitizeRulingText(digest.ruling) || null} />
        <DigestSection title="Dispositive Portion" content={digest.dispositive} />
      </div>

      {/* Metadata */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
            Metadata
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Source Origin</dt>
            <dd className="font-medium capitalize">{digest.sourceOrigin.replace(/_/g, ' ')}</dd>
            <dt className="text-muted-foreground">Visibility</dt>
            <dd className="font-medium capitalize">{digest.visibility}</dd>
            {digest.confidenceScore != null && (
              <>
                <dt className="text-muted-foreground">Confidence Score</dt>
                <dd className="font-medium">{Math.round(digest.confidenceScore * 100)}%</dd>
              </>
            )}
            {digest.legalDocument?.court && (
              <>
                <dt className="text-muted-foreground">Court</dt>
                <dd className="font-medium">{digest.legalDocument.court.replace(/_/g, ' ')}</dd>
              </>
            )}
            {digest.legalDocument?.documentType && (
              <>
                <dt className="text-muted-foreground">Document Type</dt>
                <dd className="font-medium capitalize">
                  {digest.legalDocument.documentType.replace(/_/g, ' ')}
                </dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function DigestSection({ title, content }: { title: string; content: string | null }) {
  if (!content) return null;
  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase text-muted-foreground">{title}</h2>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">
        {content}
      </div>
    </div>
  );
}

function ConfidenceIndicator({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  let className = 'border-red-200 bg-red-50 text-red-700';
  if (pct >= 70) className = 'border-green-200 bg-green-50 text-green-700';
  else if (pct >= 50) className = 'border-yellow-200 bg-yellow-50 text-yellow-700';

  return (
    <Badge variant="outline" className={className}>
      {pct}% confidence
    </Badge>
  );
}
