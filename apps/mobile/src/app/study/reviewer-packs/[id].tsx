import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useReviewerPack,
  useDeleteReviewerPackItem,
} from '../../../features/study/hooks/use-reviewer-packs';
import { useExportReviewerPack } from '../../../features/study/hooks/use-study-export';
import type { ExportFormat, ReviewerPackItem } from '../../../features/study/types';

const ITEM_TYPE_COLORS: Record<string, { bg: string; text: string; icon: keyof typeof Ionicons.glyphMap }> = {
  legal_document: { bg: '#eff6ff', text: '#1d4ed8', icon: 'document-text-outline' },
  digest: { bg: '#fef3c7', text: '#92400e', icon: 'newspaper-outline' },
  section: { bg: '#f3e8ff', text: '#7c3aed', icon: 'list-outline' },
};

function PackItemCard({
  item,
  packId,
  onDelete,
}: {
  item: ReviewerPackItem;
  packId: string;
  onDelete: (id: string) => void;
}) {
  const typeStyle = ITEM_TYPE_COLORS[item.itemType] ?? ITEM_TYPE_COLORS['legal_document'];

  const handlePress = () => {
    if (item.itemType === 'legal_document' && item.legalDocument) {
      router.push(`/reader/${item.legalDocument.id}`);
    } else if (item.itemType === 'digest' && item.digest) {
      router.push(`/digest/${item.digest.id}`);
    } else if (item.itemType === 'section' && item.legalDocument) {
      router.push(`/reader/${item.legalDocument.id}`);
    }
  };

  const title =
    item.legalDocument?.title ??
    item.digest?.title ??
    item.section?.sectionLabel ??
    'Untitled item';

  return (
    <TouchableOpacity
      style={styles.itemCard}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <View style={styles.itemRow}>
        <View style={[styles.itemIcon, { backgroundColor: typeStyle.bg }]}>
          <Ionicons name={typeStyle.icon} size={18} color={typeStyle.text} />
        </View>
        <View style={styles.itemContent}>
          <View style={styles.itemHeader}>
            <View style={[styles.itemTypeBadge, { backgroundColor: typeStyle.bg }]}>
              <Text style={[styles.itemTypeText, { color: typeStyle.text }]}>
                {item.itemType.replace(/_/g, ' ')}
              </Text>
            </View>
          </View>
          <Text style={styles.itemTitle} numberOfLines={2}>
            {title}
          </Text>
          {item.legalDocument?.grNo ? (
            <Text style={styles.itemMeta}>{item.legalDocument.grNo}</Text>
          ) : null}
          {item.digest?.digestType ? (
            <Text style={styles.itemMeta}>
              {item.digest.digestType.replace(/_/g, ' ')}
            </Text>
          ) : null}
          {item.note ? (
            <View style={styles.noteBox}>
              <Ionicons name="chatbubble-outline" size={12} color="#6b7280" />
              <Text style={styles.noteText} numberOfLines={2}>
                {item.note}
              </Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => onDelete(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close-circle-outline" size={20} color="#9ca3af" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

export default function ReviewerPackDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const packId = id ?? '';

  const { data: pack, isLoading, refetch, isFetching } = useReviewerPack(packId);
  const deleteItem = useDeleteReviewerPackItem(packId);
  const exportPack = useExportReviewerPack();

  const handleExport = useCallback(() => {
    if (!pack) return;
    Alert.alert('Export Reviewer Pack', 'Choose format:', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'PDF',
        onPress: () => exportPack.mutate({ id: packId, format: 'pdf' as ExportFormat, title: pack.title }),
      },
      {
        text: 'DOCX',
        onPress: () => exportPack.mutate({ id: packId, format: 'docx' as ExportFormat, title: pack.title }),
      },
    ]);
  }, [pack, packId, exportPack]);

  const handleDeleteItem = useCallback(
    (itemId: string) => {
      Alert.alert('Remove Item', 'Remove this item from the pack?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => deleteItem.mutate(itemId),
        },
      ]);
    },
    [deleteItem],
  );

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (!pack) {
    return (
      <>
        <Stack.Screen options={{ title: 'Error' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
          <Text style={styles.errorTitle}>Pack not found</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const items = pack.items ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          title: pack.title,
          headerBackTitle: 'Packs',
          headerRight: () => (
            <TouchableOpacity
              onPress={handleExport}
              disabled={exportPack.isPending || items.length === 0}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {exportPack.isPending ? (
                <ActivityIndicator size="small" color="#1a56db" />
              ) : (
                <Ionicons name="download-outline" size={22} color="#1a56db" />
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <View style={styles.container}>
        {/* Pack Header */}
        <View style={styles.packHeader}>
          <View style={styles.packBadges}>
            {pack.barSubject ? (
              <View style={styles.subjectBadge}>
                <Text style={styles.subjectBadgeText}>
                  {pack.barSubject.replace(/_/g, ' ')}
                </Text>
              </View>
            ) : null}
            <Text style={styles.itemCount}>
              {pack.itemCount} item{pack.itemCount !== 1 ? 's' : ''}
            </Text>
          </View>
          {pack.description ? (
            <Text style={styles.packDescription}>{pack.description}</Text>
          ) : null}
          {pack.creator ? (
            <Text style={styles.packCreator}>
              Created by {pack.creator.fullName}
            </Text>
          ) : null}
        </View>

        {items.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="folder-open-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No items</Text>
            <Text style={styles.emptyText}>
              Add items to this pack from the web app
            </Text>
          </View>
        ) : (
          <FlatList
            data={items}
            renderItem={({ item }) => (
              <PackItemCard
                item={item}
                packId={packId}
                onDelete={handleDeleteItem}
              />
            )}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshing={isFetching && !isLoading}
            onRefresh={() => refetch()}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  backButton: {
    marginTop: 16,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  backButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  packHeader: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  packBadges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  subjectBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  subjectBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },
  itemCount: { fontSize: 12, color: '#6b7280' },
  packDescription: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
    marginBottom: 4,
  },
  packCreator: { fontSize: 12, color: '#9ca3af' },
  listContent: { padding: 12, gap: 8 },
  itemCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemContent: { flex: 1 },
  itemHeader: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  itemTypeBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  itemTypeText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 20,
  },
  itemMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
    textTransform: 'capitalize',
  },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    backgroundColor: '#f9fafb',
    borderRadius: 6,
    padding: 8,
    marginTop: 6,
  },
  noteText: {
    fontSize: 12,
    color: '#6b7280',
    flex: 1,
    lineHeight: 17,
  },
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
