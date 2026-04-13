import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import {
  useClassificationDetail,
  useConfirmClassification,
  useRejectClassification,
  useOverrideClassification,
} from '../../../features/admin/hooks/use-admin-classification';
import { useBarSubjects } from '../../../features/study/hooks/use-bar-subjects';

function getConfidenceColor(score: number): string {
  if (score >= 0.7) return '#059669';
  if (score >= 0.4) return '#d97706';
  return '#dc2626';
}

export default function ClassificationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading } = useClassificationDetail(id ?? '');
  const { data: barSubjects } = useBarSubjects();
  const confirmMutation = useConfirmClassification();
  const rejectMutation = useRejectClassification();
  const overrideMutation = useOverrideClassification();

  const [showOverride, setShowOverride] = useState(false);
  const [primaryCode, setPrimaryCode] = useState('');
  const [secondaryCode, setSecondaryCode] = useState('');

  const handleConfirm = useCallback(() => {
    if (!id) return;
    confirmMutation.mutate(
      { id },
      {
        onSuccess: () => {
          Alert.alert('Confirmed', 'Classification has been confirmed.');
          router.back();
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  }, [id, confirmMutation]);

  const handleReject = useCallback(() => {
    if (!id) return;
    rejectMutation.mutate(
      { id },
      {
        onSuccess: () => {
          Alert.alert('Rejected', 'Classification has been rejected.');
          router.back();
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  }, [id, rejectMutation]);

  const handleOverride = useCallback(() => {
    if (!id || !primaryCode) {
      Alert.alert('Error', 'Please select a primary subject.');
      return;
    }
    overrideMutation.mutate(
      { id, primaryCode, secondaryCode: secondaryCode || undefined },
      {
        onSuccess: () => {
          Alert.alert('Overridden', 'Classification has been overridden.');
          router.back();
        },
        onError: (err) => Alert.alert('Error', err.message),
      },
    );
  }, [id, primaryCode, secondaryCode, overrideMutation]);

  const toggleOverride = useCallback(() => {
    if (!showOverride && data) {
      setPrimaryCode(data.predictedPrimary ?? '');
      setSecondaryCode(data.predictedSecondary ?? '');
    }
    setShowOverride((v) => !v);
  }, [showOverride, data]);

  if (isLoading || !data) {
    return (
      <>
        <Stack.Screen options={{ title: 'Classification Detail' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  const subjectOptions = barSubjects ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Classification Detail' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Document Info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>{data.documentTitle}</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Document Type</Text>
            <Text style={styles.infoValue}>
              {(data.documentType ?? 'N/A').replace(/_/g, ' ')}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Court</Text>
            <Text style={styles.infoValue}>{data.court ?? 'N/A'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Created</Text>
            <Text style={styles.infoValue}>
              {new Date(data.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
          </View>
        </View>

        {/* AI Prediction */}
        <View style={styles.predictionCard}>
          <Text style={styles.predictionHeader}>AI Prediction</Text>
          <View style={styles.predictionRow}>
            <Text style={styles.predictionLabel}>Primary Subject</Text>
            <View style={styles.tag}>
              <Text style={styles.tagText}>
                {data.predictedPrimary ?? 'None'}
              </Text>
            </View>
          </View>
          <View style={styles.predictionRow}>
            <Text style={styles.predictionLabel}>Secondary Subject</Text>
            <View style={[styles.tag, styles.tagSecondary]}>
              <Text style={styles.tagSecondaryText}>
                {data.predictedSecondary ?? 'None'}
              </Text>
            </View>
          </View>
          <View style={styles.predictionRow}>
            <Text style={styles.predictionLabel}>Confidence</Text>
            <Text
              style={[
                styles.confidenceValue,
                { color: getConfidenceColor(data.confidence) },
              ]}
            >
              {Math.round(data.confidence * 100)}%
            </Text>
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.actionSection}>
          <TouchableOpacity
            style={styles.confirmButton}
            onPress={handleConfirm}
            disabled={confirmMutation.isPending}
            activeOpacity={0.7}
          >
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={styles.actionButtonText}>Confirm</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.rejectButton}
            onPress={handleReject}
            disabled={rejectMutation.isPending}
            activeOpacity={0.7}
          >
            <Ionicons name="close-circle" size={20} color="#fff" />
            <Text style={styles.actionButtonText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.overrideButton}
            onPress={toggleOverride}
            activeOpacity={0.7}
          >
            <Ionicons name="create-outline" size={20} color="#fff" />
            <Text style={styles.actionButtonText}>Override</Text>
          </TouchableOpacity>
        </View>

        {/* Override form */}
        {showOverride ? (
          <View style={styles.overrideForm}>
            <Text style={styles.overrideFormTitle}>Manual Override</Text>

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
                styles.saveOverrideButton,
                overrideMutation.isPending && styles.buttonDisabled,
              ]}
              onPress={handleOverride}
              disabled={overrideMutation.isPending}
              activeOpacity={0.7}
            >
              {overrideMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveOverrideText}>Save Override</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 12, paddingBottom: 32 },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  infoCard: {
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
  infoTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
    lineHeight: 22,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    textTransform: 'capitalize',
  },
  predictionCard: {
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
  predictionHeader: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },
  predictionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  predictionLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  tag: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  tagSecondary: {
    backgroundColor: '#f3f4f6',
  },
  tagSecondaryText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  confidenceValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  actionSection: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  confirmButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#059669',
    borderRadius: 8,
    paddingVertical: 12,
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#dc2626',
    borderRadius: 8,
    paddingVertical: 12,
  },
  overrideButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingVertical: 12,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  overrideForm: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  overrideFormTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
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
  saveOverrideButton: {
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  saveOverrideText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
