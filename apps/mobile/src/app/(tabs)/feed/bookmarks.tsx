import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { useBookmarkedPosts } from '../../../features/feed/hooks/use-feed';
import { FeedList } from '../../../features/feed/components/feed-list';

export default function BookmarkedPostsScreen() {
  const feed = useBookmarkedPosts();
  const posts = feed.data?.pages.flatMap((p) => p.data) ?? [];

  const handleRefresh = useCallback(() => {
    feed.refetch();
  }, [feed]);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Saved Posts',
          headerStyle: { backgroundColor: '#fff' },
          headerTitleStyle: { fontSize: 17, fontWeight: '600', color: '#111827' },
        }}
      />
      <FeedList
        posts={posts}
        isLoading={feed.isLoading}
        isFetchingNextPage={feed.isFetchingNextPage}
        hasNextPage={!!feed.hasNextPage}
        isRefreshing={feed.isRefetching && !feed.isFetchingNextPage}
        fetchNextPage={() => feed.fetchNextPage()}
        onRefresh={handleRefresh}
        emptyIcon="bookmark-outline"
        emptyTitle="No saved posts"
        emptyMessage="Posts you bookmark will appear here for easy access."
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
