import React, { useCallback } from 'react';
import {
  FlatList,
  View,
  Text,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FeedPostItem } from '@libertasian/types';
import { PostCard } from './post-card';
import { FeedSkeleton } from './feed-skeleton';

interface FeedListProps {
  posts: FeedPostItem[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  isRefreshing: boolean;
  fetchNextPage: () => void;
  onRefresh: () => void;
  currentUserId?: string;
  emptyIcon?: string;
  emptyTitle?: string;
  emptyMessage?: string;
  ListHeaderComponent?: React.ComponentType<unknown>;
  /**
   * Extra bottom padding, in points. Opt-in because only the Feed tab renders
   * the floating pill TabBar over this list — the bookmarks, organization and
   * user-profile feeds do not, and padding them all would be dead whitespace.
   * Pass 96 to match `(tabs)/digests.tsx` listContent.
   */
  contentBottomPadding?: number;
  /**
   * Extra top padding, in points. Opt-in for the same reason as
   * contentBottomPadding: only the routes rendered with headerShown: false
   * (feed/index, feed/organization) start at y=0 and need to clear the notch.
   * Routes with a native header already sit below it.
   */
  contentTopPadding?: number;
}

export function FeedList({
  posts,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  isRefreshing,
  fetchNextPage,
  onRefresh,
  currentUserId,
  emptyIcon = 'newspaper-outline',
  emptyTitle = 'No posts yet',
  emptyMessage = 'Be the first to share something with the community!',
  ListHeaderComponent,
  contentBottomPadding,
  contentTopPadding,
}: FeedListProps) {
  const renderItem = useCallback(
    ({ item }: { item: FeedPostItem }) => (
      <PostCard post={item} currentUserId={currentUserId} />
    ),
    [currentUserId],
  );

  const keyExtractor = useCallback((item: FeedPostItem) => item.id, []);

  if (isLoading) {
    return <FeedSkeleton />;
  }

  return (
    <FlatList
      data={posts}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={[
        styles.content,
        posts.length === 0 && styles.emptyContent,
        contentBottomPadding !== undefined && { paddingBottom: contentBottomPadding },
        contentTopPadding !== undefined && { paddingTop: contentTopPadding },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isRefreshing}
          onRefresh={onRefresh}
          tintColor="#1a56db"
          colors={['#1a56db']}
        />
      }
      onEndReached={() => {
        if (hasNextPage) fetchNextPage();
      }}
      onEndReachedThreshold={0.3}
      ListHeaderComponent={ListHeaderComponent}
      ListFooterComponent={
        isFetchingNextPage ? (
          <ActivityIndicator size="small" color="#1a56db" style={styles.footer} />
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.emptyContainer}>
          <Ionicons name={emptyIcon as keyof typeof Ionicons.glyphMap} size={48} color="#d1d5db" />
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptyMessage}>{emptyMessage}</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  emptyContent: {
    flexGrow: 1,
  },
  footer: {
    paddingVertical: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 8,
  },
  emptyMessage: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    paddingHorizontal: 48,
    lineHeight: 18,
  },
});
