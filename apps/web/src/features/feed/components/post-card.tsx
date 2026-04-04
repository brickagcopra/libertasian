'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PinIcon } from 'lucide-react';
import type { FeedPostItem } from '@libertasian/types';
import { PostActions } from './post-actions';
import { PostMenu } from './post-menu';
import { CommentSection } from './comment-section';

interface PostCardProps {
  post: FeedPostItem;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

const TEXT_TRUNCATE_LENGTH = 500;

export function PostCard({ post }: PostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showComments, setShowComments] = useState(false);

  const textContent = post.textContent ?? '';
  const isTruncated = textContent.length > TEXT_TRUNCATE_LENGTH;
  const displayText = expanded ? textContent : textContent.slice(0, TEXT_TRUNCATE_LENGTH);

  const mediaUrl = post.media?.processedObjectKey
    ? `/api/v1/feed/media/${post.media.id}/image?variant=feed`
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback>{getInitials(post.author.fullName)}</AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{post.author.fullName}</p>
                {post.isPinned && (
                  <Badge variant="secondary" className="gap-1 text-[10px]">
                    <PinIcon className="size-3" />
                    Pinned
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{formatRelativeTime(post.createdAt)}</span>
                {post.editedAt && <span>(edited)</span>}
                {post.visibility === 'public' && (
                  <Badge variant="outline" className="text-[10px]">
                    Public
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <PostMenu postId={post.id} authorId={post.author.id} />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {textContent && (
          <div className="text-sm leading-relaxed whitespace-pre-wrap">
            {displayText}
            {isTruncated && !expanded && (
              <>
                {'... '}
                <button
                  className="text-sm font-medium text-primary hover:underline"
                  onClick={() => setExpanded(true)}
                >
                  Read more
                </button>
              </>
            )}
          </div>
        )}

        {mediaUrl && (
          <div className="overflow-hidden rounded-lg border">
            <img
              src={mediaUrl}
              alt="Post image"
              className="w-full object-cover"
              style={{
                maxHeight: '512px',
                aspectRatio:
                  post.media?.width && post.media?.height
                    ? `${post.media.width}/${post.media.height}`
                    : undefined,
              }}
              loading="lazy"
            />
          </div>
        )}

        <PostActions
          postId={post.id}
          likeCount={post.likeCount}
          commentCount={post.commentCount}
          bookmarkCount={post.bookmarkCount}
          isLikedByMe={post.isLikedByMe}
          isBookmarkedByMe={post.isBookmarkedByMe}
          onCommentClick={() => setShowComments((v) => !v)}
        />

        {showComments && <CommentSection postId={post.id} />}
      </CardContent>
    </Card>
  );
}
