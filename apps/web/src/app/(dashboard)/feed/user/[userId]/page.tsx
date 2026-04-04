'use client';

import { useParams } from 'next/navigation';
import { useUserProfileFeed } from '@/features/feed/hooks/use-feed';
import { FeedList } from '@/features/feed/components/feed-list';

export default function UserProfileFeedPage() {
  const params = useParams<{ userId: string }>();
  const userId = params?.userId ?? '';
  const feed = useUserProfileFeed(userId);
  const posts = feed.data?.pages.flatMap((p) => p.data) ?? [];

  const authorName = posts[0]?.author.fullName;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">
        {authorName ? `${authorName}'s Posts` : 'User Posts'}
      </h1>

      <FeedList
        posts={posts}
        isLoading={feed.isLoading}
        isFetchingNextPage={feed.isFetchingNextPage}
        hasNextPage={feed.hasNextPage}
        fetchNextPage={feed.fetchNextPage}
        emptyMessage="This user hasn't posted anything yet."
      />
    </div>
  );
}
