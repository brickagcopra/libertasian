'use client';

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { LockIcon, SparklesIcon } from 'lucide-react';

import { subjectFromCode, typeFromEnum } from '../taxonomy';
import {
  DERIVATIVE_TYPE_LABELS,
  type DerivativeListItem,
  type DerivativeSubject,
} from '../types';

interface DerivativeCardProps {
  item: DerivativeListItem;
  /** Subject slug of the URL the card is rendered under (e.g. "civil-law"
   *  on `/library/mcqs/civil-law`). When provided, the detail link uses
   *  this subject if the item has a matching assignment — keeping the
   *  user inside the filter context they navigated from. */
  pageSubjectSlug?: string;
  /** Subject code form of the same selector — preferred over the slug
   *  because `DerivativeSubject.code` is the canonical join key. */
  pageSubjectCode?: string;
}

function pickSubjectForUrl(
  item: DerivativeListItem,
  pageSubjectSlug?: string,
  pageSubjectCode?: string,
): DerivativeSubject | undefined {
  // Prefer a subject that matches the URL filter context, so a card on
  // /library/mcqs/civil-law never links to /library/mcqs/criminal-law.
  if (pageSubjectCode) {
    const byCode = item.subjects.find((s) => s.code === pageSubjectCode);
    if (byCode) return byCode;
  }
  if (pageSubjectSlug) {
    const bySlug = item.subjects.find(
      (s) => subjectFromCode(s.code)?.slug === pageSubjectSlug,
    );
    if (bySlug) return bySlug;
  }
  return item.subjects.find((s) => s.isPrimary) ?? item.subjects[0];
}

function buildDetailHref(
  item: DerivativeListItem,
  pageSubjectSlug?: string,
  pageSubjectCode?: string,
): string {
  const typeMeta = typeFromEnum(item.derivativeType);
  const chosenSubject = pickSubjectForUrl(item, pageSubjectSlug, pageSubjectCode);
  const subjectMeta = chosenSubject ? subjectFromCode(chosenSubject.code) : undefined;
  if (typeMeta && subjectMeta) {
    return `/library/${typeMeta.slug}/${subjectMeta.slug}/${item.id}`;
  }
  return `/library/${item.id}`;
}

export function DerivativeCard({
  item,
  pageSubjectSlug,
  pageSubjectCode,
}: DerivativeCardProps) {
  const primarySubject =
    pickSubjectForUrl(item, pageSubjectSlug, pageSubjectCode);
  const typeLabel = DERIVATIVE_TYPE_LABELS[item.derivativeType] ?? item.derivativeType;

  return (
    <Link
      href={buildDetailHref(item, pageSubjectSlug, pageSubjectCode)}
      className="block"
    >
      <Card className="h-full transition hover:shadow-md">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {typeLabel}
            </Badge>
            {primarySubject && (
              <Badge variant="secondary" className="text-xs">
                {primarySubject.name}
              </Badge>
            )}
            {item.isGated && (
              <Badge
                variant="outline"
                className="border-amber-200 bg-amber-50 text-xs text-amber-800"
              >
                <LockIcon className="mr-1 h-3 w-3" />
                {item.upgradeTier ?? 'upgrade'}
              </Badge>
            )}
            {item.confidenceScore !== null && item.confidenceScore >= 0.7 && (
              <Badge variant="outline" className="border-green-200 text-xs text-green-700">
                {Math.round(item.confidenceScore * 100)}% confidence
              </Badge>
            )}
          </div>

          <h3 className="line-clamp-2 text-base font-semibold">{item.title}</h3>

          {item.sourceDocument && (
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {item.sourceDocument.citationText ??
                item.sourceDocument.shortTitle ??
                item.sourceDocument.title}
            </p>
          )}

          <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <SparklesIcon className="h-3 w-3" /> AI-generated
            </span>
            <span>{new Date(item.createdAt).toLocaleDateString()}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
