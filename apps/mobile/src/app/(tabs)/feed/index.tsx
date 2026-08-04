import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePublicFeed, useOrganizationFeed } from '../../../features/feed/hooks/use-feed';
import { FeedList } from '../../../features/feed/components/feed-list';
import { TabBar } from '@/components/ui/TabBar';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';
import { useTheme } from '@/providers/theme-provider';

type FeedTab = 'organization' | 'public';

export default function FeedIndexScreen() {
  const { theme } = useTheme();
  const navigate = useTabBarNav();
  const [activeTab, setActiveTab] = useState<FeedTab>('organization');

  const orgFeed = useOrganizationFeed();
  const publicFeed = usePublicFeed();

  const feed = activeTab === 'organization' ? orgFeed : publicFeed;
  const posts = feed.data?.pages.flatMap((p) => p.data) ?? [];

  const handleRefresh = useCallback(() => {
    feed.refetch();
  }, [feed]);

  return (
    <View style={[styles.container, { backgroundColor: theme.bg }]}>
      {/* Tab bar */}
      <View
        style={[
          styles.tabBar,
          { backgroundColor: theme.surface, borderBottomColor: theme.line },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.tab,
            { backgroundColor: activeTab === 'organization' ? theme.pillBg : theme.chipBg },
          ]}
          onPress={() => setActiveTab('organization')}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'organization' ? theme.pillInk : theme.inkSoft },
            ]}
          >
            My Org
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.tab,
            { backgroundColor: activeTab === 'public' ? theme.pillBg : theme.chipBg },
          ]}
          onPress={() => setActiveTab('public')}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'public' ? theme.pillInk : theme.inkSoft },
            ]}
          >
            Public
          </Text>
        </TouchableOpacity>

        <View style={styles.tabSpacer} />

        <TouchableOpacity
          style={styles.bookmarksButton}
          onPress={() => router.push('/feed/bookmarks' as `/${string}`)}
        >
          <Ionicons name="bookmark-outline" size={20} color={theme.inkSoft} />
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
        contentBottomPadding={96}
      />

      {/* FAB - Create post */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: theme.accent, shadowColor: theme.accent }]}
        onPress={() => router.push('/feed/create' as `/${string}`)}
        activeOpacity={0.8}
      >
        <Ionicons name="add" size={28} color={theme.accentInk} />
      </TouchableOpacity>

      {/* Floating pill TabBar — same treatment as Home/Search/Digests. The
          list's contentBottomPadding: 96 keeps the last post clear of it. */}
      <TabBar active="feed" onPress={navigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginRight: 8,
  },
  tabText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  tabSpacer: {
    flex: 1,
  },
  bookmarksButton: {
    padding: 8,
  },
  fab: {
    position: 'absolute',
    // 90, matching the shared `Fab` component's default, so the create-post
    // button clears the floating pill TabBar instead of sitting under it.
    bottom: 90,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
