import { useCallback, useState } from 'react';
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
  useContradictions,
  useDeleteContradiction,
} from '../../../features/contradictions/hooks/use-contradictions';
import {
  CONTRADICTION_STATUS_LABELS,
  SCOPE_LABELS,
} from '../../../features/contradictions/types';
import type { ContradictionReportListItem } from '../../../features/contradictions/types';

const STATUS_OPTIONS: { label: string; value: string }[] = [
  { label: 'All', value: '' },
  { label: 'Completed', value: 'completed' },
  { label: 'Generating', value: 'generating' },
  { label: 'Pending', value: 'pending' },
  { label: 'Failed', value: 'failed' },
];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  generating: { bg: '#dbeafe', text: '#1e40af' },
  completed: { bg: '#d1fae5', text: '#065f46' },
  failed: { bg: '#fecaca', text: '#991b1b' },
};

function ContradictionCard({
  item,
  onDelete,
}: {
  item: ContradictionReportListItem;
  onDelete: (id: string) => void;
}) {
  const statusColor = STATUS_COLORS[item.status] ?? {
    bg: '#f3f4f6',
    text: '#6b7280',
  };
  const scopeLabel = SCOPE_LABELS[item.scope] ?? item.scope;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/workspace/contradictions/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.badgeText, { color: statusColor.text }]}>
              {CONTRADICTION_STATUS_LABELS[item.status] ?? item.status}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#f3f4f6' }]}>
            <Text style={[styles.badgeText, { color: '#374151' }]}>
              {scopeLabel}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#e0e7ff' }]}>
            <Text style={[styles.badgeText, { color: '#3730a3' }]}>
              {item.documentIds.length} docs
            </Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => onDelete(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="trash-outline" size={16} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.topic
          ? `${scopeLabel}: ${item.topic}`
          : `${scopeLabel} — ${item.documentIds.length} documents`}
      </Text>

      <View style={styles.cardFooter}>
        <Text style={styles.footerText}>
          {new Date(item.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
      </View>

      {item.status === 'generating' && (
        <View style={styles.generatingRow}>
          <ActivityIndicator size="small" color="#1a56db" />
          <Text style={styles.generatingText}>
            Analyzing contradictions...
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function ContradictionsListScreen() {
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, isFetching, refetch } = useContradictions({
    limit: 30,
    status: statusFilter || undefined,
  });
  const deleteContradiction = useDeleteContradiction();

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert(
        'Delete Report',
        'Are you sure you want to delete this contradiction report?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => deleteContradiction.mutate(id),
          },
        ],
      );
    },
    [deleteContradiction],
  );

  const renderItem = useCallback(
    ({ item }: { item: ContradictionReportListItem }) => (
      <ContradictionCard item={item} onDelete={handleDelete} />
    ),
    [handleDelete],
  );

  const keyExtractor = useCallback(
    (item: ContradictionReportListItem) => item.id,
    [],
  );

  const reports = data?.data ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Contradictions',
          headerRight: () => (
            <TouchableOpacity
              onPress={() =>
                router.push('/workspace/contradictions/create')
              }
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="add-circle-outline" size={26} color="#1a56db" />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={styles.container}>
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
        ) : reports.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="swap-horizontal-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No contradiction reports</Text>
            <Text style={styles.emptyText}>
              Detect contradictions and inconsistencies across legal authorities
            </Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() =>
                router.push('/workspace/contradictions/create')
              }
            >
              <Text style={styles.emptyButtonText}>New Analysis</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={reports}
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

  filterRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 6,
    flexWrap: 'wrap',
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
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    lineHeight: 20,
    marginBottom: 8,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    paddingTop: 8,
    marginTop: 4,
  },
  footerText: { fontSize: 11, color: '#9ca3af' },
  generatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  generatingText: {
    fontSize: 12,
    color: '#1a56db',
    fontWeight: '500',
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
  emptyButton: {
    marginTop: 16,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  emptyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
