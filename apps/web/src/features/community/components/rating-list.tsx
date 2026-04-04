'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { AlertCircleIcon, UserIcon } from 'lucide-react';

import { useRatings } from '../hooks/use-community-ratings';
import type { CommunityEntityType, CommunityRating, RatingAggregate } from '../types';
import { StarRatingDisplay } from './star-rating';

function RatingDistribution({ aggregate }: { aggregate: RatingAggregate }) {
  const total = aggregate.ratingCount || 1;

  return (
    <div className="space-y-1">
      {[5, 4, 3, 2, 1].map((star) => {
        const count = aggregate.distribution[star] ?? 0;
        const pct = (count / total) * 100;

        return (
          <div key={star} className="flex items-center gap-2 text-xs">
            <span className="w-3 text-right text-muted-foreground">{star}</span>
            <Progress value={pct} className="h-2 flex-1" />
            <span className="w-6 text-right text-muted-foreground">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function RatingItem({ rating }: { rating: CommunityRating }) {
  return (
    <div className="border-b py-3 last:border-b-0">
      <div className="flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-medium">
          {rating.user?.fullName?.charAt(0).toUpperCase() ?? <UserIcon className="size-3" />}
        </div>
        <span className="text-sm font-medium">{rating.user?.fullName ?? 'Anonymous'}</span>
        <StarRatingDisplay value={rating.score} size="sm" />
        <span className="ml-auto text-xs text-muted-foreground">
          {new Date(rating.createdAt).toLocaleDateString()}
        </span>
      </div>
      {rating.reviewTitle && (
        <p className="mt-1.5 text-sm font-medium">{rating.reviewTitle}</p>
      )}
      {rating.reviewBody && (
        <p className="mt-1 text-sm text-muted-foreground">{rating.reviewBody}</p>
      )}
    </div>
  );
}

interface RatingListProps {
  entityType: CommunityEntityType;
  entityId: string;
}

export function RatingList({ entityType, entityId }: RatingListProps) {
  const { data, isLoading, error } = useRatings(entityType, entityId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2 border-b py-3">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon className="size-4" />
        <AlertDescription>Failed to load ratings.</AlertDescription>
      </Alert>
    );
  }

  const ratings = data?.data ?? [];
  const aggregate = data?.aggregate;

  return (
    <div className="space-y-4">
      {/* Aggregate summary */}
      {aggregate && aggregate.ratingCount > 0 && (
        <div className="flex gap-6 rounded-lg border p-4">
          <div className="text-center">
            <p className="text-3xl font-bold">
              {aggregate.avgRating?.toFixed(1) ?? '—'}
            </p>
            <StarRatingDisplay value={aggregate.avgRating} size="md" />
            <p className="mt-1 text-xs text-muted-foreground">
              {aggregate.ratingCount} {aggregate.ratingCount === 1 ? 'rating' : 'ratings'}
            </p>
          </div>
          <div className="flex-1">
            <RatingDistribution aggregate={aggregate} />
          </div>
        </div>
      )}

      {/* Rating list */}
      {ratings.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No ratings yet. Be the first to rate!
        </p>
      ) : (
        <div>
          {ratings.map((rating) => (
            <RatingItem key={rating.id} rating={rating} />
          ))}
        </div>
      )}
    </div>
  );
}
