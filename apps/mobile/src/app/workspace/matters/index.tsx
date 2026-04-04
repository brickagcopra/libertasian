import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMatters, useDeleteMatter } from '../../../features/workspace/hooks/use-matters';
import type { MatterListItem, MatterStatus } from '../../../features/workspace/types';

const STATUS_OPTIONS: { label: string; value: MatterStatus | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Closed', value: 'closed' },
  { label: 'Archived', value: 'archived' },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active: { bg: '#ecfdf5', text: '#059669' },
  closed: { bg: '#f3f4f6', text: '#6b7280' },
  archived: { bg: '#fef3c7', text: '#d97706' },
};

function MatterCard({
  item,
  onDelete,
}: {
  item: MatterListItem;
  onDelete: (id: string) => void;
}) {
  const statusColor = STATUS_COLORS[item.status] ?? STATUS_COLORS['active'];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/workspace/matters/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
          <Text style={[styles.statusBadgeText, { color: statusColor.text }]}>
            {item.status}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => onDelete(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="ellipsis-vertical" size={18} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>

      {item.description ? (
        <Text style={styles.cardDescription} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}

      <View style={styles.cardMeta}>
        {item.matterType ? (
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {item.matterType.replace(/_/g, ' ')}
            </Text>
          </View>
        ) : null}
        {item.court ? (
          <Text style={styles.metaText}>{item.court}</Text>
        ) : null}
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.footerText}>
          {item._count.documents} docs | {item._count.notes} notes
        </Text>
        <Text style={styles.footerText}>
          {item.owner.fullName}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function MattersListScreen() {
  const [statusFilter, setStatusFilter] = useState<MatterStatus | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, isFetching, refetch } = useMatters({
    limit: 30,
    status: statusFilter || undefined,
    search: search || undefined,
  });
  const deleteMatter = useDeleteMatter();

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert('Delete Matter', 'Are you sure? This will delete all associated documents and notes.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteMatter.mutate(id),
        },
      ]);
    },
    [deleteMatter],
  );

  const handleSearch = useCallback(() => {
    setSearch(searchInput.trim());
  }, [searchInput]);

  const renderItem = useCallback(
    ({ item }: { item: MatterListItem }) => (
      <MatterCard item={item} onDelete={handleDelete} />
    ),
    [handleDelete],
  );

  const keyExtractor = useCallback((item: MatterListItem) => item.id, []);

  const matters = data?.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Matters' }} />
      <View style={styles.container}>
        {/* Search Bar */}
        <View style={styles.searchRow}>
          <View style={styles.searchInputContainer}>
            <Ionicons name="search-outline" size={16} color="#9ca3af" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search matters..."
              placeholderTextColor="#9ca3af"
              value={searchInput}
              onChangeText={setSearchInput}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {searchInput.length > 0 ? (
              <TouchableOpacity
                onPress={() => {
                  setSearchInput('');
                  setSearch('');
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close-circle" size={16} color="#9ca3af" />
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push('/workspace/matters/create')}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Status Filter */}
        <View style={styles.filterRow}>
          {STATUS_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.filterChip,
                statusFilter === opt.value && styles.filterChipActive,
              ]}
              onPress={() => setStatusFilter(opt.value)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  statusFilter === opt.value && styles.filterChipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* List */}
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : matters.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>
              {search ? 'No matters found' : 'No matters yet'}
            </Text>
            <Text style={styles.emptyText}>
              {search
                ? 'Try a different search term'
                : 'Create a matter to organize your legal work'}
            </Text>
            {!search ? (
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => router.push('/workspace/matters/create')}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.emptyButtonText}>New Matter</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          <FlatList
            data={matters}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={isFetching && !isLoading}
                onRefresh={() => refetch()}
                colors={['#1a56db']}
              />
            }
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Search
  searchRow: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: 0,
    gap: 8,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    paddingVertical: 10,
  },
  addButton: {
    backgroundColor: '#1a56db',
    borderRadius: 8,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Filters
  filterRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#fff',
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
    color: '#374151',
  },
  filterChipTextActive: {
    color: '#fff',
  },

  // List
  listContent: { padding: 12, paddingTop: 0, gap: 10 },

  // Card
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
    marginBottom: 6,
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  typeBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },
  metaText: { fontSize: 12, color: '#6b7280' },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    marginTop: 4,
  },
  footerText: { fontSize: 11, color: '#9ca3af' },

  // Empty
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
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 16,
  },
  emptyButtonText: { fontSize: 14, fontWeight: '600', color: '#fff' },
});
