'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback } from 'react';

import {
  useReviewerPack,
  useDeleteReviewerPackItem,
} from '@/features/study/hooks/use-reviewer-packs';
import { useExportReviewerPack } from '@/features/study/hooks/use-study-export';
import { ROUTES } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AlertCircleIcon, DownloadIcon } from 'lucide-react';
import type { ReviewerPackItem, ExportFormat } from '@/features/study/types';

const VISIBILITY_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; className?: string }> = {
  private: { variant: 'secondary' },
  org: { variant: 'outline', className: 'border-purple-200 bg-purple-50 text-purple-700' },
  public_editorial: { variant: 'outline', className: 'border-blue-200 bg-blue-50 text-blue-700' },
};

export default function ReviewerPackDetailPage() {
  const params = useParams();
  const id = params['id'] as string;

  const { data: pack, isLoading, error } = useReviewerPack(id);
  const deleteItemMutation = useDeleteReviewerPackItem();
  const exportMutation = useExportReviewerPack();

  const handleDeleteItem = useCallback(
    (itemId: string) => {
      if (window.confirm('Remove this item from the pack?')) {
        deleteItemMutation.mutate({ id: itemId, packId: id });
      }
    },
    [deleteItemMutation, id],
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-3/4" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !pack) {
    return (
      <div className="space-y-4">
        <Link href={ROUTES.STUDY_REVIEWER_PACKS} className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Back to reviewer packs
        </Link>
        <Alert variant="destructive">
          <AlertCircleIcon className="size-4" />
          <AlertDescription>
            {error instanceof Error ? error.message : 'Reviewer pack not found'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const items = pack.items ?? [];
  const visStyle = VISIBILITY_BADGE[pack.visibility] ?? { variant: 'secondary' as const };

  return (
    <div className="space-y-6">
      <Link href={ROUTES.STUDY_REVIEWER_PACKS} className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Back to reviewer packs
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold">{pack.title}</h1>
        {pack.description && (
          <p className="mt-1 text-sm text-muted-foreground">{pack.description}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {pack.itemCount} item{pack.itemCount !== 1 ? 's' : ''}
          </Badge>
          {pack.barSubject && <Badge variant="secondary">{pack.barSubject}</Badge>}
          <Badge variant={visStyle.variant} className={visStyle.className}>
            {pack.visibility.replace(/_/g, ' ')}
          </Badge>
          {pack.creator && (
            <span className="text-xs text-muted-foreground">by {pack.creator.fullName}</span>
          )}
          <span className="text-xs text-muted-foreground">
            Updated {new Date(pack.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      <Separator />

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={items.length === 0 || exportMutation.isPending}>
              <DownloadIcon className="mr-2 size-4" />
              {exportMutation.isPending ? 'Exporting...' : 'Export'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => exportMutation.mutate({ id, format: 'pdf' as ExportFormat })}>
              Export as PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportMutation.mutate({ id, format: 'docx' as ExportFormat })}>
              Export as DOCX
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">No items in this pack yet.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Items can be added from the search results or document reader.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <ReviewerPackItemCard
              key={item.id}
              item={item}
              index={index}
              onDelete={() => handleDeleteItem(item.id)}
              isDeleting={deleteItemMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewerPackItemCard({
  item,
  index,
  onDelete,
  isDeleting,
}: {
  item: ReviewerPackItem;
  index: number;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const itemTypeLabel = item.itemType.replace(/_/g, ' ');

  let title = 'Untitled';
  let href: string | null = null;
  let subtitle: string | null = null;

  if (item.itemType === 'legal_document' && item.legalDocument) {
    title = item.legalDocument.title;
    href = ROUTES.READER(item.legalDocument.id);
    subtitle = [
      item.legalDocument.documentType?.replace(/_/g, ' '),
      item.legalDocument.court,
      item.legalDocument.grNo,
    ]
      .filter(Boolean)
      .join(' · ');
  } else if (item.itemType === 'digest' && item.digest) {
    title = item.digest.title;
    href = ROUTES.DIGEST(item.digest.id);
    subtitle = item.digest.digestType?.replace(/_/g, ' ');
  } else if (item.itemType === 'section' && item.section) {
    title = item.section.sectionLabel || item.section.sectionType.replace(/_/g, ' ');
    subtitle = item.section.sectionType.replace(/_/g, ' ');
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground/60">#{index + 1}</span>
              <Badge variant="secondary" className="capitalize">
                {itemTypeLabel}
              </Badge>
            </div>
            {href ? (
              <Link
                href={href}
                className="mt-1 block text-sm font-medium hover:underline"
              >
                {title}
              </Link>
            ) : (
              <p className="mt-1 text-sm font-medium">{title}</p>
            )}
            {subtitle && (
              <p className="mt-0.5 text-xs capitalize text-muted-foreground">{subtitle}</p>
            )}
            {item.note && (
              <p className="mt-2 rounded bg-yellow-50 p-2 text-xs text-muted-foreground">
                {item.note}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={isDeleting}
            className="shrink-0 text-destructive hover:text-destructive"
          >
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
