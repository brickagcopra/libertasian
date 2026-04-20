'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircleIcon, ArrowLeftIcon, LockIcon, SparklesIcon } from 'lucide-react';

import { useDerivative } from '@/features/derivatives/hooks/use-derivatives';
import { DERIVATIVE_TYPE_LABELS } from '@/features/derivatives/types';

export default function LibraryDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const { data, isLoading, error } = useDerivative(id);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-64 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon className="size-4" />
        <AlertDescription>
          {error instanceof Error ? error.message : 'Failed to load'}
        </AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push('/library')}>
          <ArrowLeftIcon className="mr-2 h-4 w-4" /> Back to Library
        </Button>
        <p className="text-sm text-muted-foreground">Not found.</p>
      </div>
    );
  }

  const typeLabel = DERIVATIVE_TYPE_LABELS[data.derivativeType] ?? data.derivativeType;
  const primarySubject = data.subjects.find((s) => s.isPrimary) ?? data.subjects[0];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/library"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeftIcon className="mr-1 h-4 w-4" /> Back to Library
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{typeLabel}</Badge>
        {primarySubject && <Badge variant="secondary">{primarySubject.name}</Badge>}
        {data.isGated && (
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
            <LockIcon className="mr-1 h-3 w-3" /> {data.upgradeTier ?? 'upgrade'}-tier
          </Badge>
        )}
        {data.confidenceScore !== null && data.confidenceScore >= 0.7 && (
          <Badge variant="outline" className="border-green-200 text-green-700">
            {Math.round(data.confidenceScore * 100)}% confidence
          </Badge>
        )}
      </div>

      <div>
        <h1 className="text-2xl font-bold">{data.title}</h1>
        {data.sourceDocument && (
          <p className="mt-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <SparklesIcon className="h-3 w-3" /> AI-generated from
            </span>{' '}
            {data.sourceDocument.citationText ??
              data.sourceDocument.shortTitle ??
              data.sourceDocument.title}
          </p>
        )}
      </div>

      {data.disclaimerBody && (
        <Alert>
          <AlertCircleIcon className="h-4 w-4" />
          <AlertDescription className="text-xs">{data.disclaimerBody.bodyPlain}</AlertDescription>
        </Alert>
      )}

      {data.isGated && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LockIcon className="h-4 w-4" /> Unlock full content
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {typeLabel} answers and explanations are available on the{' '}
              <span className="font-semibold capitalize">{data.upgradeTier ?? 'edu'}</span>{' '}
              plan and above. Upgrade to see the full solution, model answer, and rationale.
            </p>
            <Button asChild>
              <Link href="/pricing">Upgrade</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="prose prose-sm max-w-none p-6 dark:prose-invert">
          {data.contentPlainText ? (
            <pre className="whitespace-pre-wrap font-sans text-sm">{data.contentPlainText}</pre>
          ) : (
            <pre className="whitespace-pre-wrap font-mono text-xs">
              {JSON.stringify(data.contentJson, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
