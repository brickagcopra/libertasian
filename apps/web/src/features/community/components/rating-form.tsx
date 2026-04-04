'use client';

import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { useMyRating, useUpsertRating, useDeleteRating } from '../hooks/use-community-ratings';
import type { CommunityEntityType } from '../types';
import { StarRatingInput } from './star-rating';

interface RatingFormProps {
  entityType: CommunityEntityType;
  entityId: string;
}

export function RatingForm({ entityType, entityId }: RatingFormProps) {
  const { data: myRatingRes } = useMyRating(entityType, entityId);
  const upsertRating = useUpsertRating();
  const deleteRating = useDeleteRating();

  const existing = myRatingRes?.data ?? null;

  const [score, setScore] = useState(existing?.score ?? 0);
  const [reviewTitle, setReviewTitle] = useState(existing?.reviewTitle ?? '');
  const [reviewBody, setReviewBody] = useState(existing?.reviewBody ?? '');
  const [isEditing, setIsEditing] = useState(!existing);

  // Sync from server when existing rating loads
  const hasExisting = !!existing;
  const [lastSyncId, setLastSyncId] = useState<string | null>(null);
  if (hasExisting && existing.id !== lastSyncId) {
    setScore(existing.score);
    setReviewTitle(existing.reviewTitle ?? '');
    setReviewBody(existing.reviewBody ?? '');
    setIsEditing(false);
    setLastSyncId(existing.id);
  }

  const handleSubmit = useCallback(() => {
    if (score === 0) return;
    upsertRating.mutate(
      {
        entityType,
        entityId,
        score,
        reviewTitle: reviewTitle.trim() || undefined,
        reviewBody: reviewBody.trim() || undefined,
      },
      {
        onSuccess: () => setIsEditing(false),
      },
    );
  }, [entityType, entityId, score, reviewTitle, reviewBody, upsertRating]);

  const handleDelete = useCallback(() => {
    if (!existing) return;
    deleteRating.mutate(
      { ratingId: existing.id, entityType, entityId },
      {
        onSuccess: () => {
          setScore(0);
          setReviewTitle('');
          setReviewBody('');
          setIsEditing(true);
          setLastSyncId(null);
        },
      },
    );
  }, [existing, entityType, entityId, deleteRating]);

  // Show compact view when not editing
  if (!isEditing && existing) {
    return (
      <div className="rounded-lg border p-4">
        <p className="text-sm font-medium">Your rating</p>
        <div className="mt-2 flex items-center gap-2">
          <StarRatingInput value={existing.score} onChange={() => {}} size="sm" />
          <span className="text-sm text-muted-foreground">{existing.score}/5</span>
        </div>
        {existing.reviewTitle && (
          <p className="mt-1 text-sm font-medium">{existing.reviewTitle}</p>
        )}
        {existing.reviewBody && (
          <p className="mt-0.5 text-sm text-muted-foreground">{existing.reviewBody}</p>
        )}
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleteRating.isPending}
          >
            Delete
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm font-medium">
        {existing ? 'Edit your rating' : 'Rate this content'}
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <Label className="text-xs">Score</Label>
          <StarRatingInput value={score} onChange={setScore} size="md" />
        </div>

        <div>
          <Label htmlFor="review-title" className="text-xs">
            Title (optional)
          </Label>
          <Input
            id="review-title"
            placeholder="Brief summary..."
            value={reviewTitle}
            onChange={(e) => setReviewTitle(e.target.value)}
            maxLength={255}
          />
        </div>

        <div>
          <Label htmlFor="review-body" className="text-xs">
            Review (optional)
          </Label>
          <Textarea
            id="review-body"
            placeholder="Share your thoughts..."
            value={reviewBody}
            onChange={(e) => setReviewBody(e.target.value)}
            rows={3}
          />
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={score === 0 || upsertRating.isPending}
          >
            {upsertRating.isPending
              ? 'Saving...'
              : existing
                ? 'Update Rating'
                : 'Submit Rating'}
          </Button>
          {existing && (
            <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
