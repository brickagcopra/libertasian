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
  useComparison,
  useDeleteComparison,
} from '../../../features/case-comparisons/hooks/use-case-comparisons';
import { COMPARISON_TYPE_LABELS } from '../../../features/case-comparisons/types';
import type {
  ComparisonDimension,
  ComparisonDocumentSummary,
} from '../../../features/case-comparisons/types';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  generating: { bg: '#dbeafe', text: '#1e40af' },
  completed: { bg: '#d1fae5', text: '#065f46' },
  failed: { bg: '#fecaca', text: '#991b1b' },
};

export default function ComparisonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: resp, isLoading, error } = useComparison(id ?? '', !!id);
  const deleteComparison = useDeleteComparison();

  // Bare { success, data } envelope — already unwrapped by `apiClient`.
  const comparison = resp;

  const handleDelete = useCallback(() => {
    if (!id) return;
    Alert.alert(
      'Delete Comparison',
      'Are you sure? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deleteComparison.mutate(id, { onSuccess: () => router.back() }),
        },
      ],
    );
  }, [id, deleteComparison]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Comparison' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (error || !comparison) {
    return (
      <>
        <Stack.Screen options={{ title: 'Comparison' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#dc2626" />
          <Text style={styles.errorTitle}>Failed to load comparison</Text>
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Comparison not found'}
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

  const typeLabel =
    COMPARISON_TYPE_LABELS[comparison.comparisonType] ??
    comparison.comparisonType;
  const statusColor = STATUS_COLORS[comparison.status] ?? {
    bg: '#f3f4f6',
    text: '#6b7280',
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: typeLabel,
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
              {comparison.status}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#f3f4f6' }]}>
            <Text style={[styles.badgeText, { color: '#374151' }]}>
              {typeLabel}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#e0e7ff' }]}>
            <Text style={[styles.badgeText, { color: '#3730a3' }]}>
              {comparison.documentIds.length} docs
            </Text>
          </View>
        </View>

        {/* Date + Matter */}
        <Text style={styles.dateText}>
          {new Date(comparison.createdAt).toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
        {comparison.matter && (
          <TouchableOpacity
            style={styles.matterLink}
            onPress={() =>
              router.push(`/workspace/matters/${comparison.matter!.id}`)
            }
          >
            <Ionicons name="folder-outline" size={14} color="#1a56db" />
            <Text style={styles.matterLinkText}>
              {comparison.matter.title}
            </Text>
          </TouchableOpacity>
        )}

        {/* Generating state */}
        {(comparison.status === 'pending' ||
          comparison.status === 'generating') && (
          <View style={styles.generatingCard}>
            <ActivityIndicator size="small" color="#1a56db" />
            <View style={styles.generatingTextContainer}>
              <Text style={styles.generatingTitle}>
                {comparison.status === 'pending'
                  ? 'Comparison queued...'
                  : 'Comparing cases...'}
              </Text>
              <Text style={styles.generatingSubtext}>
                This may take up to 60 seconds. The page will update
                automatically.
              </Text>
            </View>
          </View>
        )}

        {/* Failed state */}
        {comparison.status === 'failed' && (
          <View style={styles.failedCard}>
            <Ionicons name="warning-outline" size={20} color="#991b1b" />
            <Text style={styles.failedText}>
              Comparison failed. Try again with different documents.
            </Text>
          </View>
        )}

        {/* Completed - Results */}
        {comparison.status === 'completed' && comparison.resultJson && (
          <>
            {/* Document Summaries */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Documents Compared</Text>
              {comparison.resultJson.documents.map((doc) => (
                <DocumentSummaryCard key={doc.documentId} doc={doc} />
              ))}
            </View>

            {/* Dimensions */}
            {comparison.resultJson.dimensions.map((dim, index) => (
              <DimensionCard key={index} dimension={dim} index={index} />
            ))}

            {/* Overall Analysis */}
            {comparison.resultJson.overallAnalysis && (
              <View style={[styles.section, styles.analysisSection]}>
                <Text style={styles.sectionLabel}>Overall Analysis</Text>
                <Text style={styles.sectionContent}>
                  {comparison.resultJson.overallAnalysis}
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

function DocumentSummaryCard({ doc }: { doc: ComparisonDocumentSummary }) {
  return (
    <View style={styles.docCard}>
      <Text style={styles.docTitle} numberOfLines={2}>
        {doc.title}
      </Text>
      {doc.citationText && (
        <Text style={styles.docCitation}>{doc.citationText}</Text>
      )}
      <View style={styles.docMeta}>
        {doc.court && <Text style={styles.docMetaText}>{doc.court}</Text>}
        {doc.decisionDate && (
          <Text style={styles.docMetaText}>
            {new Date(doc.decisionDate).toLocaleDateString('en-PH', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        )}
      </View>
    </View>
  );
}

function DimensionCard({
  dimension,
  index,
}: {
  dimension: ComparisonDimension;
  index: number;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.dimensionHeading}>
        {index + 1}. {dimension.dimension}
      </Text>

      {dimension.entries.map((entry, i) => (
        <View key={i} style={styles.entryCard}>
          <Text style={styles.entryDocId} numberOfLines={1}>
            Document {i + 1}
          </Text>
          <Text style={styles.entryContent}>{entry.content}</Text>
          {entry.citations.length > 0 && (
            <View style={styles.entryCitations}>
              {entry.citations.map((c, ci) => (
                <View key={ci} style={styles.citationBadge}>
                  <Text style={styles.citationBadgeText} numberOfLines={1}>
                    {c.text}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}

      {dimension.analysis && (
        <View style={styles.dimensionAnalysis}>
          <Text style={styles.dimensionAnalysisLabel}>Analysis</Text>
          <Text style={styles.dimensionAnalysisText}>
            {dimension.analysis}
          </Text>
        </View>
      )}
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

  dateText: { fontSize: 12, color: '#9ca3af' },
  matterLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  matterLinkText: { fontSize: 13, color: '#1a56db', fontWeight: '500' },

  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
  },
  analysisSection: {
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

  docCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  docTitle: { fontSize: 13, fontWeight: '600', color: '#111827' },
  docCitation: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  docMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  docMetaText: { fontSize: 11, color: '#9ca3af' },

  dimensionHeading: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 10,
  },
  entryCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#1a56db',
  },
  entryDocId: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  entryContent: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
  },
  entryCitations: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 6,
  },
  citationBadge: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  citationBadgeText: { fontSize: 10, color: '#3730a3' },

  dimensionAnalysis: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  dimensionAnalysisLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  dimensionAnalysisText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
    fontStyle: 'italic',
  },
});
