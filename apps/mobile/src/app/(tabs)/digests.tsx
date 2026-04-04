import { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDigests } from '../../features/digests/hooks/use-digests';
import type { Digest } from '../../features/digests/types';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#f3f4f6', text: '#6b7280' },
  ai_generated: { bg: '#eff6ff', text: '#1d4ed8' },
  needs_human_review: { bg: '#fef3c7', text: '#92400e' },
  approved: { bg: '#ecfdf5', text: '#059669' },
  rejected: { bg: '#fef2f2', text: '#dc2626' },
};

function getConfidenceColor(score: number | null): string {
  if (score === null) return '#9ca3af';
  if (score >= 0.7) return '#059669';
  if (score >= 0.4) return '#d97706';
  return '#dc2626';
}

function DigestCard({ item }: { item: Digest }) {
  const statusStyle = STATUS_COLORS[item.reviewStatus] ?? STATUS_COLORS['draft'];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/digest/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.badges}>
          <View style={styles.typeBadge}>
            <Text style={styles.typeBadgeText}>
              {item.digestType.replace(/_/g, ' ')}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
            <Text style={[styles.statusBadgeText, { color: statusStyle.text }]}>
              {item.reviewStatus.replace(/_/g, ' ')}
            </Text>
          </View>
        </View>
        {item.confidenceScore !== null ? (
          <Text
            style={[
              styles.confidenceText,
              { color: getConfidenceColor(item.confidenceScore) },
            ]}
          >
            {Math.round(item.confidenceScore * 100)}%
          </Text>
        ) : null}
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>

      {item.facts ? (
        <Text style={styles.factsPreview} numberOfLines={3}>
          {item.facts}
        </Text>
      ) : null}

      <View style={styles.cardFooter}>
        <Text style={styles.sourceText}>
          {item.sourceOrigin.replace(/_/g, ' ')}
        </Text>
        <Text style={styles.dateText}>
          {new Date(item.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function DigestsTab() {
  const { data, isLoading, isFetching, refetch } = useDigests({ limit: 30 });

  const renderItem = useCallback(
    ({ item }: { item: Digest }) => <DigestCard item={item} />,
    [],
  );

  const keyExtractor = useCallback((item: Digest) => item.id, []);

  if (isLoading) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator size="large" color="#1a56db" />
      </View>
    );
  }

  const digests = data?.data ?? [];

  return (
    <View style={styles.container}>
      {digests.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="document-text-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyTitle}>No digests yet</Text>
          <Text style={styles.emptyText}>
            Generate case digests from legal documents using AI
          </Text>
        </View>
      ) : (
        <FlatList
          data={digests}
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    marginBottom: 8,
  },
  badges: { flexDirection: 'row', gap: 6, flex: 1 },
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
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  confidenceText: {
    fontSize: 13,
    fontWeight: '700',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 6,
  },
  factsPreview: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sourceText: {
    fontSize: 11,
    color: '#9ca3af',
    textTransform: 'capitalize',
  },
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
