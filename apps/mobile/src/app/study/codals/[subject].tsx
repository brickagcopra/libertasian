import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useInfiniteCodals,
  useOfflineCodals as useOfflineFallback,
  type CodalTabGroup,
} from '../../../features/study/hooks/use-codals';
import { useOfflineCodals } from '../../../features/study/hooks/use-offline-codals';
import { useNetworkState } from '../../../hooks/use-network-state';
import { OfflineBanner } from '../../../components/offline-banner';
import { CodalCard } from '../../../features/study/components/codal-card';
import type { CodalListItem } from '../../../features/study/types';

interface TabConfig {
  key: CodalTabGroup;
  label: string;
}

const TABS: TabConfig[] = [
  { key: 'statutes', label: 'Statutes' },
  { key: 'constitutions', label: 'Constitutions' },
  { key: 'executive_issuances', label: 'Executive Issuances' },
  { key: 'rules', label: 'Rules' },
];

function emptyCopyFor(tabGroup: CodalTabGroup, subjectLabel: string): string {
  switch (tabGroup) {
    case 'statutes':
      return `No statutes yet for ${subjectLabel}.`;
    case 'constitutions':
      return `No constitutional documents yet for ${subjectLabel}.`;
    case 'executive_issuances':
      return 'Executive issuances are not yet in the library. Coming soon.';
    case 'rules':
      return `No rules yet for ${subjectLabel}.`;
  }
}

export default function CodalListScreen() {
  const { subject } = useLocalSearchParams<{ subject: string }>();
  const subjectCode = subject ?? '';

  const [search, setSearch] = useState('');
  const [tabGroup, setTabGroup] = useState<CodalTabGroup>('statutes');
  const [searchQuery, setSearchQuery] = useState('');

  const { isConnected, isInternetReachable } = useNetworkState();
  const isOnline = isConnected && isInternetReachable;

  const { isOffline, saveForOffline, removeOffline, saving } =
    useOfflineCodals();

  // Online: fetch from API
  const {
    data,
    isLoading: onlineLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfiniteCodals({
    subject: subjectCode,
    tabGroup,
    search: searchQuery || undefined,
  });

  // Offline: fall back to SQLite cache
  const { data: offlineData, isLoading: offlineLoading } = useOfflineFallback({
    subject: subjectCode,
    tabGroup,
    search: searchQuery || undefined,
    enabled: !isOnline,
  });

  const allCodals = isOnline
    ? (data?.pages.flatMap((page) => page.data) ?? [])
    : offlineData;

  const isLoading = isOnline ? onlineLoading : offlineLoading;

  const handleSearch = useCallback(() => {
    setSearchQuery(search.trim());
  }, [search]);

  const handleToggleOffline = useCallback(
    async (codalId: string) => {
      if (isOffline(codalId)) {
        await removeOffline(codalId);
      } else {
        await saveForOffline(codalId, subjectCode);
      }
    },
    [isOffline, removeOffline, saveForOffline, subjectCode],
  );

  const renderItem = useCallback(
    ({ item }: { item: CodalListItem }) => (
      <CodalCard
        item={item}
        isOffline={isOffline(item.id)}
        isSaving={saving === item.id}
        onToggleOffline={() => handleToggleOffline(item.id)}
      />
    ),
    [isOffline, saving, handleToggleOffline],
  );

  const subjectName = subjectCode.replace(/_/g, ' ');
  const subjectLabel =
    subjectName.charAt(0).toUpperCase() + subjectName.slice(1);

  return (
    <>
      <Stack.Screen
        options={{
          title: subjectLabel,
          headerBackTitle: 'Subjects',
        }}
      />
      <View style={styles.container}>
        {/* Offline Banner */}
        {!isOnline ? <OfflineBanner /> : null}

        {/* Search Bar */}
        <View style={styles.searchBar}>
          <View style={styles.searchInput}>
            <Ionicons name="search-outline" size={18} color="#9ca3af" />
            <TextInput
              style={styles.searchText}
              value={search}
              onChangeText={setSearch}
              placeholder="Search codals..."
              placeholderTextColor="#9ca3af"
              returnKeyType="search"
              onSubmitEditing={handleSearch}
            />
            {search.length > 0 ? (
              <TouchableOpacity
                onPress={() => {
                  setSearch('');
                  setSearchQuery('');
                }}
              >
                <Ionicons name="close-circle" size={18} color="#9ca3af" />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Tab Bar — 4 codal groups */}
        <View style={styles.tabBar}>
          {TABS.map((tab) => {
            const isActive = tabGroup === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, isActive ? styles.tabActive : null]}
                onPress={() => setTabGroup(tab.key)}
                activeOpacity={0.7}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
              >
                <Text
                  style={[
                    styles.tabLabel,
                    isActive ? styles.tabLabelActive : null,
                  ]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : allCodals.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons
              name={isOnline ? 'book-outline' : 'cloud-offline-outline'}
              size={48}
              color="#d1d5db"
            />
            <Text style={styles.emptyTitle}>
              {isOnline ? 'Nothing here yet' : 'No cached codals'}
            </Text>
            <Text style={styles.emptyText}>
              {!isOnline
                ? 'Download codals while online to read them offline'
                : searchQuery
                  ? `No results for "${searchQuery}"`
                  : emptyCopyFor(tabGroup, subjectLabel)}
            </Text>
          </View>
        ) : (
          <FlatList
            data={allCodals}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            onEndReached={() => {
              if (isOnline && hasNextPage && !isFetchingNextPage) {
                fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.3}
            ListFooterComponent={
              isFetchingNextPage ? (
                <ActivityIndicator
                  color="#1a56db"
                  style={styles.footerLoader}
                />
              ) : null
            }
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  searchBar: { padding: 12, paddingBottom: 0 },
  searchInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  searchText: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    padding: 0,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#1a56db',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    textAlign: 'center',
  },
  tabLabelActive: {
    color: '#1a56db',
    fontWeight: '600',
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { padding: 12, gap: 10 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  footerLoader: { paddingVertical: 16 },
});
