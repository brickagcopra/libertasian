'use client';

import { useEffect, useRef } from 'react';
import { LoaderIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FeedPostItem } from '@libertasian/types';
import { PostCard } from './post-card';
import { FeedSkeleton } from './feed-skeleton';

interface FeedListProps {
  posts: FeedPostItem[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  emptyMessage?: string;
}

export function FeedList({
  posts,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  fetchNextPage,
  emptyMessage = 'No posts yet.',
}: FeedListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) {
    return <FeedSkeleton />;
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}

      <div ref={sentinelRef} />

      {isFetchingNextPage && (
        <div className="flex justify-center py-4">
          <LoaderIcon className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
