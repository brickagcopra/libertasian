import { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  RefreshControl,
} from 'react-native';
import { Stack, useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useReviewQueue,
  useSubmitReview,
  useUnassignReviewer,
} from '../../../features/admin/hooks/use-admin-review';

// ---- Helpers ----

function getConfidenceColor(score: number | null): string {
  if (score === null) return '#6b7280';
  if (score >= 0.7) return '#059669';
  if (score >= 0.4) return '#d97706';
  return '#dc2626';
}

function getStatusStyle(status: string): { bg: string; text: string } {
  switch (status) {
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
}

function formatLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---- Collapsible Section ----

function CollapsibleSection({
  title,
  content,
  defaultOpen,
}: {
  title: string;
  content: string | null;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);

  if (!content) return null;

  return (
    <View style={sectionStyles.container}>
      <TouchableOpacity
        style={sectionStyles.header}
        onPress={() => setIsOpen(!isOpen)}
        activeOpacity={0.7}
      >
        <Text style={sectionStyles.title}>{title}</Text>
        <Ionicons
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="#6b7280"
        />
      </TouchableOpacity>
      {isOpen ? (
        <Text style={sectionStyles.content}>{content}</Text>
      ) : null}
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  content: {
    fontSize: 14,
    lineHeight: 22,
    color: '#374151',
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
});

// ---- Main Screen ----

export default function ReviewDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [notesInput, setNotesInput] = useState('');
  const [showNotesFor, setShowNotesFor] = useState<string | null>(null);

  // Fetch the item from the review queue
  const {
    data: queueData,
    isLoading,
    isFetching,
    refetch,
  } = useReviewQueue({ limit: 50 });

  const item = queueData?.items?.find((i) => i.id === id) ?? null;

  const submitReview = useSubmitReview();
  const unassignReviewer = useUnassignReviewer();

  const handleApprove = useCallback(() => {
    if (!id) return;
    Alert.alert(
      'Approve Digest',
      'Are you sure you want to approve this digest? It will become publicly visible.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => {
            submitReview.mutate(
              { id, verdict: 'approve', notes: undefined },
              {
                onSuccess: () => {
                  Alert.alert('Success', 'Digest approved successfully.');
                  router.back();
                },
                onError: (error) => {
                  Alert.alert('Error', error.message || 'Failed to approve digest.');
                },
              },
            );
          },
        },
      ],
    );
  }, [id, submitReview]);

  const handleReject = useCallback(() => {
    if (!id) return;
    setShowNotesFor('reject');
    setNotesInput('');
  }, [id]);

  const handleNeedsRevision = useCallback(() => {
    if (!id) return;
    setShowNotesFor('needs_revision');
    setNotesInput('');
  }, [id]);

  const handleSubmitWithNotes = useCallback(() => {
    if (!id || !showNotesFor) return;
    const verdict = showNotesFor as 'reject' | 'needs_revision';
    const notes = notesInput.trim() || undefined;

    Alert.alert(
      `${verdict === 'reject' ? 'Reject' : 'Request Revision'}`,
      `Are you sure you want to ${verdict === 'reject' ? 'reject' : 'request revision for'} this digest?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: verdict === 'reject' ? 'destructive' : 'default',
          onPress: () => {
            submitReview.mutate(
              { id, verdict, notes },
              {
                onSuccess: () => {
                  Alert.alert(
                    'Success',
                    verdict === 'reject'
                      ? 'Digest rejected.'
                      : 'Revision requested.',
                  );
                  setShowNotesFor(null);
                  setNotesInput('');
                  router.back();
                },
                onError: (error) => {
                  Alert.alert('Error', error.message || 'Action failed.');
                },
              },
            );
          },
        },
      ],
    );
  }, [id, showNotesFor, notesInput, submitReview]);

  const handleUnassign = useCallback(() => {
    if (!id) return;
    Alert.alert(
      'Unassign Reviewer',
      'Remove the current reviewer assignment?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unassign',
          onPress: () => {
            unassignReviewer.mutate(
              { id },
              {
                onSuccess: () => {
                  refetch();
                },
                onError: (error) => {
                  Alert.alert('Error', error.message || 'Failed to unassign.');
                },
              },
            );
          },
        },
      ],
    );
  }, [id, unassignReviewer, refetch]);

  // ---- Loading State ----

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Review Detail' }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  // ---- Not Found State ----

  if (!item) {
    return (
      <>
        <Stack.Screen options={{ title: 'Review Detail' }} />
        <View style={styles.loadingContainer}>
          <Ionicons name="alert-circle-outline" size={48} color="#d1d5db" />
          <Text style={styles.notFoundText}>Digest not found</Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const statusColors = getStatusStyle(item.reviewStatus);
  const confidenceColor = getConfidenceColor(item.confidenceScore);
  const isMutating = submitReview.isPending || unassignReviewer.isPending;

  return (
    <>
      <Stack.Screen options={{ title: 'Review Detail' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={() => refetch()}
            colors={['#1a56db']}
          />
        }
      >
        {/* Title & Metadata Card */}
        <View style={styles.card}>
          <Text style={styles.title}>{item.title}</Text>

          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: statusColors.bg }]}>
              <Text style={[styles.badgeText, { color: statusColors.text }]}>
                {formatLabel(item.reviewStatus)}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: '#dbeafe' }]}>
              <Text style={[styles.badgeText, { color: '#1e40af' }]}>
                {formatLabel(item.digestType)}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: '#ede9fe' }]}>
              <Text style={[styles.badgeText, { color: '#5b21b6' }]}>
                {formatLabel(item.sourceOrigin)}
              </Text>
            </View>
          </View>

          {/* Confidence Score */}
          <View style={styles.confidenceContainer}>
            <Text style={styles.metaLabel}>Confidence Score</Text>
            <View style={styles.confidenceRow}>
              <View
                style={[
                  styles.confidenceBar,
                  {
                    backgroundColor: `${confidenceColor}20`,
                  },
                ]}
              >
                <View
                  style={[
                    styles.confidenceFill,
                    {
                      backgroundColor: confidenceColor,
                      width: `${(item.confidenceScore ?? 0) * 100}%`,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.confidenceValue, { color: confidenceColor }]}>
                {item.confidenceScore !== null
                  ? `${(item.confidenceScore * 100).toFixed(0)}%`
                  : 'N/A'}
              </Text>
            </View>
          </View>

          {/* Visibility */}
          <View style={styles.detailRow}>
            <Text style={styles.metaLabel}>Visibility</Text>
            <Text style={styles.metaValue}>{formatLabel(item.visibility)}</Text>
          </View>

          {/* Created Date */}
          <View style={styles.detailRow}>
            <Text style={styles.metaLabel}>Created</Text>
            <Text style={styles.metaValue}>{formatDate(item.createdAt)}</Text>
          </View>
        </View>

        {/* Source Document Card */}
        {item.legalDocument ? (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Ionicons name="document-text-outline" size={16} color="#1a56db" />
              <Text style={styles.cardHeaderText}>Source Document</Text>
            </View>
            <Text style={styles.docTitle}>{item.legalDocument.title}</Text>
            {item.legalDocument.grNo ? (
              <View style={styles.docDetailRow}>
                <Text style={styles.docLabel}>G.R. No.</Text>
                <Text style={styles.docValue}>{item.legalDocument.grNo}</Text>
              </View>
            ) : null}
            {item.legalDocument.court ? (
              <View style={styles.docDetailRow}>
                <Text style={styles.docLabel}>Court</Text>
                <Text style={styles.docValue}>{item.legalDocument.court}</Text>
              </View>
            ) : null}
            {item.legalDocument.decisionDate ? (
              <View style={styles.docDetailRow}>
                <Text style={styles.docLabel}>Decision Date</Text>
                <Text style={styles.docValue}>
                  {formatDate(item.legalDocument.decisionDate)}
                </Text>
              </View>
            ) : null}
            {item.legalDocument.citationText ? (
              <View style={styles.docDetailRow}>
                <Text style={styles.docLabel}>Citation</Text>
                <Text style={styles.docValue}>{item.legalDocument.citationText}</Text>
              </View>
            ) : null}
            {item.legalDocument.documentType ? (
              <View style={styles.docDetailRow}>
                <Text style={styles.docLabel}>Type</Text>
                <Text style={styles.docValue}>
                  {formatLabel(item.legalDocument.documentType)}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Reviewer Assignment Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="person-outline" size={16} color="#1a56db" />
            <Text style={styles.cardHeaderText}>Reviewer Assignment</Text>
          </View>
          {item.assignedReviewer ? (
            <View style={styles.reviewerInfo}>
              <View style={styles.reviewerAvatar}>
                <Text style={styles.reviewerAvatarText}>
                  {(item.assignedReviewer.fullName ?? 'R')
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)}
                </Text>
              </View>
              <View style={styles.reviewerDetails}>
                <Text style={styles.reviewerName}>
                  {item.assignedReviewer.fullName ?? 'Unknown Reviewer'}
                </Text>
                <TouchableOpacity
                  onPress={handleUnassign}
                  disabled={isMutating}
                  activeOpacity={0.7}
                >
                  <Text style={styles.unassignText}>Unassign</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <Text style={styles.noReviewer}>No reviewer assigned</Text>
          )}
        </View>

        {/* Digest Content Sections */}
        <Text style={styles.sectionGroupTitle}>DIGEST CONTENT</Text>

        <CollapsibleSection
          title="Facts"
          content={item.title}
          defaultOpen
        />

        {/*
          Note: The review queue item from the list API does not include
          full digest content fields (facts, issues, ruling, doctrine, dispositive).
          Those would come from a dedicated detail endpoint. The collapsible sections
          below are shown as placeholders for when a full detail API is available.
          Currently we show the digest title as a summary in the Facts section.
        */}

        {/* Notes Input for Reject / Needs Revision */}
        {showNotesFor ? (
          <View style={styles.card}>
            <Text style={styles.notesLabel}>
              {showNotesFor === 'reject'
                ? 'Rejection Reason'
                : 'Revision Notes'}
            </Text>
            <TextInput
              style={styles.notesInput}
              placeholder={
                showNotesFor === 'reject'
                  ? 'Enter reason for rejection...'
                  : 'Enter notes for revision...'
              }
              placeholderTextColor="#9ca3af"
              value={notesInput}
              onChangeText={setNotesInput}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
            <View style={styles.notesActions}>
              <TouchableOpacity
                style={styles.notesCancelButton}
                onPress={() => {
                  setShowNotesFor(null);
                  setNotesInput('');
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.notesCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.notesSubmitButton,
                  showNotesFor === 'reject'
                    ? styles.rejectBg
                    : styles.revisionBg,
                ]}
                onPress={handleSubmitWithNotes}
                disabled={isMutating}
                activeOpacity={0.7}
              >
                {isMutating ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.notesSubmitText}>
                    {showNotesFor === 'reject' ? 'Reject' : 'Request Revision'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Spacer for action buttons */}
        <View style={styles.actionSpacer} />
      </ScrollView>

      {/* Action Buttons - Fixed at bottom */}
      {!showNotesFor ? (
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={[styles.actionButton, styles.approveButton]}
            onPress={handleApprove}
            disabled={isMutating}
            activeOpacity={0.8}
          >
            {submitReview.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
                <Text style={styles.actionButtonText}>Approve</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.revisionButton]}
            onPress={handleNeedsRevision}
            disabled={isMutating}
            activeOpacity={0.8}
          >
            <Ionicons name="pencil" size={20} color="#fff" />
            <Text style={styles.actionButtonText}>Revise</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.rejectButton]}
            onPress={handleReject}
            disabled={isMutating}
            activeOpacity={0.8}
          >
            <Ionicons name="close-circle" size={20} color="#fff" />
            <Text style={styles.actionButtonText}>Reject</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  content: {
    padding: 16,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    gap: 12,
  },
  notFoundText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
  },
  backButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1a56db',
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },

  // ---- Card ----
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  cardHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a56db',
  },

  // ---- Title & Badges ----
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
    lineHeight: 24,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 16,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // ---- Confidence ----
  confidenceContainer: {
    marginBottom: 12,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  confidenceBar: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: 4,
  },
  confidenceValue: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 40,
    textAlign: 'right',
  },

  // ---- Detail Rows ----
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  metaLabel: {
    fontSize: 13,
    color: '#6b7280',
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '500',
    color: '#111827',
  },

  // ---- Document Reference ----
  docTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 10,
    lineHeight: 20,
  },
  docDetailRow: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  docLabel: {
    fontSize: 12,
    color: '#6b7280',
    width: 100,
  },
  docValue: {
    fontSize: 12,
    color: '#111827',
    flex: 1,
    fontWeight: '500',
  },

  // ---- Reviewer ----
  reviewerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reviewerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a56db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewerAvatarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  reviewerDetails: {
    flex: 1,
  },
  reviewerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  unassignText: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '500',
    marginTop: 2,
  },
  noReviewer: {
    fontSize: 14,
    color: '#9ca3af',
    fontStyle: 'italic',
  },

  // ---- Section Group ----
  sectionGroupTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 2,
  },

  // ---- Notes Input ----
  notesLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  notesInput: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    minHeight: 100,
    marginBottom: 12,
  },
  notesActions: {
    flexDirection: 'row',
    gap: 10,
  },
  notesCancelButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  notesCancelText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  notesSubmitButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  notesSubmitText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  rejectBg: {
    backgroundColor: '#dc2626',
  },
  revisionBg: {
    backgroundColor: '#d97706',
  },

  // ---- Action Bar ----
  actionSpacer: {
    height: 20,
  },
  actionBar: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    paddingBottom: 32,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 4,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 10,
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  approveButton: {
    backgroundColor: '#059669',
  },
  revisionButton: {
    backgroundColor: '#d97706',
  },
  rejectButton: {
    backgroundColor: '#dc2626',
  },
});
