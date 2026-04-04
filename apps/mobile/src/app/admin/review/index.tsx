import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useReviewQueue,
  useReviewStats,
} from '../../../features/admin/hooks/use-admin-review';
import type { ReviewQueueItem } from '../../../features/admin/types';

const STATUS_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending_review' },
  { label: 'Needs Review', value: 'needs_human_review' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

const ORIGIN_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'AI Generated', value: 'ai_generated' },
  { label: 'User Scan', value: 'user_scan' },
  { label: 'Editorial', value: 'editorial' },
];

function getConfidenceColor(score: number | null): string {
  if (score === null) return '#6b7280';
  if (score >= 0.7) return '#059669';
  if (score >= 0.4) return '#d97706';
  return '#dc2626';
}

function getBadgeStyle(type: 'status' | 'origin' | 'digest', value: string) {
  switch (type) {
    case 'status':
      switch (value) {
        case 'approved':
          return { bg: '#d1fae5', text: '#065f46' };
        case 'rejected':
          return { bg: '#fee2e2', text: '#991b1b' };
        case 'pending_review':
          return { bg: '#fef3c7', text: '#92400e' };
        case 'needs_human_review':
          return { bg: '#fde68a', text: '#78350f' };
        default:
          return { bg: '#f3f4f6', text: '#374151' };
      }
    case 'origin':
      switch (value) {
        case 'ai_generated':
          return { bg: '#ede9fe', text: '#5b21b6' };
        case 'user_scan':
          return { bg: '#e0f2fe', text: '#075985' };
        case 'editorial':
          return { bg: '#fce7f3', text: '#9d174d' };
        default:
          return { bg: '#f3f4f6', text: '#374151' };
      }
    case 'digest':
      return { bg: '#dbeafe', text: '#1e40af' };
    default:
      return { bg: '#f3f4f6', text: '#374151' };
  }
}

function formatLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---- Stat Card ----

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={statStyles.card}>
      <Text style={[statStyles.value, { color }]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  value: {
    fontSize: 20,
    fontWeight: '700',
  },
  label: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
    textAlign: 'center',
  },
});

// ---- Badge ----

function Badge({ label, type, value }: { label: string; type: 'status' | 'origin' | 'digest'; value: string }) {
  const colors = getBadgeStyle(type, value);
  return (
    <View style={[badgeStyles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[badgeStyles.text, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    marginRight: 6,
    marginBottom: 4,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});

// ---- Filter Pill Row ----

function FilterPillRow({
  options,
  selected,
  onSelect,
}: {
  options: Array<{ label: string; value: string }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={filterStyles.row}>
      {options.map((opt) => {
        const isActive = selected === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[filterStyles.pill, isActive && filterStyles.pillActive]}
            onPress={() => onSelect(opt.value)}
            activeOpacity={0.7}
          >
            <Text
              style={[filterStyles.pillText, isActive && filterStyles.pillTextActive]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const filterStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  pillActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
  },
  pillTextActive: {
    color: '#fff',
  },
});

// ---- Review Queue Item Card ----

function ReviewQueueCard({ item }: { item: ReviewQueueItem }) {
  const confidenceColor = getConfidenceColor(item.confidenceScore);

  return (
    <TouchableOpacity
      style={cardStyles.card}
      activeOpacity={0.7}
      onPress={() => router.push(`/admin/review/${item.id}`)}
    >
      <Text style={cardStyles.title} numberOfLines={2}>
        {item.title}
      </Text>

      <View style={cardStyles.badgeRow}>
        <Badge label={formatLabel(item.digestType)} type="digest" value={item.digestType} />
        <Badge label={formatLabel(item.reviewStatus)} type="status" value={item.reviewStatus} />
        <Badge label={formatLabel(item.sourceOrigin)} type="origin" value={item.sourceOrigin} />
      </View>

      <View style={cardStyles.metaRow}>
        <View style={cardStyles.metaItem}>
          <Ionicons name="analytics-outline" size={14} color={confidenceColor} />
          <Text style={[cardStyles.metaText, { color: confidenceColor }]}>
            {item.confidenceScore !== null
              ? `${(item.confidenceScore * 100).toFixed(0)}%`
              : 'N/A'}
          </Text>
        </View>

        <View style={cardStyles.metaItem}>
          <Ionicons name="calendar-outline" size={14} color="#6b7280" />
          <Text style={cardStyles.metaText}>{formatDate(item.createdAt)}</Text>
        </View>
      </View>

      {item.legalDocument ? (
        <View style={cardStyles.docRef}>
          <Ionicons name="document-text-outline" size={13} color="#6b7280" />
          <Text style={cardStyles.docRefText} numberOfLines={1}>
            {item.legalDocument.grNo
              ? `${item.legalDocument.grNo} - `
              : ''}
            {item.legalDocument.title}
          </Text>
        </View>
      ) : null}

      {item.assignedReviewer ? (
        <View style={cardStyles.reviewerRow}>
          <Ionicons name="person-outline" size={13} color="#1a56db" />
          <Text style={cardStyles.reviewerText}>
            {item.assignedReviewer.fullName ?? 'Assigned'}
          </Text>
        </View>
      ) : null}

      <View style={cardStyles.arrow}>
        <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
      </View>
    </TouchableOpacity>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
    paddingRight: 20,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 6,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#6b7280',
  },
  docRef: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  docRefText: {
    fontSize: 12,
    color: '#6b7280',
    flex: 1,
  },
  reviewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  reviewerText: {
    fontSize: 12,
    color: '#1a56db',
    fontWeight: '500',
  },
  arrow: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
});

// ---- Main Screen ----

export default function ReviewQueueScreen() {
  const [statusFilter, setStatusFilter] = useState('');
  const [originFilter, setOriginFilter] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const filters = useMemo(
    () => ({
      reviewStatus: statusFilter || undefined,
      sourceOrigin: originFilter || undefined,
      cursor,
      limit: 20,
    }),
    [statusFilter, originFilter, cursor],
  );

  const {
    data: queueData,
    isLoading: queueLoading,
    isFetching: queueFetching,
    refetch: refetchQueue,
  } = useReviewQueue(filters);

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useReviewStats();

  const items = queueData?.items ?? [];
  const hasMore = queueData?.meta?.hasMore ?? false;

  const handleRefresh = useCallback(() => {
    setCursor(undefined);
    refetchQueue();
    refetchStats();
  }, [refetchQueue, refetchStats]);

  const handleLoadMore = useCallback(() => {
    if (hasMore && !queueFetching && queueData?.meta?.cursor) {
      setCursor(queueData.meta.cursor);
    }
  }, [hasMore, queueFetching, queueData?.meta?.cursor]);

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    setCursor(undefined);
  }, []);

  const handleOriginChange = useCallback((value: string) => {
    setOriginFilter(value);
    setCursor(undefined);
  }, []);

  const pendingCount = useMemo(() => {
    if (!stats) return 0;
    const pending = stats.byStatus.find(
      (s) => s.status === 'pending_review' || s.status === 'needs_human_review',
    );
    return pending?.count ?? 0;
  }, [stats]);

  const renderItem = useCallback(
    ({ item }: { item: ReviewQueueItem }) => <ReviewQueueCard item={item} />,
    [],
  );

  const keyExtractor = useCallback((item: ReviewQueueItem) => item.id, []);

  const renderHeader = () => (
    <View>
      {/* Stats Row */}
      <View style={styles.statsRow}>
        {statsLoading ? (
          <ActivityIndicator color="#1a56db" style={styles.statsLoader} />
        ) : stats ? (
          <>
            <StatCard
              label="Total"
              value={String(stats.total)}
              color="#111827"
            />
            <StatCard
              label="Pending"
              value={String(pendingCount)}
              color="#d97706"
            />
            <StatCard
              label="Unassigned"
              value={String(stats.unassigned)}
              color="#dc2626"
            />
            <StatCard
              label="Avg Conf."
              value={
                stats.avgConfidence !== null
                  ? `${(stats.avgConfidence * 100).toFixed(0)}%`
                  : 'N/A'
              }
              color="#1a56db"
            />
          </>
        ) : null}
      </View>

      {/* Status Filter */}
      <Text style={styles.filterLabel}>STATUS</Text>
      <FilterPillRow
        options={STATUS_OPTIONS}
        selected={statusFilter}
        onSelect={handleStatusChange}
      />

      {/* Source Origin Filter */}
      <Text style={styles.filterLabel}>SOURCE</Text>
      <FilterPillRow
        options={ORIGIN_OPTIONS}
        selected={originFilter}
        onSelect={handleOriginChange}
      />
    </View>
  );

  const renderEmpty = () => {
    if (queueLoading) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator color="#1a56db" size="large" />
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="checkmark-done-circle-outline" size={48} color="#d1d5db" />
        <Text style={styles.emptyText}>No items in review queue</Text>
        <Text style={styles.emptySubtext}>
          {statusFilter || originFilter
            ? 'Try changing your filters'
            : 'All digests have been reviewed'}
        </Text>
      </View>
    );
  };

  const renderFooter = () => {
    if (!hasMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator color="#1a56db" />
        <Text style={styles.footerText}>Loading more...</Text>
      </View>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Review Queue' }} />
      <View style={styles.container}>
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl
              refreshing={queueFetching && !queueLoading}
              onRefresh={handleRefresh}
              colors={['#1a56db']}
            />
          }
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  statsLoader: {
    flex: 1,
    paddingVertical: 20,
  },
  filterLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
    letterSpacing: 1,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 12,
  },
  emptySubtext: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
  },
  footerLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  footerText: {
    fontSize: 13,
    color: '#6b7280',
  },
});
