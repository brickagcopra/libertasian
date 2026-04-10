import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUserProfileFeed } from '../../../../features/feed/hooks/use-feed';
import { FeedList } from '../../../../features/feed/components/feed-list';

export default function UserFeedScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const feed = useUserProfileFeed(userId ?? '');
  const posts = feed.data?.pages.flatMap((p) => p.data) ?? [];

  const authorName = posts.length > 0 ? posts[0].author.fullName : 'User';

  const handleRefresh = useCallback(() => {
    feed.refetch();
  }, [feed]);

  const ProfileHeader = useCallback(() => (
    <View style={styles.profileHeader}>
      <View style={styles.profileAvatar}>
        <Ionicons name="person" size={32} color="#6b7280" />
      </View>
      <Text style={styles.profileName}>{authorName}</Text>
      <Text style={styles.profilePostCount}>
        {posts.length} {posts.length === 1 ? 'post' : 'posts'}
      </Text>
    </View>
  ), [authorName, posts.length]);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: authorName + "'s Posts",
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
        emptyIcon="person-outline"
        emptyTitle="No posts"
        emptyMessage="This user hasn't shared any posts yet."
        ListHeaderComponent={ProfileHeader}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  profilePostCount: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
});
