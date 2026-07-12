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
  useAnnotations,
  useDeleteAnnotation,
} from '../../features/annotations/hooks/use-annotations';
import { annotationColorStyle } from '../../features/annotations/colors';
import type { Annotation } from '../../features/annotations/types';

function AnnotationCard({
  item,
  onDelete,
}: {
  item: Annotation;
  onDelete: (id: string) => void;
}) {
  const doc = item.legalDocument;
  const { solid } = annotationColorStyle(item.color);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/reader/${item.legalDocumentId}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.colorRow}>
          <View style={[styles.colorDot, { backgroundColor: solid }]} />
          {item.section?.sectionLabel ? (
            <Text style={styles.sectionLabel} numberOfLines={1}>
              {item.section.sectionLabel}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => onDelete(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={18} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {doc?.shortTitle ?? doc?.title ?? 'Unknown document'}
      </Text>

      <Text style={styles.anchorText} numberOfLines={3}>
        “{item.textAnchor.anchorText}”
      </Text>

      {item.annotationText ? (
        <View style={styles.noteContainer}>
          <Ionicons name="chatbubble-outline" size={12} color="#6b7280" />
          <Text style={styles.noteText} numberOfLines={2}>
            {item.annotationText}
          </Text>
        </View>
      ) : null}

      <Text style={styles.dateText}>
        Highlighted{' '}
        {new Date(item.createdAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </Text>
    </TouchableOpacity>
  );
}

export default function AnnotationsScreen() {
  const { data, isLoading, isFetching, refetch } = useAnnotations();
  const deleteAnnotation = useDeleteAnnotation();

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert(
        'Delete Annotation',
        'Are you sure you want to remove this highlight?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => deleteAnnotation.mutate(id),
          },
        ],
      );
    },
    [deleteAnnotation],
  );

  const renderItem = useCallback(
    ({ item }: { item: Annotation }) => (
      <AnnotationCard item={item} onDelete={handleDelete} />
    ),
    [handleDelete],
  );

  const keyExtractor = useCallback((item: Annotation) => item.id, []);

  const annotations = data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Annotations' }} />
      <View style={styles.container}>
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : annotations.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="color-wand-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No annotations yet</Text>
            <Text style={styles.emptyText}>
              Long-press a paragraph while reading to highlight it and add a note
            </Text>
          </View>
        ) : (
          <FlatList
            data={annotations}
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
  colorRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginRight: 8,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 6,
  },
  anchorText: {
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 19,
    fontStyle: 'italic',
    marginBottom: 6,
  },
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
