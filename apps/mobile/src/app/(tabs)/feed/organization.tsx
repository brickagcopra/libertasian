import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { useOrganizationFeed } from '../../../features/feed/hooks/use-feed';
import { FeedList } from '../../../features/feed/components/feed-list';

export default function OrganizationFeedScreen() {
  const feed = useOrganizationFeed();
  const posts = feed.data?.pages.flatMap((p) => p.data) ?? [];

  const handleRefresh = useCallback(() => {
    feed.refetch();
  }, [feed]);

  return (
    <View style={styles.container}>
      <FeedList
        posts={posts}
        isLoading={feed.isLoading}
        isFetchingNextPage={feed.isFetchingNextPage}
        hasNextPage={!!feed.hasNextPage}
        isRefreshing={feed.isRefetching && !feed.isFetchingNextPage}
        fetchNextPage={() => feed.fetchNextPage()}
        onRefresh={handleRefresh}
        emptyIcon="people-outline"
        emptyTitle="No organization posts"
        emptyMessage="Posts from your organization members will appear here."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
});
