import { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useCreateFlag } from '../hooks/use-community-flags';
import type { FlagEntityType, FlagReason } from '../types';

const FLAG_REASONS: Array<{ value: FlagReason; label: string }> = [
  { value: 'spam', label: 'Spam' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'copyright', label: 'Copyright violation' },
  { value: 'inaccurate', label: 'Inaccurate information' },
  { value: 'other', label: 'Other' },
];

interface FlagModalProps {
  entityType: FlagEntityType;
  entityId: string;
  visible: boolean;
  onClose: () => void;
}

export function FlagModal({
  entityType,
  entityId,
  visible,
  onClose,
}: FlagModalProps) {
  const [reason, setReason] = useState<FlagReason | null>(null);
  const [details, setDetails] = useState('');
  const createFlag = useCreateFlag();

  const handleSubmit = useCallback(() => {
    if (!reason) return;
    createFlag.mutate(
      {
        entityType,
        entityId,
        reason,
        details: details.trim() || undefined,
      },
      {
        onSuccess: () => {
          Alert.alert('Report Submitted', 'Thank you for helping keep the community safe.');
          setReason(null);
          setDetails('');
          onClose();
        },
        onError: (error) => {
          Alert.alert(
            'Error',
            error instanceof Error ? error.message : 'Failed to submit report',
          );
        },
      },
    );
  }, [entityType, entityId, reason, details, createFlag, onClose]);

  const handleClose = useCallback(() => {
    setReason(null);
    setDetails('');
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Report Content</Text>
          <View style={{ width: 50 }} />
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <Text style={styles.description}>
            Help us keep the community safe. Select a reason for reporting this
            content.
          </Text>

          {/* Reason selector */}
          <Text style={styles.label}>Reason</Text>
          {FLAG_REASONS.map((r) => (
            <TouchableOpacity
              key={r.value}
              style={[
                styles.reasonOption,
                reason === r.value && styles.reasonOptionActive,
              ]}
              onPress={() => setReason(r.value)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={
                  reason === r.value
                    ? 'radio-button-on'
                    : 'radio-button-off'
                }
                size={20}
                color={reason === r.value ? '#1a56db' : '#9ca3af'}
              />
              <Text
                style={[
                  styles.reasonLabel,
                  reason === r.value && styles.reasonLabelActive,
                ]}
              >
                {r.label}
              </Text>
            </TouchableOpacity>
          ))}

          {/* Details */}
          <Text style={[styles.label, { marginTop: 16 }]}>
            Details (optional)
          </Text>
          <TextInput
            style={styles.textInput}
            placeholder="Provide additional context..."
            placeholderTextColor="#9ca3af"
            value={details}
            onChangeText={setDetails}
            maxLength={2000}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          {/* Submit */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              (!reason || createFlag.isPending) && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!reason || createFlag.isPending}
            activeOpacity={0.7}
          >
            <Text style={styles.submitButtonText}>
              {createFlag.isPending ? 'Submitting...' : 'Submit Report'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Convenience button to trigger the flag modal */
interface FlagButtonProps {
  onPress: () => void;
}

export function FlagButton({ onPress }: FlagButtonProps) {
  return (
    <TouchableOpacity
      style={styles.flagButton}
      onPress={onPress}
      activeOpacity={0.6}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Ionicons name="flag-outline" size={14} color="#6b7280" />
      <Text style={styles.flagButtonText}>Report</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  cancelText: {
    fontSize: 15,
    color: '#1a56db',
    fontWeight: '500',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    paddingBottom: 32,
  },
  description: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  reasonOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  reasonOptionActive: {
    backgroundColor: '#eff6ff',
  },
  reasonLabel: {
    fontSize: 14,
    color: '#374151',
  },
  reasonLabelActive: {
    color: '#1a56db',
    fontWeight: '500',
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    minHeight: 80,
  },
  submitButton: {
    backgroundColor: '#dc2626',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  flagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 6,
  },
  flagButtonText: {
    fontSize: 12,
    color: '#6b7280',
  },
});
