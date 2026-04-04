'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PlusIcon } from 'lucide-react';
import { useOrganizationFeed } from '@/features/feed/hooks/use-feed';
import { FeedList } from '@/features/feed/components/feed-list';
import { CreatePostModal } from '@/features/feed/components/create-post-modal';

export default function OrganizationFeedPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const feed = useOrganizationFeed();
  const posts = feed.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Organization Feed</h1>
        <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-4" />
          New Post
        </Button>
      </div>

      <FeedList
        posts={posts}
        isLoading={feed.isLoading}
        isFetchingNextPage={feed.isFetchingNextPage}
        hasNextPage={feed.hasNextPage}
        fetchNextPage={feed.fetchNextPage}
        emptyMessage="No organization posts yet."
      />

      <CreatePostModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
