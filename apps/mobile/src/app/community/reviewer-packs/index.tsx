import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useMarketplaceReviewerPacks } from '../../../features/community/hooks/use-marketplace';
import { MarketplaceItemCard } from '../../../features/community/components/marketplace-item-card';
import type { MarketplaceSortBy, MarketplaceItem } from '../../../features/community/types';

const SORT_OPTIONS: Array<{ value: MarketplaceSortBy; label: string }> = [
  { value: 'top_rated', label: 'Top Rated' },
  { value: 'newest', label: 'Newest' },
  { value: 'most_reviewed', label: 'Most Reviewed' },
  { value: 'trending', label: 'Trending' },
];

export default function MarketplaceReviewerPacksScreen() {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<MarketplaceSortBy>('top_rated');

  const { data, isLoading, isFetching, refetch } = useMarketplaceReviewerPacks({
    sortBy,
    search: search.trim() || undefined,
  });

  const items = data?.data?.items ?? [];

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const renderItem = useCallback(
    ({ item }: { item: MarketplaceItem }) => (
      <MarketplaceItemCard item={item} />
    ),
    [],
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Reviewer Packs' }} />
      <View style={styles.container}>
        {/* Search */}
        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={16} color="#9ca3af" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search reviewer packs..."
              placeholderTextColor="#9ca3af"
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={16} color="#9ca3af" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Sort pills */}
        <View style={styles.sortRow}>
          {SORT_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.sortPill,
                sortBy === opt.value && styles.sortPillActive,
              ]}
              onPress={() => setSortBy(opt.value)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.sortPillText,
                  sortBy === opt.value && styles.sortPillTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* List */}
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshing={isFetching && !isLoading}
          onRefresh={handleRefresh}
          ListEmptyComponent={
            isLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color="#1a56db" />
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Ionicons name="book-outline" size={40} color="#d1d5db" />
                <Text style={styles.emptyText}>
                  No reviewer packs found. Try adjusting your search.
                </Text>
              </View>
            )
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  searchRow: { paddingHorizontal: 12, paddingTop: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 10,
    gap: 8,
    height: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  sortPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sortPillActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  sortPillText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
  },
  sortPillTextActive: {
    color: '#fff',
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 32,
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
  },
});
