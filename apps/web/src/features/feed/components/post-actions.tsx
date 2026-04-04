'use client';

import { Button } from '@/components/ui/button';
import {
  HeartIcon,
  MessageCircleIcon,
  BookmarkIcon,
  ShareIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useLikePost,
  useUnlikePost,
  useBookmarkPost,
  useUnbookmarkPost,
} from '../hooks/use-feed-interactions';

interface PostActionsProps {
  postId: string;
  likeCount: number;
  commentCount: number;
  bookmarkCount: number;
  isLikedByMe: boolean;
  isBookmarkedByMe: boolean;
  onCommentClick?: () => void;
}

export function PostActions({
  postId,
  likeCount,
  commentCount,
  bookmarkCount,
  isLikedByMe,
  isBookmarkedByMe,
  onCommentClick,
}: PostActionsProps) {
  const likeMutation = useLikePost();
  const unlikeMutation = useUnlikePost();
  const bookmarkMutation = useBookmarkPost();
  const unbookmarkMutation = useUnbookmarkPost();

  const handleLike = () => {
    if (isLikedByMe) {
      unlikeMutation.mutate(postId);
    } else {
      likeMutation.mutate(postId);
    }
  };

  const handleBookmark = () => {
    if (isBookmarkedByMe) {
      unbookmarkMutation.mutate(postId);
    } else {
      bookmarkMutation.mutate(postId);
    }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/feed?post=${postId}`;
    await navigator.clipboard.writeText(url);
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className={cn('gap-1.5', isLikedByMe && 'text-red-500 hover:text-red-600')}
        onClick={handleLike}
      >
        <HeartIcon className={cn('size-4', isLikedByMe && 'fill-current')} />
        {likeCount > 0 && <span className="text-xs">{likeCount}</span>}
      </Button>

      <Button variant="ghost" size="sm" className="gap-1.5" onClick={onCommentClick}>
        <MessageCircleIcon className="size-4" />
        {commentCount > 0 && <span className="text-xs">{commentCount}</span>}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className={cn('gap-1.5', isBookmarkedByMe && 'text-yellow-500 hover:text-yellow-600')}
        onClick={handleBookmark}
      >
        <BookmarkIcon className={cn('size-4', isBookmarkedByMe && 'fill-current')} />
        {bookmarkCount > 0 && <span className="text-xs">{bookmarkCount}</span>}
      </Button>

      <Button variant="ghost" size="sm" className="gap-1.5" onClick={handleShare}>
        <ShareIcon className="size-4" />
      </Button>
    </div>
  );
}
