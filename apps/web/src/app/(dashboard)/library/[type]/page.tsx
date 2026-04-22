'use client';

import Link from 'next/link';
import { notFound, useParams } from 'next/navigation';

import { Card, CardContent } from '@/components/ui/card';

import { LibraryBreadcrumb } from '@/features/derivatives/components/library-breadcrumb';
import { useDerivativeSubjectsByType } from '@/features/derivatives/hooks/use-derivatives';
import { SUBJECTS, subjectFromCode, typeFromSlug } from '@/features/derivatives/taxonomy';

export default function LibraryTypePage() {
  const params = useParams<{ type: string }>();
  const typeSlug = params?.type;
  const typeMeta = typeSlug ? typeFromSlug(typeSlug) : undefined;

  if (!typeMeta) {
    notFound();
  }

  const { data: summary, isLoading } = useDerivativeSubjectsByType(
    typeMeta.enum,
    'study_8',
  );

  const countByCode = new Map<string, number>();
  for (const row of summary ?? []) {
    countByCode.set(row.subjectCode, row.totalCount);
  }

  return (
    <div className="space-y-6">
      <LibraryBreadcrumb
        segments={[
          { href: '/library', label: 'Library' },
          { label: typeMeta.label },
        ]}
      />

      <div>
        <h1 className="text-2xl font-bold">{typeMeta.label}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{typeMeta.description}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SUBJECTS.map((s) => {
          const SubjectIcon = s.icon;
          const total = countByCode.get(s.code) ?? 0;
          const subject = subjectFromCode(s.code);
          const subjectSlug = subject?.slug ?? s.slug;
          return (
            <Link
              key={s.code}
              href={`/library/${typeMeta.slug}/${subjectSlug}`}
              className="block"
            >
              <Card className="h-full transition hover:shadow-md">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
                      <SubjectIcon className="h-4 w-4" />
                    </div>
                    <h3 className="line-clamp-2 text-sm font-semibold">{s.name}</h3>
                  </div>
                  <div className="mt-auto text-xs text-muted-foreground">
                    {isLoading ? (
                      <span className="inline-block h-3 w-16 animate-pulse rounded bg-muted" />
                    ) : (
                      <span>
                        <span className="font-semibold text-foreground">{total}</span>{' '}
                        {(total === 1 ? typeMeta.singularLabel : typeMeta.label).toLowerCase()}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
