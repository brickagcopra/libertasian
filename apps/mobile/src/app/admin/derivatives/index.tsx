import { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Pressable,
  Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useDerivativeStats,
  useRecentGenerationJobs,
  useTriggerDigestGeneration,
} from '../../../features/admin/hooks/use-admin-derivatives';
import type { GenerationJob } from '../../../features/admin/hooks/use-admin-derivatives';

const JOB_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  running: { bg: '#eff6ff', text: '#1d4ed8' },
  completed: { bg: '#ecfdf5', text: '#059669' },
  failed: { bg: '#fef2f2', text: '#dc2626' },
};

const DIGEST_TYPE_OPTIONS = [
  'case_digest',
  'statute_summary',
  'reviewer_note',
  'study_digest',
];

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, color ? { color } : undefined]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function JobCard({ item }: { item: GenerationJob }) {
  const statusStyle =
    JOB_STATUS_COLORS[item.status] ?? JOB_STATUS_COLORS['pending'];

  return (
    <View style={styles.jobCard}>
      <View style={styles.jobHeader}>
        <View style={[styles.jobStatusBadge, { backgroundColor: statusStyle.bg }]}>
          <Text style={[styles.jobStatusText, { color: statusStyle.text }]}>
            {item.status}
          </Text>
        </View>
        <Text style={styles.jobType}>
          {item.digestType.replace(/_/g, ' ')}
        </Text>
      </View>
      <Text style={styles.jobTitle} numberOfLines={2}>
        {item.documentTitle}
      </Text>
      <View style={styles.jobFooter}>
        <Text style={styles.jobDate}>
          {new Date(item.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
        {item.error ? (
          <Text style={styles.jobError} numberOfLines={1}>
            {item.error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function DerivativesScreen() {
  const [generateModalVisible, setGenerateModalVisible] = useState(false);
  const [docId, setDocId] = useState('');
  const [selectedType, setSelectedType] = useState(DIGEST_TYPE_OPTIONS[0]);

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useDerivativeStats();
  const {
    data: jobs,
    isLoading: jobsLoading,
    isFetching,
    refetch: refetchJobs,
  } = useRecentGenerationJobs({ limit: 20 });
  const triggerGeneration = useTriggerDigestGeneration();

  const handleRefresh = useCallback(() => {
    refetchStats();
    refetchJobs();
  }, [refetchStats, refetchJobs]);

  const handleGenerate = useCallback(() => {
    if (!docId.trim()) {
      Alert.alert('Error', 'Please enter a legal document ID.');
      return;
    }
    triggerGeneration.mutate(
      { legalDocumentId: docId.trim(), digestType: selectedType },
      {
        onSuccess: () => {
          setGenerateModalVisible(false);
          setDocId('');
          Alert.alert('Success', 'Digest generation triggered.');
        },
        onError: (err) => {
          Alert.alert('Error', err.message);
        },
      },
    );
  }, [docId, selectedType, triggerGeneration]);

  const renderJob = useCallback(
    ({ item }: { item: GenerationJob }) => <JobCard item={item} />,
    [],
  );

  const isLoading = statsLoading || jobsLoading;

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Derivatives' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  const byTypeEntries = stats?.byType
    ? Object.entries(stats.byType)
    : [];
  const byStatusEntries = stats?.byStatus
    ? Object.entries(stats.byStatus)
    : [];

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Derivatives',
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setGenerateModalVisible(true)}
              style={styles.headerButton}
            >
              <Ionicons name="add-circle-outline" size={24} color="#1a56db" />
            </TouchableOpacity>
          ),
        }}
      />

      <FlatList
        data={jobs ?? []}
        renderItem={renderJob}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={handleRefresh}
            colors={['#1a56db']}
          />
        }
        ListHeaderComponent={
          <View>
            {/* Stats cards */}
            <View style={styles.statsRow}>
              <StatCard
                label="Total Digests"
                value={stats?.totalDigests ?? 0}
                color="#1a56db"
              />
              <StatCard
                label="Pending Review"
                value={stats?.pendingReview ?? 0}
                color="#d97706"
              />
              <StatCard
                label="Avg Confidence"
                value={
                  stats?.avgConfidence != null
                    ? `${Math.round(stats.avgConfidence * 100)}%`
                    : 'N/A'
                }
                color="#059669"
              />
            </View>

            {/* By Type breakdown */}
            {byTypeEntries.length > 0 ? (
              <View style={styles.breakdownSection}>
                <Text style={styles.breakdownTitle}>By Type</Text>
                {byTypeEntries.map(([type, count]) => (
                  <View key={type} style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>
                      {type.replace(/_/g, ' ')}
                    </Text>
                    <Text style={styles.breakdownValue}>{count}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* By Status breakdown */}
            {byStatusEntries.length > 0 ? (
              <View style={styles.breakdownSection}>
                <Text style={styles.breakdownTitle}>By Status</Text>
                {byStatusEntries.map(([status, count]) => (
                  <View key={status} style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>
                      {status.replace(/_/g, ' ')}
                    </Text>
                    <Text style={styles.breakdownValue}>{count}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Recent Generations header */}
            <Text style={styles.sectionTitle}>Recent Generations</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="flask-outline" size={40} color="#d1d5db" />
            <Text style={styles.emptyText}>No recent generation jobs</Text>
          </View>
        }
      />

      {/* Generate modal */}
      <Modal
        visible={generateModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGenerateModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setGenerateModalVisible(false)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Trigger Digest Generation</Text>

            <Text style={styles.inputLabel}>Legal Document ID</Text>
            <TextInput
              style={styles.textInput}
              placeholder="Enter document UUID"
              placeholderTextColor="#9ca3af"
              value={docId}
              onChangeText={setDocId}
              autoCapitalize="none"
            />

            <Text style={styles.inputLabel}>Digest Type</Text>
            <View style={styles.typeChips}>
              {DIGEST_TYPE_OPTIONS.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.typeChip,
                    t === selectedType && styles.typeChipActive,
                  ]}
                  onPress={() => setSelectedType(t)}
                >
                  <Text
                    style={[
                      styles.typeChipText,
                      t === selectedType && styles.typeChipTextActive,
                    ]}
                  >
                    {t.replace(/_/g, ' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[
                styles.generateButton,
                triggerGeneration.isPending && styles.generateButtonDisabled,
              ]}
              onPress={handleGenerate}
              disabled={triggerGeneration.isPending}
              activeOpacity={0.7}
            >
              {triggerGeneration.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.generateButtonText}>Generate</Text>
              )}
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  headerButton: { marginRight: 8 },
  listContent: { padding: 12, paddingBottom: 32 },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
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
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a56db',
  },
  statLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
    textAlign: 'center',
  },
  breakdownSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  breakdownTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
    marginTop: 4,
  },
  jobCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  jobHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  jobStatusBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  jobStatusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  jobType: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  jobTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 20,
    marginBottom: 4,
  },
  jobFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  jobDate: {
    fontSize: 11,
    color: '#9ca3af',
  },
  jobError: {
    fontSize: 11,
    color: '#dc2626',
    flex: 1,
    marginLeft: 8,
    textAlign: 'right',
  },
  emptyState: {
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    marginBottom: 14,
  },
  typeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
  },
  typeChipActive: {
    backgroundColor: '#1a56db',
  },
  typeChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  typeChipTextActive: {
    color: '#fff',
  },
  generateButton: {
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  generateButtonDisabled: {
    opacity: 0.6,
  },
  generateButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
