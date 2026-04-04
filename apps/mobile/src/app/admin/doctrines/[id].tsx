import { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useAdminDoctrineDetail,
  useApproveDoctrine,
  useRejectDoctrine,
} from '../../../features/admin/hooks/use-admin-doctrines';

export default function DoctrineDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const doctrineId = id ?? '';

  const { data: doctrine, isLoading, error } = useAdminDoctrineDetail(doctrineId);
  const approve = useApproveDoctrine();
  const reject = useRejectDoctrine();

  const handleApprove = useCallback(() => {
    Alert.alert(
      'Approve Doctrine',
      'Are you sure you want to approve this doctrine?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => approve.mutate(doctrineId),
        },
      ],
    );
  }, [approve, doctrineId]);

  const handleReject = useCallback(() => {
    Alert.alert(
      'Reject Doctrine',
      'Are you sure you want to reject this doctrine?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: () => reject.mutate(doctrineId),
        },
      ],
    );
  }, [reject, doctrineId]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Doctrine Detail' }} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1a56db" />
          <Text style={styles.loadingText}>Loading doctrine...</Text>
        </View>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Stack.Screen options={{ title: 'Doctrine Detail' }} />
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color="#dc2626" />
          <Text style={styles.errorTitle}>Failed to load doctrine</Text>
          <Text style={styles.errorMessage}>
            {error instanceof Error ? error.message : 'An unexpected error occurred.'}
          </Text>
        </View>
      </>
    );
  }

  if (!doctrine) {
    return (
      <>
        <Stack.Screen options={{ title: 'Doctrine Detail' }} />
        <View style={styles.errorContainer}>
          <Ionicons name="document-outline" size={48} color="#d1d5db" />
          <Text style={styles.errorTitle}>Doctrine not found</Text>
        </View>
      </>
    );
  }

  const isPending =
    doctrine.reviewStatus === 'pending' ||
    doctrine.reviewStatus === 'ai_generated' ||
    doctrine.reviewStatus === 'needs_human_review';

  return (
    <>
      <Stack.Screen options={{ title: 'Doctrine Detail' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Status Badges */}
        <View style={styles.badgeRow}>
          <DoctrineTypeBadge type={doctrine.doctrineType} />
          <ReviewStatusBadge status={doctrine.reviewStatus} />
          {doctrine.confidence !== null && (
            <ConfidenceBadge score={doctrine.confidence} />
          )}
        </View>

        {/* Doctrine Text Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DOCTRINE TEXT</Text>
          <View style={styles.card}>
            <Text style={styles.doctrineFullText}>{doctrine.text}</Text>
            {doctrine.normalizedText &&
              doctrine.normalizedText !== doctrine.text && (
                <View style={styles.normalizedContainer}>
                  <Text style={styles.normalizedLabel}>Normalized:</Text>
                  <Text style={styles.normalizedText}>
                    {doctrine.normalizedText}
                  </Text>
                </View>
              )}
          </View>
        </View>

        {/* Metadata Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>METADATA</Text>
          <View style={styles.card}>
            <MetadataRow
              label="Type"
              value={doctrine.doctrineType.replace(/_/g, ' ')}
            />
            <View style={styles.divider} />
            <MetadataRow
              label="Confidence"
              value={
                doctrine.confidence !== null
                  ? `${(doctrine.confidence * 100).toFixed(1)}%`
                  : 'N/A'
              }
            />
            <View style={styles.divider} />
            <MetadataRow label="Status" value={doctrine.reviewStatus.replace(/_/g, ' ')} />
            <View style={styles.divider} />
            <MetadataRow
              label="Created"
              value={new Date(doctrine.createdAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            />
            {doctrine.updatedAt && (
              <>
                <View style={styles.divider} />
                <MetadataRow
                  label="Updated"
                  value={new Date(doctrine.updatedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                />
              </>
            )}
            <View style={styles.divider} />
            <MetadataRow label="ID" value={doctrine.id} />
          </View>
        </View>

        {/* Source Document Section */}
        {doctrine.legalDocument && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SOURCE DOCUMENT</Text>
            <View style={styles.card}>
              <Text style={styles.sourceDocTitle}>
                {doctrine.legalDocument.title}
              </Text>
              {doctrine.legalDocument.grNo && (
                <Text style={styles.sourceDocMeta}>
                  GR No: {doctrine.legalDocument.grNo}
                </Text>
              )}
              {doctrine.legalDocument.citationText && (
                <Text style={styles.sourceDocMeta}>
                  Citation: {doctrine.legalDocument.citationText}
                </Text>
              )}
              {doctrine.legalDocument.court && (
                <Text style={styles.sourceDocMeta}>
                  Court: {doctrine.legalDocument.court}
                </Text>
              )}
              {doctrine.legalDocument.decisionDate && (
                <Text style={styles.sourceDocMeta}>
                  Decision Date:{' '}
                  {new Date(doctrine.legalDocument.decisionDate).toLocaleDateString(
                    'en-US',
                    { year: 'numeric', month: 'long', day: 'numeric' },
                  )}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Source Section */}
        {doctrine.sourceSection && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SOURCE SECTION</Text>
            <View style={styles.card}>
              <MetadataRow
                label="Type"
                value={doctrine.sourceSection.sectionType}
              />
              {doctrine.sourceSection.sectionLabel && (
                <>
                  <View style={styles.divider} />
                  <MetadataRow
                    label="Label"
                    value={doctrine.sourceSection.sectionLabel}
                  />
                </>
              )}
            </View>
          </View>
        )}

        {/* Digest Section */}
        {doctrine.digest && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>RELATED DIGEST</Text>
            <View style={styles.card}>
              <Text style={styles.sourceDocTitle}>{doctrine.digest.title}</Text>
              <Text style={styles.sourceDocMeta}>ID: {doctrine.digest.id}</Text>
            </View>
          </View>
        )}

        {/* Doctrine Links */}
        {((doctrine.linksFrom && doctrine.linksFrom.length > 0) ||
          (doctrine.linksTo && doctrine.linksTo.length > 0)) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>DOCTRINE LINKS</Text>
            <View style={styles.card}>
              {doctrine.linksFrom && doctrine.linksFrom.length > 0 && (
                <View>
                  <Text style={styles.linkGroupTitle}>
                    Outgoing ({doctrine.linksFrom.length})
                  </Text>
                  {doctrine.linksFrom.map((link) => (
                    <View key={link.id} style={styles.linkItem}>
                      <LinkTypeBadge type={link.linkType} />
                      <Text style={styles.linkId} numberOfLines={1}>
                        {link.toDoctrineId.slice(0, 12)}...
                      </Text>
                      {link.confidence !== null && (
                        <Text style={styles.linkConfidence}>
                          {(link.confidence * 100).toFixed(0)}%
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
              {doctrine.linksTo && doctrine.linksTo.length > 0 && (
                <View
                  style={
                    doctrine.linksFrom && doctrine.linksFrom.length > 0
                      ? styles.linkGroupSeparator
                      : undefined
                  }
                >
                  <Text style={styles.linkGroupTitle}>
                    Incoming ({doctrine.linksTo.length})
                  </Text>
                  {doctrine.linksTo.map((link) => (
                    <View key={link.id} style={styles.linkItem}>
                      <LinkTypeBadge type={link.linkType} />
                      <Text style={styles.linkId} numberOfLines={1}>
                        {link.fromDoctrineId.slice(0, 12)}...
                      </Text>
                      {link.confidence !== null && (
                        <Text style={styles.linkConfidence}>
                          {(link.confidence * 100).toFixed(0)}%
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {/* Action Buttons */}
        {isPending && (
          <View style={styles.section}>
            <View style={styles.actionsContainer}>
              <TouchableOpacity
                style={styles.approveButton}
                activeOpacity={0.7}
                onPress={handleApprove}
                disabled={approve.isPending}
              >
                {approve.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                    <Text style={styles.approveButtonText}>Approve Doctrine</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.rejectButton}
                activeOpacity={0.7}
                onPress={handleReject}
                disabled={reject.isPending}
              >
                {reject.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="close-circle" size={20} color="#fff" />
                    <Text style={styles.rejectButtonText}>Reject Doctrine</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Success/Error Messages */}
        {approve.isSuccess && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#047857" />
            <Text style={styles.successText}>Doctrine approved successfully.</Text>
          </View>
        )}
        {reject.isSuccess && (
          <View style={styles.successBanner}>
            <Ionicons name="checkmark-circle" size={16} color="#047857" />
            <Text style={styles.successText}>Doctrine rejected successfully.</Text>
          </View>
        )}
        {(approve.isError || reject.isError) && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color="#b91c1c" />
            <Text style={styles.errorBannerText}>
              {approve.isError
                ? approve.error instanceof Error
                  ? approve.error.message
                  : 'Approve failed'
                : reject.error instanceof Error
                  ? reject.error.message
                  : 'Reject failed'}
            </Text>
          </View>
        )}
      </ScrollView>
    </>
  );
}

// ---- Helper Components ----

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metadataRow}>
      <Text style={styles.metadataLabel}>{label}</Text>
      <Text style={styles.metadataValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

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

function LinkTypeBadge({ type }: { type: string }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    extends: { bg: '#dbeafe', text: '#1d4ed8' },
    overrules: { bg: '#fee2e2', text: '#b91c1c' },
    distinguishes: { bg: '#ede9fe', text: '#7c3aed' },
    applies: { bg: '#d1fae5', text: '#047857' },
    clarifies: { bg: '#ccfbf1', text: '#0f766e' },
  };
  const colors = colorMap[type] ?? { bg: '#f3f4f6', text: '#4b5563' };

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>{type}</Text>
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, paddingBottom: 40 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  loadingText: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 12,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  errorMessage: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
    textAlign: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 16,
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
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  doctrineFullText: {
    fontSize: 15,
    color: '#111827',
    lineHeight: 22,
  },
  normalizedContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  normalizedLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  normalizedText: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  metadataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  metadataLabel: {
    fontSize: 14,
    color: '#6b7280',
    flex: 1,
  },
  metadataValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
    textTransform: 'capitalize',
  },
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  sourceDocTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 6,
  },
  sourceDocMeta: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 3,
  },
  linkGroupTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  linkGroupSeparator: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  linkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  linkId: {
    flex: 1,
    fontSize: 12,
    color: '#6b7280',
    fontFamily: 'monospace',
  },
  linkConfidence: {
    fontSize: 12,
    color: '#9ca3af',
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  approveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingVertical: 14,
  },
  approveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#dc2626',
    borderRadius: 12,
    paddingVertical: 14,
  },
  rejectButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#d1fae5',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  successText: {
    fontSize: 13,
    color: '#047857',
    fontWeight: '500',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
  },
  errorBannerText: {
    fontSize: 13,
    color: '#b91c1c',
    fontWeight: '500',
  },
});
