import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSearch } from '../../../features/search/hooks/use-search';
import { useUploads } from '../../../features/camera-scan/hooks/use-uploads';
import { useAddMatterDocument } from '../../../features/workspace/hooks/use-matters';
import type { SearchResultItem } from '../../../features/search/types';
import type { UploadListItem } from '../../../features/camera-scan/types';

type SourceTab = 'search' | 'uploads';

const ROLE_OPTIONS = ['reference', 'evidence', 'pleading', 'research', 'note'] as const;

// ─── Legal Document Result ─────────────────────────────────

function LegalDocResult({
  item,
  onSelect,
  isAdding,
}: {
  item: SearchResultItem;
  onSelect: () => void;
  isAdding: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.resultCard}
      onPress={onSelect}
      disabled={isAdding}
      activeOpacity={0.7}
    >
      <View style={styles.resultRow}>
        <Ionicons name="document-text-outline" size={20} color="#1a56db" />
        <View style={{ flex: 1 }}>
          <Text style={styles.resultTitle} numberOfLines={2}>
            {item.source.title}
          </Text>
          <View style={styles.resultMeta}>
            {item.source.citation_text ? (
              <Text style={styles.resultMetaText}>{item.source.citation_text}</Text>
            ) : null}
            {item.source.court ? (
              <Text style={styles.resultMetaText}>{item.source.court}</Text>
            ) : null}
          </View>
          <View style={styles.resultBadges}>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{item.source.document_type}</Text>
            </View>
            {item.source.is_official ? (
              <View style={[styles.typeBadge, { backgroundColor: '#ecfdf5' }]}>
                <Text style={[styles.typeBadgeText, { color: '#059669' }]}>
                  Official
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <Ionicons name="add-circle-outline" size={22} color="#1a56db" />
      </View>
    </TouchableOpacity>
  );
}

// ─── Upload Result ─────────────────────────────────────────

function UploadResult({
  item,
  onSelect,
  isAdding,
}: {
  item: UploadListItem;
  onSelect: () => void;
  isAdding: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.resultCard}
      onPress={onSelect}
      disabled={isAdding}
      activeOpacity={0.7}
    >
      <View style={styles.resultRow}>
        <Ionicons name="cloud-upload-outline" size={20} color="#6b7280" />
        <View style={{ flex: 1 }}>
          <Text style={styles.resultTitle} numberOfLines={2}>
            {item.originalFilename ?? 'Unnamed upload'}
          </Text>
          <View style={styles.resultMeta}>
            <Text style={styles.resultMetaText}>{item.uploadType}</Text>
            <Text style={styles.resultMetaText}>
              {new Date(item.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
          </View>
        </View>
        <Ionicons name="add-circle-outline" size={22} color="#1a56db" />
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ───────────────────────────────────────────

export default function AddDocumentScreen() {
  const { matterId } = useLocalSearchParams<{ matterId: string }>();

  const [activeTab, setActiveTab] = useState<SourceTab>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('reference');

  const addDocument = useAddMatterDocument();

  // Search legal documents
  const {
    data: searchData,
    isLoading: searchLoading,
  } = useSearch({ query: searchQuery }, activeTab === 'search');

  // Uploads list
  const {
    data: uploadsData,
    isLoading: uploadsLoading,
    fetchNextPage: fetchMoreUploads,
    hasNextPage: hasMoreUploads,
  } = useUploads({ limit: 20 });

  const handleAddLegalDoc = useCallback(
    async (item: SearchResultItem) => {
      if (!matterId) return;
      try {
        await addDocument.mutateAsync({
          matterId,
          legalDocumentId: item.id,
          title: item.source.short_title ?? item.source.title,
          role: selectedRole,
        });
        Alert.alert('Added', `"${item.source.title}" attached to matter.`, [
          { text: 'OK' },
        ]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to add document';
        Alert.alert('Error', message);
      }
    },
    [matterId, selectedRole, addDocument],
  );

  const handleAddUpload = useCallback(
    async (item: UploadListItem) => {
      if (!matterId) return;
      try {
        await addDocument.mutateAsync({
          matterId,
          userUploadId: item.id,
          title: item.originalFilename ?? 'Uploaded file',
          role: selectedRole,
        });
        Alert.alert('Added', 'Upload attached to matter.', [{ text: 'OK' }]);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to add document';
        Alert.alert('Error', message);
      }
    },
    [matterId, selectedRole, addDocument],
  );

  const searchResults = searchData?.data ?? [];
  const uploads = uploadsData?.uploads ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Add Document' }} />
      <View style={styles.container}>
        {/* Role Selector */}
        <View style={styles.roleSection}>
          <Text style={styles.roleLabel}>Document Role</Text>
          <View style={styles.chipRow}>
            {ROLE_OPTIONS.map((role) => (
              <TouchableOpacity
                key={role}
                style={[
                  styles.roleChip,
                  selectedRole === role && styles.roleChipActive,
                ]}
                onPress={() => setSelectedRole(role)}
              >
                <Text
                  style={[
                    styles.roleChipText,
                    selectedRole === role && styles.roleChipTextActive,
                  ]}
                >
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Source Tab */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'search' && styles.tabActive]}
            onPress={() => setActiveTab('search')}
          >
            <Ionicons
              name="search"
              size={16}
              color={activeTab === 'search' ? '#1a56db' : '#6b7280'}
            />
            <Text
              style={[
                styles.tabText,
                activeTab === 'search' && styles.tabTextActive,
              ]}
            >
              Legal Documents
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'uploads' && styles.tabActive]}
            onPress={() => setActiveTab('uploads')}
          >
            <Ionicons
              name="cloud-upload-outline"
              size={16}
              color={activeTab === 'uploads' ? '#1a56db' : '#6b7280'}
            />
            <Text
              style={[
                styles.tabText,
                activeTab === 'uploads' && styles.tabTextActive,
              ]}
            >
              My Uploads
            </Text>
          </TouchableOpacity>
        </View>

        {/* Search Tab Content */}
        {activeTab === 'search' && (
          <View style={{ flex: 1 }}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={18} color="#9ca3af" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search legal documents..."
                placeholderTextColor="#9ca3af"
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color="#9ca3af" />
                </TouchableOpacity>
              )}
            </View>

            {searchLoading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="small" color="#1a56db" />
              </View>
            ) : searchQuery.trim().length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={36} color="#d1d5db" />
                <Text style={styles.emptyText}>
                  Search for legal documents to attach
                </Text>
              </View>
            ) : searchResults.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-outline" size={36} color="#d1d5db" />
                <Text style={styles.emptyText}>No documents found</Text>
              </View>
            ) : (
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <LegalDocResult
                    item={item}
                    onSelect={() => handleAddLegalDoc(item)}
                    isAdding={addDocument.isPending}
                  />
                )}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
              />
            )}
          </View>
        )}

        {/* Uploads Tab Content */}
        {activeTab === 'uploads' && (
          <View style={{ flex: 1 }}>
            {uploadsLoading ? (
              <View style={styles.loadingState}>
                <ActivityIndicator size="small" color="#1a56db" />
              </View>
            ) : uploads.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="cloud-outline" size={36} color="#d1d5db" />
                <Text style={styles.emptyText}>No uploads yet</Text>
              </View>
            ) : (
              <FlatList
                data={uploads}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <UploadResult
                    item={item}
                    onSelect={() => handleAddUpload(item)}
                    isAdding={addDocument.isPending}
                  />
                )}
                contentContainerStyle={styles.listContent}
                onEndReached={() => {
                  if (hasMoreUploads) fetchMoreUploads();
                }}
                onEndReachedThreshold={0.3}
              />
            )}
          </View>
        )}
      </View>
    </>
  );
}

/**
 * Vertical nudge for the centered loading/empty states. This is NOT
 * safe-area padding — the screen renders under a native Stack header, which
 * already consumes the status-bar inset — so it is a plain constant rather
 * than a topInsetPadding() call.
 */
const CENTERED_STATE_TOP_SPACING = 60;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },

  // Role selector
  roleSection: {
    backgroundColor: '#fff',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  roleLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  roleChipActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
  },
  roleChipTextActive: { color: '#fff' },

  // Tab bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#1a56db',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#1a56db',
    fontWeight: '600',
  },

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: 2,
  },

  // List
  listContent: { padding: 12, gap: 8 },

  // Result card
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 19,
    marginBottom: 4,
  },
  resultMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  resultMetaText: { fontSize: 12, color: '#6b7280' },
  resultBadges: {
    flexDirection: 'row',
    gap: 6,
  },
  typeBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },

  // States
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: CENTERED_STATE_TOP_SPACING,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: CENTERED_STATE_TOP_SPACING,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 8,
  },
});
