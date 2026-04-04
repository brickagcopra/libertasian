import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useBookmarks,
  useDeleteBookmark,
} from '../../features/bookmarks/hooks/use-bookmarks';
import type { Bookmark } from '../../features/bookmarks/types';

function BookmarkCard({
  item,
  onDelete,
}: {
  item: Bookmark;
  onDelete: (id: string) => void;
}) {
  const doc = item.legalDocument;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => {
        if (doc) router.push(`/reader/${doc.id}`);
      }}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        {doc?.documentType ? (
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {doc.documentType.replace(/_/g, ' ')}
            </Text>
          </View>
        ) : null}
        <TouchableOpacity
          onPress={() => onDelete(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={18} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {doc?.title ?? 'Unknown document'}
      </Text>

      <View style={styles.cardMeta}>
        {doc?.grNo ? <Text style={styles.metaText}>{doc.grNo}</Text> : null}
        {doc?.court ? <Text style={styles.metaText}>{doc.court}</Text> : null}
        {doc?.decisionDate ? (
          <Text style={styles.metaText}>
            {new Date(doc.decisionDate).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
            })}
          </Text>
        ) : null}
      </View>

      {item.note ? (
        <View style={styles.noteContainer}>
          <Ionicons name="chatbubble-outline" size={12} color="#6b7280" />
          <Text style={styles.noteText} numberOfLines={2}>
            {item.note}
          </Text>
        </View>
      ) : null}

      <Text style={styles.dateText}>
        Saved{' '}
        {new Date(item.createdAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </Text>
    </TouchableOpacity>
  );
}

export default function BookmarksScreen() {
  const { data, isLoading, isFetching, refetch } = useBookmarks({ limit: 50 });
  const deleteBookmark = useDeleteBookmark();

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert('Delete Bookmark', 'Are you sure you want to remove this bookmark?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteBookmark.mutate(id),
        },
      ]);
    },
    [deleteBookmark],
  );

  const renderItem = useCallback(
    ({ item }: { item: Bookmark }) => (
      <BookmarkCard item={item} onDelete={handleDelete} />
    ),
    [handleDelete],
  );

  const keyExtractor = useCallback((item: Bookmark) => item.id, []);

  const bookmarks = data?.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Bookmarks' }} />
      <View style={styles.container}>
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : bookmarks.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="bookmark-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No bookmarks yet</Text>
            <Text style={styles.emptyText}>
              Save legal documents while reading to find them quickly later
            </Text>
          </View>
        ) : (
          <FlatList
            data={bookmarks}
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
  listContent: { padding: 12, gap: 10 },
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
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 6,
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  metaText: { fontSize: 12, color: '#6b7280' },
  noteContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#f9fafb',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
  },
  noteText: { flex: 1, fontSize: 13, color: '#4b5563', lineHeight: 18 },
  dateText: { fontSize: 11, color: '#9ca3af' },
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
});
