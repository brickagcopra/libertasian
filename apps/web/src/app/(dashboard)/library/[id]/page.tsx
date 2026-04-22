'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircleIcon } from 'lucide-react';

import { useDerivative } from '@/features/derivatives/hooks/use-derivatives';
import { subjectFromCode, typeFromEnum } from '@/features/derivatives/taxonomy';

export default function LibraryLegacyIdRedirect() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const { data, isLoading, error } = useDerivative(id);

  useEffect(() => {
    if (!data) return;
    const typeMeta = typeFromEnum(data.derivativeType);
    const primarySubject =
      data.subjects.find((s) => s.isPrimary) ?? data.subjects[0];
    const subjectMeta = primarySubject ? subjectFromCode(primarySubject.code) : undefined;
    if (typeMeta && subjectMeta && id) {
      router.replace(`/library/${typeMeta.slug}/${subjectMeta.slug}/${id}`);
    } else {
      router.replace('/library');
    }
  }, [data, id, router]);

  if (isLoading || data) {
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

  return null;
}
