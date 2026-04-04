'use client';

import { useBookmarkedPosts } from '@/features/feed/hooks/use-feed';
import { FeedList } from '@/features/feed/components/feed-list';

export default function BookmarkedPostsPage() {
  const feed = useBookmarkedPosts();
  const posts = feed.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Bookmarked Posts</h1>

      <FeedList
        posts={posts}
        isLoading={feed.isLoading}
        isFetchingNextPage={feed.isFetchingNextPage}
        hasNextPage={feed.hasNextPage}
        fetchNextPage={feed.fetchNextPage}
        emptyMessage="No bookmarked posts yet. Bookmark posts from the feed to see them here."
      />
    </div>
  );
}
