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
import { useNotes, useDeleteNote } from '../../../features/workspace/hooks/use-notes';
import type { NoteListItem, NoteVisibility } from '../../../features/workspace/types';

const VISIBILITY_OPTIONS: { label: string; value: NoteVisibility | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Private', value: 'private' },
  { label: 'Organization', value: 'org' },
];

function NoteCard({
  item,
  onDelete,
}: {
  item: NoteListItem;
  onDelete: (id: string) => void;
}) {
  const bodyText = extractPlainText(item.body);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/workspace/notes/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View
            style={[
              styles.visibilityBadge,
              item.visibility === 'org' ? styles.orgBadge : styles.privateBadge,
            ]}
          >
            <Ionicons
              name={item.visibility === 'org' ? 'people-outline' : 'lock-closed-outline'}
              size={10}
              color={item.visibility === 'org' ? '#059669' : '#6b7280'}
            />
            <Text
              style={[
                styles.visibilityText,
                item.visibility === 'org' ? styles.orgText : styles.privateText,
              ]}
            >
              {item.visibility === 'org' ? 'Org' : 'Private'}
            </Text>
          </View>
          {item.matter ? (
            <View style={styles.matterLink}>
              <Ionicons name="folder-outline" size={11} color="#1a56db" />
              <Text style={styles.matterLinkText} numberOfLines={1}>
                {item.matter.title}
              </Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => onDelete(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={16} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <Text style={styles.cardTitle} numberOfLines={1}>
        {item.title ?? 'Untitled Note'}
      </Text>

      {bodyText ? (
        <Text style={styles.cardBody} numberOfLines={2}>
          {bodyText}
        </Text>
      ) : null}

      <View style={styles.cardFooter}>
        <Text style={styles.footerText}>{item.user.fullName}</Text>
        <Text style={styles.footerText}>
          {new Date(item.updatedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/** Extract plain text from Tiptap JSON for preview */
function extractPlainText(body: Record<string, unknown>): string {
  if (!body || typeof body !== 'object') return '';
  const content = body['content'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return '';

  const texts: string[] = [];
  for (const node of content) {
    const nodeContent = node['content'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(nodeContent)) {
      for (const child of nodeContent) {
        if (child['type'] === 'text' && typeof child['text'] === 'string') {
          texts.push(child['text']);
        }
      }
    }
  }
  return texts.join(' ').slice(0, 200);
}

export default function NotesListScreen() {
  const [visibilityFilter, setVisibilityFilter] = useState<NoteVisibility | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, isFetching, refetch } = useNotes({
    limit: 30,
    visibility: visibilityFilter || undefined,
    search: search || undefined,
  });
  const deleteNote = useDeleteNote();

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert('Delete Note', 'Are you sure you want to delete this note?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteNote.mutate(id),
        },
      ]);
    },
    [deleteNote],
  );

  const handleSearch = useCallback(() => {
    setSearch(searchInput.trim());
  }, [searchInput]);

  const renderItem = useCallback(
    ({ item }: { item: NoteListItem }) => (
      <NoteCard item={item} onDelete={handleDelete} />
    ),
    [handleDelete],
  );

  const keyExtractor = useCallback((item: NoteListItem) => item.id, []);

  const notes = data?.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Notes' }} />
      <View style={styles.container}>
        {/* Search Bar */}
        <View style={styles.searchRow}>
          <View style={styles.searchInputContainer}>
            <Ionicons name="search-outline" size={16} color="#9ca3af" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search notes..."
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
              >
                <Ionicons name="close-circle" size={16} color="#9ca3af" />
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push('/workspace/notes/create')}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Visibility Filter */}
        <View style={styles.filterRow}>
          {VISIBILITY_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.filterChip,
                visibilityFilter === opt.value && styles.filterChipActive,
              ]}
              onPress={() => setVisibilityFilter(opt.value)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  visibilityFilter === opt.value && styles.filterChipTextActive,
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
        ) : notes.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="create-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>
              {search ? 'No notes found' : 'No notes yet'}
            </Text>
            <Text style={styles.emptyText}>
              {search
                ? 'Try a different search term'
                : 'Create a note to capture your legal research'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={notes}
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
  filterChipTextActive: { color: '#fff' },

  listContent: { padding: 12, paddingTop: 0, gap: 10 },

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
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  visibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  orgBadge: { backgroundColor: '#ecfdf5' },
  privateBadge: { backgroundColor: '#f3f4f6' },
  visibilityText: { fontSize: 10, fontWeight: '600' },
  orgText: { color: '#059669' },
  privateText: { color: '#6b7280' },
  matterLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flex: 1,
  },
  matterLinkText: {
    fontSize: 11,
    color: '#1a56db',
    fontWeight: '500',
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 4,
  },
  cardBody: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
    marginBottom: 6,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    marginTop: 4,
  },
  footerText: { fontSize: 11, color: '#9ca3af' },

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
