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
  Pressable,
  Alert,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import {
  useClassificationQueue,
  useClassificationStats,
  useConfirmClassification,
  useRejectClassification,
  useOverrideClassification,
} from '../../../features/admin/hooks/use-admin-classification';
import { useBarSubjects } from '../../../features/study/hooks/use-bar-subjects';
import type { ClassificationReviewItem } from '../../../features/admin/hooks/use-admin-classification';

function getConfidenceColor(score: number): string {
  if (score >= 0.7) return '#059669';
  if (score >= 0.4) return '#d97706';
  return '#dc2626';
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <View style={[styles.statPill, { borderColor: color }]}>
      <Text style={[styles.statPillValue, { color }]}>{value}</Text>
      <Text style={styles.statPillLabel}>{label}</Text>
    </View>
  );
}

export default function ClassificationScreen() {
  const [overrideItem, setOverrideItem] =
    useState<ClassificationReviewItem | null>(null);
  const [primaryCode, setPrimaryCode] = useState('');
  const [secondaryCode, setSecondaryCode] = useState('');

  const {
    data: queueData,
    isLoading: queueLoading,
    isFetching,
    refetch: refetchQueue,
  } = useClassificationQueue({ limit: 30 });
  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useClassificationStats();
  const { data: barSubjects } = useBarSubjects();
  const confirmMutation = useConfirmClassification();
  const rejectMutation = useRejectClassification();
  const overrideMutation = useOverrideClassification();

  const handleRefresh = useCallback(() => {
    refetchQueue();
    refetchStats();
  }, [refetchQueue, refetchStats]);

  const handleConfirm = useCallback(
    (id: string) => {
      confirmMutation.mutate(
        { id },
        {
          onError: (err) => Alert.alert('Error', err.message),
        },
      );
    },
    [confirmMutation],
  );

  const handleReject = useCallback(
    (id: string) => {
      rejectMutation.mutate(
        { id },
        {
          onError: (err) => Alert.alert('Error', err.message),
        },
      );
    },
    [rejectMutation],
  );

  const openOverride = useCallback(
    (item: ClassificationReviewItem) => {
      setPrimaryCode(item.predictedPrimary ?? '');
      setSecondaryCode(item.predictedSecondary ?? '');
      setOverrideItem(item);
    },
    [],
  );

  const handleOverride = useCallback(() => {
    if (!overrideItem || !primaryCode) {
      Alert.alert('Error', 'Please select a primary subject.');
      return;
    }
    overrideMutation.mutate(
      {
        id: overrideItem.id,
        primaryCode,
        secondaryCode: secondaryCode || undefined,
      },
      {
        onSuccess: () => {
          setOverrideItem(null);
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  }, [overrideItem, primaryCode, secondaryCode, overrideMutation]);

  const subjectOptions = barSubjects ?? [];

  const renderItem = useCallback(
    ({ item }: { item: ClassificationReviewItem }) => (
      <TouchableOpacity
        style={styles.card}
        onPress={() => router.push(`/admin/classification/${item.id}`)}
        activeOpacity={0.7}
      >
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.documentTitle}
        </Text>

        <View style={styles.tagRow}>
          {item.predictedPrimary ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{item.predictedPrimary}</Text>
            </View>
          ) : null}
          {item.predictedSecondary ? (
            <View style={[styles.tag, styles.tagSecondary]}>
              <Text style={styles.tagSecondaryText}>
                {item.predictedSecondary}
              </Text>
            </View>
          ) : null}
          <Text
            style={[
              styles.confidenceText,
              { color: getConfidenceColor(item.confidence) },
            ]}
          >
            {Math.round(item.confidence * 100)}%
          </Text>
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.confirmBtn}
            onPress={() => handleConfirm(item.id)}
          >
            <Ionicons name="checkmark-circle" size={20} color="#059669" />
            <Text style={styles.confirmBtnText}>Confirm</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.rejectBtn}
            onPress={() => handleReject(item.id)}
          >
            <Ionicons name="close-circle" size={20} color="#dc2626" />
            <Text style={styles.rejectBtnText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.overrideBtn}
            onPress={() => openOverride(item)}
          >
            <Ionicons name="create-outline" size={20} color="#1a56db" />
            <Text style={styles.overrideBtnText}>Override</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    ),
    [handleConfirm, handleReject, openOverride],
  );

  const isLoading = queueLoading || statsLoading;

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Classification Review' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  const items = queueData?.items ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Classification Review' }} />

      <FlatList
        data={items}
        renderItem={renderItem}
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
          stats ? (
            <View style={styles.statsBar}>
              <StatPill
                label="Pending"
                value={stats.pendingReview}
                color="#d97706"
              />
              <StatPill
                label="Confirmed"
                value={stats.confirmedCount}
                color="#059669"
              />
              <StatPill
                label="Rejected"
                value={stats.rejectedCount}
                color="#dc2626"
              />
              <StatPill
                label="Overridden"
                value={stats.overriddenCount}
                color="#1a56db"
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-done-outline" size={40} color="#d1d5db" />
            <Text style={styles.emptyText}>
              No classifications pending review
            </Text>
          </View>
        }
      />

      {/* Override modal */}
      <Modal
        visible={overrideItem !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setOverrideItem(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setOverrideItem(null)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>Override Classification</Text>
            {overrideItem ? (
              <Text style={styles.modalDocTitle} numberOfLines={2}>
                {overrideItem.documentTitle}
              </Text>
            ) : null}

            <Text style={styles.inputLabel}>Primary Bar Subject</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={primaryCode}
                onValueChange={setPrimaryCode}
                style={styles.picker}
              >
                <Picker.Item label="Select..." value="" />
                {subjectOptions.map((s) => (
                  <Picker.Item key={s.code} label={s.name} value={s.code} />
                ))}
              </Picker>
            </View>

            <Text style={styles.inputLabel}>Secondary Bar Subject</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={secondaryCode}
                onValueChange={setSecondaryCode}
                style={styles.picker}
              >
                <Picker.Item label="None" value="" />
                {subjectOptions.map((s) => (
                  <Picker.Item key={s.code} label={s.name} value={s.code} />
                ))}
              </Picker>
            </View>

            <TouchableOpacity
              style={[
                styles.submitButton,
                overrideMutation.isPending && styles.submitButtonDisabled,
              ]}
              onPress={handleOverride}
              disabled={overrideMutation.isPending}
              activeOpacity={0.7}
            >
              {overrideMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitButtonText}>Save Override</Text>
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
  listContent: { padding: 12, paddingBottom: 32 },
  statsBar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  statPill: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
  },
  statPillValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  statPillLabel: {
    fontSize: 10,
    color: '#6b7280',
    marginTop: 1,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 20,
    marginBottom: 8,
  },
  tagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  tag: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  tagSecondary: {
    backgroundColor: '#f3f4f6',
  },
  tagSecondaryText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
    paddingTop: 10,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#ecfdf5',
  },
  confirmBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#059669',
  },
  rejectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#fef2f2',
  },
  rejectBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#dc2626',
  },
  overrideBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#eff6ff',
  },
  overrideBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a56db',
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
  // Override modal
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
    marginBottom: 4,
  },
  modalDocTitle: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    marginBottom: 14,
    overflow: 'hidden',
  },
  picker: {
    height: 48,
  },
  submitButton: {
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
