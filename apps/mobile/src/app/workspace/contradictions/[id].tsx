import { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useContradiction,
  useDeleteContradiction,
} from '../../../features/contradictions/hooks/use-contradictions';
import {
  CONTRADICTION_STATUS_LABELS,
  SCOPE_LABELS,
  SEVERITY_LABELS,
} from '../../../features/contradictions/types';
import type { ContradictionItem } from '../../../features/contradictions/types';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  generating: { bg: '#dbeafe', text: '#1e40af' },
  completed: { bg: '#d1fae5', text: '#065f46' },
  failed: { bg: '#fecaca', text: '#991b1b' },
};

const SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  low: { bg: '#d1fae5', text: '#065f46' },
  medium: { bg: '#fef3c7', text: '#92400e' },
  high: { bg: '#fed7aa', text: '#c2410c' },
  critical: { bg: '#fecaca', text: '#991b1b' },
};

export default function ContradictionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: resp, isLoading, error } = useContradiction(id ?? '', !!id);
  const deleteContradiction = useDeleteContradiction();

  const report = resp?.data;

  const handleDelete = useCallback(() => {
    if (!id) return;
    Alert.alert(
      'Delete Report',
      'Are you sure? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteContradiction.mutate(id, {
              onSuccess: () => router.back(),
            }),
        },
      ],
    );
  }, [id, deleteContradiction]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Contradiction Report' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (error || !report) {
    return (
      <>
        <Stack.Screen options={{ title: 'Contradiction Report' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#dc2626" />
          <Text style={styles.errorTitle}>Failed to load report</Text>
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Report not found'}
          </Text>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const statusColor = STATUS_COLORS[report.status] ?? {
    bg: '#f3f4f6',
    text: '#6b7280',
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Contradiction Report',
          headerRight: () => (
            <TouchableOpacity
              onPress={handleDelete}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={22} color="#dc2626" />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Status + Meta */}
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.badgeText, { color: statusColor.text }]}>
              {CONTRADICTION_STATUS_LABELS[report.status] ?? report.status}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#f3f4f6' }]}>
            <Text style={[styles.badgeText, { color: '#374151' }]}>
              {SCOPE_LABELS[report.scope] ?? report.scope}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#e0e7ff' }]}>
            <Text style={[styles.badgeText, { color: '#3730a3' }]}>
              {report.documentIds.length} docs
            </Text>
          </View>
        </View>

        {report.topic && (
          <Text style={styles.topicTitle}>{report.topic}</Text>
        )}

        <Text style={styles.dateText}>
          {new Date(report.createdAt).toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </Text>

        {/* Generating state */}
        {(report.status === 'pending' || report.status === 'generating') && (
          <View style={styles.generatingCard}>
            <ActivityIndicator size="small" color="#1a56db" />
            <View style={styles.generatingTextContainer}>
              <Text style={styles.generatingTitle}>
                {report.status === 'pending'
                  ? 'Analysis queued...'
                  : 'Analyzing contradictions...'}
              </Text>
              <Text style={styles.generatingSubtext}>
                This may take up to 90 seconds. The page will update
                automatically.
              </Text>
            </View>
          </View>
        )}

        {/* Failed state */}
        {report.status === 'failed' && (
          <View style={styles.failedCard}>
            <Ionicons name="warning-outline" size={20} color="#991b1b" />
            <Text style={styles.failedText}>
              Analysis failed. Try again with different documents or topic.
            </Text>
          </View>
        )}

        {/* Completed — Results */}
        {report.status === 'completed' && report.resultJson && (
          <>
            {/* Summary */}
            <View style={[styles.section, styles.summarySection]}>
              <Text style={styles.sectionLabel}>Summary</Text>
              <Text style={styles.sectionContent}>
                {report.resultJson.summary}
              </Text>
              <Text style={styles.statsText}>
                {report.resultJson.contradictions.length} contradiction(s)
                found across {report.resultJson.documentsAnalyzed} documents
              </Text>
            </View>

            {/* Contradictions */}
            {report.resultJson.contradictions.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  Contradictions (
                  {report.resultJson.contradictions.length})
                </Text>
                {report.resultJson.contradictions.map((item, index) => (
                  <ContradictionItemCard
                    key={index}
                    item={item}
                    index={index}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.noContradictionsCard}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={24}
                  color="#059669"
                />
                <Text style={styles.noContradictionsText}>
                  No contradictions detected among the analyzed documents.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

function ContradictionItemCard({
  item,
  index,
}: {
  item: ContradictionItem;
  index: number;
}) {
  const severityColor = SEVERITY_COLORS[item.severity] ?? {
    bg: '#f3f4f6',
    text: '#6b7280',
  };

  return (
    <View style={styles.contradictionCard}>
      <View style={styles.contradictionHeader}>
        <Text style={styles.contradictionNumber}>#{index + 1}</Text>
        <View
          style={[
            styles.severityBadge,
            { backgroundColor: severityColor.bg },
          ]}
        >
          <Text
            style={[styles.severityText, { color: severityColor.text }]}
          >
            {SEVERITY_LABELS[item.severity] ?? item.severity}
          </Text>
        </View>
        {item.doctrineArea && (
          <View style={[styles.areaBadge]}>
            <Text style={styles.areaText}>{item.doctrineArea}</Text>
          </View>
        )}
      </View>

      <Text style={styles.contradictionDesc}>{item.description}</Text>

      {/* Document A */}
      <View style={styles.passageCard}>
        <Text style={styles.passageDocTitle} numberOfLines={1}>
          {item.documentATitle}
        </Text>
        <Text style={styles.passageText}>{item.documentAPassage}</Text>
      </View>

      {/* VS separator */}
      <View style={styles.vsSeparator}>
        <View style={styles.vsLine} />
        <Text style={styles.vsText}>VS</Text>
        <View style={styles.vsLine} />
      </View>

      {/* Document B */}
      <View style={[styles.passageCard, styles.passageCardB]}>
        <Text style={styles.passageDocTitle} numberOfLines={1}>
          {item.documentBTitle}
        </Text>
        <Text style={styles.passageText}>{item.documentBPassage}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, gap: 12 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 6,
    textAlign: 'center',
  },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
  },
  backButtonText: { fontSize: 14, fontWeight: '500', color: '#374151' },

  metaRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },

  topicTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  dateText: { fontSize: 12, color: '#9ca3af' },

  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
  },
  summarySection: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#9ca3af',
    marginBottom: 8,
  },
  sectionContent: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 21,
  },
  statsText: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 8,
    fontWeight: '500',
  },

  generatingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  generatingTextContainer: { flex: 1 },
  generatingTitle: { fontSize: 14, fontWeight: '600', color: '#1e40af' },
  generatingSubtext: { fontSize: 12, color: '#3b82f6', marginTop: 2 },

  failedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  failedText: { fontSize: 13, color: '#991b1b', flex: 1 },

  noContradictionsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#ecfdf5',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  noContradictionsText: { fontSize: 13, color: '#065f46', flex: 1 },

  contradictionCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  contradictionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  contradictionNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
  },
  severityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  areaBadge: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  areaText: { fontSize: 10, fontWeight: '500', color: '#3730a3' },
  contradictionDesc: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
    marginBottom: 8,
  },

  passageCard: {
    backgroundColor: '#fff',
    borderRadius: 6,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#1a56db',
  },
  passageCardB: {
    borderLeftColor: '#dc2626',
  },
  passageDocTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  passageText: {
    fontSize: 12,
    color: '#374151',
    lineHeight: 17,
    fontStyle: 'italic',
  },

  vsSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 6,
  },
  vsLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#d1d5db',
  },
  vsText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9ca3af',
  },
});
