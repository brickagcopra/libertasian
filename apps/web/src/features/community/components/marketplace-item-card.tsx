'use client';

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  BookOpenIcon,
  FileTextIcon,
  LayersIcon,
  UserIcon,
} from 'lucide-react';

import type { MarketplaceItem } from '../types';
import { ExpertBadge } from './expert-badge';
import { StarRatingDisplay } from './star-rating';
import { VoteButtons } from './vote-buttons';

const CONTENT_TYPE_ICONS: Record<string, React.ElementType> = {
  flashcard_set: LayersIcon,
  reviewer_pack: BookOpenIcon,
  digest: FileTextIcon,
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  flashcard_set: 'Flashcard Set',
  reviewer_pack: 'Reviewer Pack',
  digest: 'Digest',
};

const CONTENT_TYPE_ROUTES: Record<string, (id: string) => string> = {
  flashcard_set: (id) => `/study/flashcards/${id}`,
  reviewer_pack: (id) => `/study/reviewer-packs/${id}`,
  digest: (id) => `/digests/${id}`,
};

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface MarketplaceItemCardProps {
  item: MarketplaceItem;
  showContentType?: boolean;
}

export function MarketplaceItemCard({ item, showContentType = false }: MarketplaceItemCardProps) {
  const Icon = CONTENT_TYPE_ICONS[item.contentType] ?? FileTextIcon;
  const label = CONTENT_TYPE_LABELS[item.contentType] ?? item.contentType;
  const href = CONTENT_TYPE_ROUTES[item.contentType]?.(item.id) ?? '#';

  return (
    <Card className="transition-colors hover:border-border/80">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-4 text-muted-foreground" />
          </div>

          <div className="min-w-0 flex-1">
            {/* Title */}
            <Link href={href} className="text-sm font-semibold hover:underline">
              {item.title}
            </Link>

            {/* Badges */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {showContentType && (
                <Badge variant="secondary" className="text-[10px]">
                  {label}
                </Badge>
              )}
              {item.barSubject && (
                <Badge variant="outline" className="text-[10px]">
                  {item.barSubject}
                </Badge>
              )}
              {item.topic && (
                <span className="text-xs text-muted-foreground">{item.topic}</span>
              )}
            </div>

            {/* Description */}
            {item.description && (
              <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                {item.description}
              </p>
            )}

            {/* Footer: creator + stats */}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {/* Creator */}
              <Link
                href={`/community/contributors/${item.creator.id}`}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <UserIcon className="size-3" />
                <span>{item.creator.fullName}</span>
                {item.creator.expertVerification && (
                  <ExpertBadge
                    expertiseType={item.creator.expertVerification.expertiseType}
                    status={item.creator.expertVerification.status}
                    size="sm"
                  />
                )}
              </Link>

              {/* Rating */}
              <StarRatingDisplay
                value={item.avgRating}
                count={item.ratingCount}
                size="sm"
              />

              {/* Item count */}
              <span className="text-xs text-muted-foreground">
                {formatCount(item.itemCount)} items
              </span>

              {/* Vote buttons for digests */}
              {item.contentType === 'digest' && (
                <VoteButtons
                  entityType="digest"
                  entityId={item.id}
                  voteScore={item.voteScore}
                />
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
