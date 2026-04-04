'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';

import { useMyVote, useRemoveVote, useUpsertVote } from '../hooks/use-community-votes';
import type { VoteType } from '../types';

interface VoteButtonsProps {
  entityType: string;
  entityId: string;
  voteScore?: number;
}

export function VoteButtons({ entityType, entityId, voteScore }: VoteButtonsProps) {
  const { data: myVoteRes } = useMyVote(entityType, entityId);
  const upsertVote = useUpsertVote();
  const removeVote = useRemoveVote();

  const myVote = myVoteRes?.data ?? null;
  const isUpvoted = myVote?.voteType === 'up';
  const isDownvoted = myVote?.voteType === 'down';
  const isPending = upsertVote.isPending || removeVote.isPending;

  const handleVote = (voteType: VoteType) => {
    if (isPending) return;

    // Toggle off if same vote
    if (myVote?.voteType === voteType) {
      removeVote.mutate({ entityType, entityId });
    } else {
      upsertVote.mutate({ entityType, entityId, voteType });
    }
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-8 gap-1 px-2',
          isUpvoted && 'bg-green-50 text-green-700 hover:bg-green-100 hover:text-green-800',
        )}
        onClick={() => handleVote('up')}
        disabled={isPending}
      >
        <ThumbsUpIcon className={cn('size-3.5', isUpvoted && 'fill-current')} />
      </Button>

      {voteScore != null && (
        <span
          className={cn(
            'min-w-[2ch] text-center text-xs font-medium',
            voteScore > 0 && 'text-green-700',
            voteScore < 0 && 'text-red-600',
            voteScore === 0 && 'text-muted-foreground',
          )}
        >
          {voteScore}
        </span>
      )}

      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-8 gap-1 px-2',
          isDownvoted && 'bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700',
        )}
        onClick={() => handleVote('down')}
        disabled={isPending}
      >
        <ThumbsDownIcon className={cn('size-3.5', isDownvoted && 'fill-current')} />
      </Button>
    </div>
  );
}
