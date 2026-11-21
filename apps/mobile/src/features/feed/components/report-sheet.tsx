import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { FeedReportReason } from '@libertasian/types';
import { useReportPost } from '../hooks/use-feed-interactions';
import { useReportComment } from '../hooks/use-feed-comments';
import { feedErrorMessage } from '../lib/feed-error-message';

/** What is being reported. Posts and comments share one reason set. */
export type ReportTarget = { type: 'post'; id: string } | { type: 'comment'; id: string };

interface ReportSheetProps {
  visible: boolean;
  target: ReportTarget;
  onClose: () => void;
}

export const REPORT_RECEIVED_MESSAGE =
  'Thank you for your report. Our moderators review reports within 24 hours and remove content that breaks our Community Guidelines.';

const REASONS: { value: FeedReportReason; label: string; icon: string }[] = [
  { value: 'spam', label: 'Spam', icon: 'mail-unread-outline' },
  { value: 'inappropriate', label: 'Inappropriate Content', icon: 'alert-circle-outline' },
  { value: 'harassment', label: 'Harassment', icon: 'hand-left-outline' },
  { value: 'misinformation', label: 'Misinformation', icon: 'information-circle-outline' },
  { value: 'copyright', label: 'Copyright Violation', icon: 'document-lock-outline' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
];

export function ReportSheet({ visible, target, onClose }: ReportSheetProps) {
  const [selectedReason, setSelectedReason] = useState<FeedReportReason | null>(null);
  const [details, setDetails] = useState('');
  const reportPost = useReportPost();
  const reportComment = useReportComment();
  const isPending = reportPost.isPending || reportComment.isPending;
  const noun = target.type === 'post' ? 'post' : 'comment';

  const handleSubmit = () => {
    if (!selectedReason) return;

    const callbacks = {
      onSuccess: () => {
        Alert.alert('Report Submitted', REPORT_RECEIVED_MESSAGE);
        resetAndClose();
      },
      onError: (error: unknown) => {
        // A duplicate report answers 400 "You have already reported this …".
        Alert.alert('Error', feedErrorMessage(error, 'Failed to submit report. Please try again.'));
      },
    };
    const reason = selectedReason;
    const trimmed = details.trim() || undefined;

    if (target.type === 'post') {
      reportPost.mutate({ postId: target.id, reason, details: trimmed }, callbacks);
    } else {
      reportComment.mutate({ commentId: target.id, reason, details: trimmed }, callbacks);
    }
  };

  const resetAndClose = () => {
    setSelectedReason(null);
    setDetails('');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={resetAndClose}>
      <Pressable style={styles.overlay} onPress={resetAndClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>{target.type === 'post' ? 'Report Post' : 'Report Comment'}</Text>
          <Text style={styles.subtitle}>Why are you reporting this {noun}?</Text>

          {REASONS.map((reason) => (
            <TouchableOpacity
              key={reason.value}
              style={[styles.reasonItem, selectedReason === reason.value && styles.reasonSelected]}
              onPress={() => setSelectedReason(reason.value)}
            >
              <Ionicons
                name={reason.icon as keyof typeof Ionicons.glyphMap}
                size={20}
                color={selectedReason === reason.value ? '#1a56db' : '#6b7280'}
              />
              <Text style={[styles.reasonText, selectedReason === reason.value && styles.reasonTextSelected]}>
                {reason.label}
              </Text>
              {selectedReason === reason.value && (
                <Ionicons name="checkmark-circle" size={20} color="#1a56db" style={styles.checkIcon} />
              )}
            </TouchableOpacity>
          ))}

          {selectedReason && (
            <TextInput
              style={styles.detailsInput}
              placeholder="Additional details (optional)"
              placeholderTextColor="#9ca3af"
              value={details}
              onChangeText={setDetails}
              multiline
              maxLength={1000}
              textAlignVertical="top"
            />
          )}

          <TouchableOpacity
            style={[styles.submitButton, !selectedReason && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={!selectedReason || isPending}
          >
            {isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitText}>Submit Report</Text>
            )}
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 34,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#d1d5db',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 16,
  },
  reasonItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  reasonSelected: {
    backgroundColor: '#eff6ff',
  },
  reasonText: {
    fontSize: 14,
    color: '#374151',
    flex: 1,
  },
  reasonTextSelected: {
    color: '#1a56db',
    fontWeight: '500',
  },
  checkIcon: {
    marginLeft: 'auto',
  },
  detailsInput: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    minHeight: 80,
    marginTop: 12,
  },
  submitButton: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  submitDisabled: {
    opacity: 0.5,
  },
  submitText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
