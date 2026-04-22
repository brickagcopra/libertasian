import { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useDerivatives } from '../../../../../features/derivatives/hooks/use-derivatives';
import {
  subjectFromSlug,
  typeFromSlug,
} from '../../../../../features/derivatives/taxonomy';
import type { DerivativeListItem } from '../../../../../features/derivatives/types';

export default function LibrarySubjectScreen() {
  const { type, subject } = useLocalSearchParams<{ type: string; subject: string }>();
  const typeMeta = type ? typeFromSlug(type) : undefined;
  const subjectMeta = subject ? subjectFromSlug(subject) : undefined;

  const {
    data,
    isLoading,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDerivatives({
    subjectCode: subjectMeta?.code,
    derivativeType: typeMeta?.enum,
    taxonomyVersion: 'study_8',
  });

  const items = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  const renderItem = useCallback(
    ({ item }: { item: DerivativeListItem }) => {
      if (!typeMeta || !subjectMeta) return null;
      return (
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() =>
            router.push(
              `/library/${typeMeta.slug}/${subjectMeta.slug}/${item.id}`,
            )
          }
          accessibilityRole="button"
          accessibilityLabel={item.title}
        >
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {item.sourceDocument ? (
            <Text style={styles.source} numberOfLines={1}>
              {item.sourceDocument.citationText ??
                item.sourceDocument.shortTitle ??
                item.sourceDocument.title}
            </Text>
          ) : null}
          <View style={styles.cardFooter}>
            <Text style={styles.footerText}>AI-generated</Text>
            {item.isGated ? (
              <View style={styles.gatedBadge}>
                <Ionicons name="lock-closed-outline" size={11} color="#92400e" />
                <Text style={styles.gatedBadgeText}>
                  {item.upgradeTier ?? 'upgrade'}
                </Text>
              </View>
            ) : item.confidenceScore !== null && item.confidenceScore >= 0.7 ? (
              <Text style={styles.confidenceText}>
                {Math.round(item.confidenceScore * 100)}%
              </Text>
            ) : null}
          </View>
        </Pressable>
      );
    },
    [typeMeta, subjectMeta],
  );

  const keyExtractor = useCallback((item: DerivativeListItem) => item.id, []);

  if (!typeMeta || !subjectMeta) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color="#9ca3af" />
        <Text style={styles.missingText}>Unknown library path.</Text>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          style={styles.breadcrumb}
          onPress={() => router.push(`/library/${typeMeta.slug}`)}
          accessibilityRole="button"
          accessibilityLabel={`Back to ${typeMeta.label}`}
        >
          <Ionicons name="chevron-back" size={14} color="#6b7280" />
          <Text style={styles.breadcrumbText}>{typeMeta.label}</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          {subjectMeta.name}
        </Text>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="library-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyTitle}>No content yet</Text>
          <Text style={styles.emptyText}>
            No approved {typeMeta.label.toLowerCase()} for {subjectMeta.name} yet.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
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
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator size="small" color="#1a56db" style={{ marginVertical: 12 }} />
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  missingText: { marginTop: 8, fontSize: 14, color: '#6b7280' },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1a56db',
    borderRadius: 8,
  },
  backButtonText: { color: '#fff', fontWeight: '600' },
  header: { padding: 16, gap: 4, backgroundColor: '#fff' },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
  },
  breadcrumbText: { fontSize: 12, color: '#6b7280' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827' },
  listContent: { padding: 12, gap: 10 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  cardPressed: { backgroundColor: '#f9fafb' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#111827', lineHeight: 21 },
  source: { fontSize: 12, color: '#6b7280' },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  footerText: { fontSize: 11, color: '#9ca3af' },
  gatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fef3c7',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  gatedBadgeText: { fontSize: 11, fontWeight: '600', color: '#92400e', textTransform: 'capitalize' },
  confidenceText: { fontSize: 12, fontWeight: '600', color: '#059669' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151', marginTop: 12 },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
});
