'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlusIcon } from 'lucide-react';
import { usePublicFeed, useOrganizationFeed } from '@/features/feed/hooks/use-feed';
import { FeedList } from '@/features/feed/components/feed-list';
import { CreatePostModal } from '@/features/feed/components/create-post-modal';

type FeedTab = 'public' | 'organization';

export default function FeedPage() {
  const [tab, setTab] = useState<FeedTab>('public');
  const [createOpen, setCreateOpen] = useState(false);

  const publicFeed = usePublicFeed();
  const orgFeed = useOrganizationFeed();

  const activeFeed = tab === 'public' ? publicFeed : orgFeed;
  const posts = activeFeed.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Feed</h1>
        <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <PlusIcon className="size-4" />
          New Post
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as FeedTab)}>
        <TabsList>
          <TabsTrigger value="public">Community</TabsTrigger>
          <TabsTrigger value="organization">Organization</TabsTrigger>
        </TabsList>
      </Tabs>

      <FeedList
        posts={posts}
        isLoading={activeFeed.isLoading}
        isFetchingNextPage={activeFeed.isFetchingNextPage}
        hasNextPage={activeFeed.hasNextPage}
        fetchNextPage={activeFeed.fetchNextPage}
        emptyMessage={
          tab === 'public'
            ? 'No community posts yet. Be the first to post!'
            : 'No organization posts yet.'
        }
      />

      <CreatePostModal open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
