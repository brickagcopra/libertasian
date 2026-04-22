'use client';

import { notFound, useParams } from 'next/navigation';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertCircleIcon, LockIcon, SparklesIcon } from 'lucide-react';

import { LibraryBreadcrumb } from '@/features/derivatives/components/library-breadcrumb';
import { useDerivative } from '@/features/derivatives/hooks/use-derivatives';
import { RENDERER_BY_TYPE } from '@/features/derivatives/renderers';
import { subjectFromSlug, typeFromSlug } from '@/features/derivatives/taxonomy';
import type { DerivativeType } from '@/features/derivatives/types';

export default function LibraryDetailPage() {
  const params = useParams<{ type: string; subject: string; id: string }>();
  const typeMeta = params?.type ? typeFromSlug(params.type) : undefined;
  const subjectMeta = params?.subject ? subjectFromSlug(params.subject) : undefined;
  const id = params?.id;

  if (!typeMeta || !subjectMeta) {
    notFound();
  }

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
        <LibraryBreadcrumb
          segments={[
            { href: '/library', label: 'Library' },
            { href: `/library/${typeMeta.slug}`, label: typeMeta.label },
            {
              href: `/library/${typeMeta.slug}/${subjectMeta.slug}`,
              label: subjectMeta.name,
            },
            { label: 'Not found' },
          ]}
        />
        <p className="text-sm text-muted-foreground">Not found.</p>
      </div>
    );
  }

  const Renderer =
    RENDERER_BY_TYPE[data.derivativeType as DerivativeType] ??
    RENDERER_BY_TYPE['case_digest'];

  return (
    <div className="space-y-6">
      <LibraryBreadcrumb
        segments={[
          { href: '/library', label: 'Library' },
          { href: `/library/${typeMeta.slug}`, label: typeMeta.label },
          {
            href: `/library/${typeMeta.slug}/${subjectMeta.slug}`,
            label: subjectMeta.name,
          },
          { label: data.title },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{typeMeta.label}</Badge>
        <Badge variant="secondary">{subjectMeta.name}</Badge>
        {data.isGated && (
          <Badge
            variant="outline"
            className="border-amber-200 bg-amber-50 text-amber-800"
          >
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

      <Renderer data={data} />

      {data.disclaimerBody && (
        <Alert>
          <AlertCircleIcon className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {data.disclaimerBody.bodyPlain}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
