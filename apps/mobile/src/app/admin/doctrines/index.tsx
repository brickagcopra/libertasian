import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useAdminDoctrines,
  useApproveDoctrine,
  useRejectDoctrine,
} from '../../../features/admin/hooks/use-admin-doctrines';
import type { DoctrineListItem } from '../../../features/admin/types';

const DOCTRINE_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'ratio_decidendi', label: 'Ratio Decidendi' },
  { value: 'obiter_dictum', label: 'Obiter Dictum' },
  { value: 'stare_decisis', label: 'Stare Decisis' },
  { value: 'statutory_construction', label: 'Statutory Construction' },
  { value: 'constitutional_interpretation', label: 'Constitutional Interp.' },
  { value: 'procedural_rule', label: 'Procedural Rule' },
  { value: 'evidentiary_rule', label: 'Evidentiary Rule' },
  { value: 'other', label: 'Other' },
];

const REVIEW_STATUSES = [
  { value: '', label: 'All Statuses' },
  { value: 'ai_generated', label: 'AI Generated' },
  { value: 'needs_human_review', label: 'Needs Review' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export default function DoctrinesListScreen() {
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [showTypeFilter, setShowTypeFilter] = useState(false);
  const [showStatusFilter, setShowStatusFilter] = useState(false);

  const { data, isLoading, isFetching, error, refetch } = useAdminDoctrines({
    doctrineType: typeFilter || undefined,
    reviewStatus: statusFilter || undefined,
    cursor,
  });

  const approve = useApproveDoctrine();
  const reject = useRejectDoctrine();

  const handleRefresh = useCallback(() => {
    setCursor(undefined);
    refetch();
  }, [refetch]);

  const handleApprove = useCallback(
    (item: DoctrineListItem) => {
      Alert.alert('Approve Doctrine', 'Are you sure you want to approve this doctrine?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => approve.mutate(item.id),
        },
      ]);
    },
    [approve],
  );

  const handleReject = useCallback(
    (item: DoctrineListItem) => {
      Alert.alert('Reject Doctrine', 'Are you sure you want to reject this doctrine?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: () => reject.mutate(item.id),
        },
      ]);
    },
    [reject],
  );

  const selectedTypeLabel =
    DOCTRINE_TYPES.find((t) => t.value === typeFilter)?.label ?? 'All Types';
  const selectedStatusLabel =
    REVIEW_STATUSES.find((s) => s.value === statusFilter)?.label ?? 'All Statuses';

  const renderDoctrineItem = useCallback(
    ({ item }: { item: DoctrineListItem }) => {
      const isPending =
        item.reviewStatus === 'pending' ||
        item.reviewStatus === 'ai_generated' ||
        item.reviewStatus === 'needs_human_review';

      return (
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.7}
          onPress={() => router.push(`/admin/doctrines/${item.id}`)}
        >
          <View style={styles.badgeRow}>
            <DoctrineTypeBadge type={item.doctrineType} />
            <ReviewStatusBadge status={item.reviewStatus} />
            {item.confidence !== null && (
              <ConfidenceBadge score={item.confidence} />
            )}
          </View>

          <Text style={styles.doctrineText} numberOfLines={2}>
            {item.text}
          </Text>

          {item.legalDocument && (
            <Text style={styles.sourceText} numberOfLines={1}>
              {item.legalDocument.title}
              {item.legalDocument.grNo ? ` (${item.legalDocument.grNo})` : ''}
            </Text>
          )}

          {isPending && (
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={styles.approveButton}
                activeOpacity={0.7}
                onPress={() => handleApprove(item)}
                disabled={approve.isPending}
              >
                <Ionicons name="checkmark" size={14} color="#fff" />
                <Text style={styles.approveButtonText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.rejectButton}
                activeOpacity={0.7}
                onPress={() => handleReject(item)}
                disabled={reject.isPending}
              >
                <Ionicons name="close" size={14} color="#fff" />
                <Text style={styles.rejectButtonText}>Reject</Text>
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      );
    },
    [approve, reject, handleApprove, handleReject],
  );

  const renderFooter = useCallback(() => {
    if (data?.meta.hasNext && data.meta.nextCursor) {
      return (
        <TouchableOpacity
          style={styles.loadMoreButton}
          activeOpacity={0.7}
          onPress={() => setCursor(data.meta.nextCursor)}
        >
          <Text style={styles.loadMoreText}>Load More</Text>
        </TouchableOpacity>
      );
    }
    return null;
  }, [data]);

  const renderEmpty = useCallback(() => {
    if (isLoading) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      );
    }
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="library-outline" size={48} color="#d1d5db" />
        <Text style={styles.emptyTitle}>No doctrines found</Text>
        <Text style={styles.emptySubtitle}>
          Try adjusting your filters or check back later.
        </Text>
      </View>
    );
  }, [isLoading]);

  return (
    <>
      <Stack.Screen options={{ title: 'Doctrines' }} />
      <View style={styles.container}>
        {/* Filter Row */}
        <View style={styles.filterContainer}>
          <TouchableOpacity
            style={styles.filterButton}
            activeOpacity={0.7}
            onPress={() => {
              setShowTypeFilter(!showTypeFilter);
              setShowStatusFilter(false);
            }}
          >
            <Ionicons name="filter-outline" size={14} color="#374151" />
            <Text style={styles.filterButtonText} numberOfLines={1}>
              {selectedTypeLabel}
            </Text>
            <Ionicons
              name={showTypeFilter ? 'chevron-up' : 'chevron-down'}
              size={14}
              color="#9ca3af"
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.filterButton}
            activeOpacity={0.7}
            onPress={() => {
              setShowStatusFilter(!showStatusFilter);
              setShowTypeFilter(false);
            }}
          >
            <Ionicons name="flag-outline" size={14} color="#374151" />
            <Text style={styles.filterButtonText} numberOfLines={1}>
              {selectedStatusLabel}
            </Text>
            <Ionicons
              name={showStatusFilter ? 'chevron-up' : 'chevron-down'}
              size={14}
              color="#9ca3af"
            />
          </TouchableOpacity>
        </View>

        {/* Type Filter Dropdown */}
        {showTypeFilter && (
          <View style={styles.dropdown}>
            {DOCTRINE_TYPES.map((t) => (
              <TouchableOpacity
                key={t.value}
                style={[
                  styles.dropdownItem,
                  typeFilter === t.value && styles.dropdownItemActive,
                ]}
                activeOpacity={0.7}
                onPress={() => {
                  setTypeFilter(t.value);
                  setCursor(undefined);
                  setShowTypeFilter(false);
                }}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    typeFilter === t.value && styles.dropdownItemTextActive,
                  ]}
                >
                  {t.label}
                </Text>
                {typeFilter === t.value && (
                  <Ionicons name="checkmark" size={16} color="#1a56db" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Status Filter Dropdown */}
        {showStatusFilter && (
          <View style={styles.dropdown}>
            {REVIEW_STATUSES.map((s) => (
              <TouchableOpacity
                key={s.value}
                style={[
                  styles.dropdownItem,
                  statusFilter === s.value && styles.dropdownItemActive,
                ]}
                activeOpacity={0.7}
                onPress={() => {
                  setStatusFilter(s.value);
                  setCursor(undefined);
                  setShowStatusFilter(false);
                }}
              >
                <Text
                  style={[
                    styles.dropdownItemText,
                    statusFilter === s.value && styles.dropdownItemTextActive,
                  ]}
                >
                  {s.label}
                </Text>
                {statusFilter === s.value && (
                  <Ionicons name="checkmark" size={16} color="#1a56db" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Error Banner */}
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>
              {error instanceof Error ? error.message : 'Failed to load doctrines'}
            </Text>
          </View>
        )}

        {/* List */}
        <FlatList
          data={data?.items ?? []}
          keyExtractor={(item) => item.id}
          renderItem={renderDoctrineItem}
          ListEmptyComponent={renderEmpty}
          ListFooterComponent={renderFooter}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={handleRefresh}
              colors={['#1a56db']}
            />
          }
        />
      </View>
    </>
  );
}

// ---- Badge Components ----

function DoctrineTypeBadge({ type }: { type: string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    ratio_decidendi: { bg: '#dbeafe', text: '#1d4ed8' },
    obiter_dictum: { bg: '#ede9fe', text: '#7c3aed' },
    stare_decisis: { bg: '#e0e7ff', text: '#4338ca' },
    statutory_construction: { bg: '#ccfbf1', text: '#0f766e' },
    constitutional_interpretation: { bg: '#fef3c7', text: '#b45309' },
    procedural_rule: { bg: '#cffafe', text: '#0e7490' },
    evidentiary_rule: { bg: '#ffedd5', text: '#c2410c' },
    other: { bg: '#f3f4f6', text: '#4b5563' },
  };
  const colors = colorMap[type] ?? colorMap['other'];
  const label = type.replace(/_/g, ' ');

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

function ReviewStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    pending: { bg: '#fef3c7', text: '#b45309' },
    ai_generated: { bg: '#e0e7ff', text: '#4338ca' },
    needs_human_review: { bg: '#fef3c7', text: '#b45309' },
    approved: { bg: '#d1fae5', text: '#047857' },
    rejected: { bg: '#fee2e2', text: '#b91c1c' },
  };
  const colors = colorMap[status] ?? { bg: '#f3f4f6', text: '#4b5563' };
  const label = status.replace(/_/g, ' ');

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const colors =
    score >= 0.8
      ? { bg: '#d1fae5', text: '#047857' }
      : score >= 0.5
        ? { bg: '#fef3c7', text: '#b45309' }
        : { bg: '#fee2e2', text: '#b91c1c' };

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>
        {(score * 100).toFixed(0)}%
      </Text>
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  listContent: { padding: 16, paddingBottom: 40 },
  filterContainer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    backgroundColor: '#f3f4f6',
  },
  filterButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  filterButtonText: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
  },
  dropdown: {
    marginHorizontal: 16,
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  dropdownItemActive: {
    backgroundColor: '#eff6ff',
  },
  dropdownItemText: {
    fontSize: 14,
    color: '#374151',
  },
  dropdownItemTextActive: {
    color: '#1a56db',
    fontWeight: '600',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    color: '#b91c1c',
  },
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
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  doctrineText: {
    fontSize: 14,
    color: '#111827',
    lineHeight: 20,
  },
  sourceText: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 6,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  approveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#059669',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  approveButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  rejectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#dc2626',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  rejectButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  loadMoreButton: {
    alignItems: 'center',
    paddingVertical: 14,
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a56db',
  },
  centerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 4,
    textAlign: 'center',
  },
});
