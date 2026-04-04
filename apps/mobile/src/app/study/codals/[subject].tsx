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
import { useInfiniteCodals, useOfflineCodals as useOfflineFallback } from '../../../features/study/hooks/use-codals';
import { useOfflineCodals } from '../../../features/study/hooks/use-offline-codals';
import { useNetworkState } from '../../../hooks/use-network-state';
import { OfflineBanner } from '../../../components/offline-banner';
import { CodalCard } from '../../../features/study/components/codal-card';
import type { CodalListItem } from '../../../features/study/types';

const DOC_TYPE_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Republic Act', value: 'republic_act' },
  { label: 'Executive Order', value: 'executive_order' },
  { label: 'Presidential Decree', value: 'presidential_decree' },
  { label: 'Batas Pambansa', value: 'batas_pambansa' },
  { label: 'Other', value: 'administrative_order' },
];

export default function CodalListScreen() {
  const { subject } = useLocalSearchParams<{ subject: string }>();
  const subjectCode = subject ?? '';

  const [search, setSearch] = useState('');
  const [docType, setDocType] = useState('');
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
    documentType: docType || undefined,
    search: searchQuery || undefined,
  });

  // Offline: fall back to SQLite cache
  const { data: offlineData, isLoading: offlineLoading } = useOfflineFallback({
    subject: subjectCode,
    documentType: docType || undefined,
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

  return (
    <>
      <Stack.Screen
        options={{
          title: subjectName.charAt(0).toUpperCase() + subjectName.slice(1),
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

        {/* Document Type Filter */}
        <View style={styles.filterRow}>
          {DOC_TYPE_FILTERS.map((filter) => (
            <TouchableOpacity
              key={filter.value}
              style={[
                styles.filterChip,
                docType === filter.value && styles.filterChipActive,
              ]}
              onPress={() => setDocType(filter.value)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  docType === filter.value && styles.filterChipTextActive,
                ]}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
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
              {isOnline ? 'No codals found' : 'No cached codals'}
            </Text>
            <Text style={styles.emptyText}>
              {!isOnline
                ? 'Download codals while online to read them offline'
                : searchQuery
                  ? `No results for "${searchQuery}"`
                  : 'No codals available for this subject'}
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
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  filterChip: {
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  filterChipActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
  },
  filterChipTextActive: {
    color: '#fff',
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
