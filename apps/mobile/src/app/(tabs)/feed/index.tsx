import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { usePublicFeed, useOrganizationFeed } from '../../../features/feed/hooks/use-feed';
import { FeedList } from '../../../features/feed/components/feed-list';
import { Fab } from '@/components/ui/Fab';
import { TabBar, useTabBarClearance } from '@/components/ui/TabBar';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';
import { topInsetPadding } from '@/lib/safe-area';
import { useTheme } from '@/providers/theme-provider';

type FeedTab = 'organization' | 'public';

export default function FeedIndexScreen() {
  const { theme } = useTheme();
  const navigate = useTabBarNav();
  const clearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
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
        testID="feed-chip-row"
        style={[
          styles.tabBar,
          {
            backgroundColor: theme.surface,
            borderBottomColor: theme.line,
            // headerShown is false for this route in BOTH (tabs)/_layout.tsx
            // and feed/_layout.tsx, so this row is the topmost thing on screen
            // and starts at y=0 without an inset — under the Dynamic Island.
            paddingTop: topInsetPadding(insets, 12),
          },
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
          onPress={() => router.push('/feed/bookmarks')}
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
        contentBottomPadding={clearance}
      />

      {/* FAB - Create post. Uses the shared Fab so its offset comes from
          useTabBarClearance() rather than a local literal. */}
      <Fab
        icon="add"
        accessibilityLabel="Create post"
        right={20}
        onPress={() => router.push('/feed/create')}
      />

      {/* Floating pill TabBar — same treatment as Home/Search/Digests. The
          list's contentBottomPadding comes from the same clearance hook, so
          the last post always clears the pill. */}
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
    // paddingTop is applied inline from topInsetPadding — see the comment at
    // the call site. Only the bottom half of the old paddingVertical remains.
    paddingBottom: 8,
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
});
