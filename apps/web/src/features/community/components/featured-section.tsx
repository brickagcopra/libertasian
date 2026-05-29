'use client';

import Link from 'next/link';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircleIcon, BookOpenIcon, FileTextIcon, LayersIcon } from 'lucide-react';

import { useMarketplaceFeatured } from '../hooks/use-marketplace';
import type { MarketplaceItem } from '../types';
import { ExpertBadge } from './expert-badge';
import { StarRatingDisplay } from './star-rating';

const SECTIONS = [
  {
    key: 'flashcardSets' as const,
    title: 'Top Flashcard Sets',
    icon: LayersIcon,
    href: '/community/flashcard-sets',
    itemHref: (id: string) => `/study/flashcards/${id}`,
  },
  {
    key: 'reviewerPacks' as const,
    title: 'Top Reviewer Packs',
    icon: BookOpenIcon,
    href: '/community/reviewer-packs',
    itemHref: (id: string) => `/study/reviewer-packs/${id}`,
  },
  {
    key: 'digests' as const,
    title: 'Top Digests',
    icon: FileTextIcon,
    href: '/community/digests',
    itemHref: (id: string) => `/digests/${id}`,
  },
];

function FeaturedItem({
  item,
  href,
}: {
  item: MarketplaceItem;
  href: string;
}) {
  return (
    <Link href={href} className="block rounded-lg border p-3 transition-colors hover:bg-accent/50">
      <p className="text-sm font-medium leading-tight">{item.title}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <StarRatingDisplay value={item.avgRating} count={item.ratingCount} size="sm" />
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{item.creator.fullName}</span>
        {item.creator.expertVerification && (
          <ExpertBadge
            expertiseType={item.creator.expertVerification.expertiseType}
            status={item.creator.expertVerification.status}
            size="sm"
          />
        )}
      </div>
    </Link>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader>
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3].map((j) => (
              <div key={j} className="space-y-2 rounded-lg border p-3">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function FeaturedEmpty() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
      <p className="text-sm text-muted-foreground">
        No community materials yet — featured flashcard sets, reviewer packs, and
        digests will appear here soon.
      </p>
    </div>
  );
}

export function FeaturedSection() {
  const { data, isLoading, error } = useMarketplaceFeatured();

  if (isLoading) return <FeaturedSkeleton />;

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon className="size-4" />
        <AlertDescription>Failed to load featured content.</AlertDescription>
      </Alert>
    );
  }

  const featured = data?.data;
  const hasAnyItems = featured
    ? SECTIONS.some((section) => {
        const items = featured[section.key];
        return items !== undefined && items.length > 0;
      })
    : false;

  // No featured content yet — show a muted empty state instead of nothing,
  // consistent with the Feed/Blog empty states, so the page doesn't look broken.
  if (!hasAnyItems) return <FeaturedEmpty />;

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Featured</h2>
      <div className="grid gap-4 md:grid-cols-3">
        {SECTIONS.map((section) => {
          const items = featured[section.key];
          if (!items || items.length === 0) return null;

          const Icon = section.icon;

          return (
            <Card key={section.key}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Icon className="size-4 text-muted-foreground" />
                  {section.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.slice(0, 3).map((item) => (
                  <FeaturedItem
                    key={item.id}
                    item={item}
                    href={section.itemHref(item.id)}
                  />
                ))}
                <Link
                  href={section.href}
                  className="mt-2 block text-center text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Browse all
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
