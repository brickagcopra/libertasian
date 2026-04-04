import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePublicFeed, useOrganizationFeed } from '../../../features/feed/hooks/use-feed';
import { FeedList } from '../../../features/feed/components/feed-list';

type FeedTab = 'organization' | 'public';

export default function FeedIndexScreen() {
  const [activeTab, setActiveTab] = useState<FeedTab>('organization');

  const orgFeed = useOrganizationFeed();
  const publicFeed = usePublicFeed();

  const feed = activeTab === 'organization' ? orgFeed : publicFeed;
  const posts = feed.data?.pages.flatMap((p) => p.data) ?? [];

  const handleRefresh = useCallback(() => {
    feed.refetch();
  }, [feed]);

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'organization' && styles.tabActive]}
          onPress={() => setActiveTab('organization')}
        >
          <Text style={[styles.tabText, activeTab === 'organization' && styles.tabTextActive]}>
            My Org
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'public' && styles.tabActive]}
          onPress={() => setActiveTab('public')}
        >
          <Text style={[styles.tabText, activeTab === 'public' && styles.tabTextActive]}>
            Public
          </Text>
        </TouchableOpacity>

        <View style={styles.tabSpacer} />

        <TouchableOpacity
          style={styles.bookmarksButton}
          onPress={() => router.push('/feed/bookmarks' as `/${string}`)}
        >
          <Ionicons name="bookmark-outline" size={20} color="#6b7280" />
        </TouchableOpacity>
      </View>

      {/* Feed list */}
      <FeedList
        posts={posts}
        isLoading={feed.isLoading}
        isFetchingNextPage={feed.isFetchingNextPage}
        hasNextPage={!!feed.hasNextPage}
        isRefreshing={feed.isRefetching && !feed.isFetchingNextPage}
        fetchNextPage={() => feed.fetchNextPage()}
        onRefresh={handleRefresh}
      />

      {/* FAB - Create post */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/feed/create' as `/${string}`)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 8,
  },
  tabActive: {
    backgroundColor: '#eff6ff',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#1a56db',
  },
  tabSpacer: {
    flex: 1,
  },
  bookmarksButton: {
    padding: 8,
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1a56db',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1a56db',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
