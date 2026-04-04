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
import { useMemo, useDeleteMemo } from '../../../features/memos/hooks/use-memos';
import { MEMO_TYPE_LABELS } from '../../../features/memos/types';
import type { MemoSection } from '../../../features/memos/types';
import { ExportButton } from '../../../features/exports/components/export-button';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  generating: { bg: '#dbeafe', text: '#1e40af' },
  completed: { bg: '#d1fae5', text: '#065f46' },
  failed: { bg: '#fecaca', text: '#991b1b' },
};

export default function MemoDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: resp, isLoading, error } = useMemo(id ?? '', !!id);
  const deleteMemo = useDeleteMemo();

  // The mobile hook returns MemoDetailResponse, extract .data
  const memo = resp?.data;

  const handleDelete = useCallback(() => {
    if (!id) return;
    Alert.alert('Delete Memo', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteMemo.mutate(id, { onSuccess: () => router.back() }),
      },
    ]);
  }, [id, deleteMemo]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Memo' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (error || !memo) {
    return (
      <>
        <Stack.Screen options={{ title: 'Memo' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#dc2626" />
          <Text style={styles.errorTitle}>Failed to load memo</Text>
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Memo not found'}
          </Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  const typeLabel = MEMO_TYPE_LABELS[memo.memoType] ?? memo.memoType;
  const statusColor = STATUS_COLORS[memo.status] ?? { bg: '#f3f4f6', text: '#6b7280' };

  return (
    <>
      <Stack.Screen
        options={{
          title: typeLabel,
          headerRight: () => (
            <View style={styles.headerActions}>
              {memo.status === 'completed' && id && (
                <ExportButton
                  contentType="memo"
                  contentId={id}
                  title={memo.structuredOutput?.title ?? typeLabel}
                />
              )}
              <TouchableOpacity
                onPress={handleDelete}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="trash-outline" size={22} color="#dc2626" />
              </TouchableOpacity>
            </View>
          ),
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Status + Meta */}
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.badgeText, { color: statusColor.text }]}>
              {memo.status}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#f3f4f6' }]}>
            <Text style={[styles.badgeText, { color: '#374151' }]}>
              {typeLabel}
            </Text>
          </View>
          {memo.confidenceScore != null && (
            <ConfidenceBadge score={memo.confidenceScore} />
          )}
        </View>

        {/* Date + Matter */}
        <Text style={styles.dateText}>
          {new Date(memo.createdAt).toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
        {memo.matter && (
          <TouchableOpacity
            style={styles.matterLink}
            onPress={() => router.push(`/workspace/matters/${memo.matter!.id}`)}
          >
            <Ionicons name="folder-outline" size={14} color="#1a56db" />
            <Text style={styles.matterLinkText}>{memo.matter.title}</Text>
          </TouchableOpacity>
        )}

        {/* Research Question */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Research Question</Text>
          <Text style={styles.queryText}>{memo.query}</Text>
        </View>

        {/* Generating state */}
        {(memo.status === 'pending' || memo.status === 'generating') && (
          <View style={styles.generatingCard}>
            <ActivityIndicator size="small" color="#1a56db" />
            <View style={styles.generatingTextContainer}>
              <Text style={styles.generatingTitle}>
                {memo.status === 'pending'
                  ? 'Memo queued for generation...'
                  : 'Generating your memo...'}
              </Text>
              <Text style={styles.generatingSubtext}>
                This may take up to 30 seconds. Pull to refresh.
              </Text>
            </View>
          </View>
        )}

        {/* Failed state */}
        {memo.status === 'failed' && (
          <View style={styles.failedCard}>
            <Ionicons name="warning-outline" size={20} color="#991b1b" />
            <Text style={styles.failedText}>
              Generation failed. Try again with a different query.
            </Text>
          </View>
        )}

        {/* Completed - Structured Output */}
        {memo.status === 'completed' && memo.structuredOutput && (
          <>
            {/* Title */}
            {memo.structuredOutput.title && (
              <Text style={styles.memoTitle}>{memo.structuredOutput.title}</Text>
            )}

            {/* Summary */}
            {memo.structuredOutput.summary && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Summary</Text>
                <Text style={styles.sectionContent}>
                  {memo.structuredOutput.summary}
                </Text>
              </View>
            )}

            {/* Sections */}
            {memo.structuredOutput.sections.map((section, index) => (
              <SectionCard key={index} section={section} index={index} />
            ))}

            {/* Conclusion */}
            {memo.structuredOutput.conclusion && (
              <View style={[styles.section, styles.conclusionSection]}>
                <Text style={styles.sectionLabel}>Conclusion</Text>
                <Text style={styles.sectionContent}>
                  {memo.structuredOutput.conclusion}
                </Text>
              </View>
            )}

            {/* Citations */}
            {memo.citationsJson && memo.citationsJson.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  Sources ({memo.citationsJson.length})
                </Text>
                {memo.citationsJson.map((citation, i) => (
                  <View key={i} style={styles.citationRow}>
                    <Text style={styles.citationIndex}>[{i + 1}]</Text>
                    <Text style={styles.citationText} numberOfLines={2}>
                      {citation.text}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

function SectionCard({
  section,
  index,
}: {
  section: MemoSection;
  index: number;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>
        {index + 1}. {section.heading}
      </Text>
      <Text style={styles.sectionContent}>{section.content}</Text>
      {section.citations && section.citations.length > 0 && (
        <View style={styles.sectionCitations}>
          <Text style={styles.sectionCitationsLabel}>
            {section.citations.length} citation
            {section.citations.length !== 1 ? 's' : ''}
          </Text>
        </View>
      )}
    </View>
  );
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  let bg = '#d1fae5';
  let color = '#065f46';
  if (pct < 50) {
    bg = '#fecaca';
    color = '#991b1b';
  } else if (pct < 70) {
    bg = '#fef3c7';
    color = '#92400e';
  }

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color }]}>{pct}%</Text>
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
  errorTitle: { fontSize: 18, fontWeight: '600', color: '#374151', marginTop: 12 },
  errorText: { fontSize: 14, color: '#9ca3af', marginTop: 6, textAlign: 'center' },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
  },
  backButtonText: { fontSize: 14, fontWeight: '500', color: '#374151' },

  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
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
  conclusionSection: { backgroundColor: '#f9fafb', borderWidth: 1, borderColor: '#e5e7eb' },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#9ca3af',
    marginBottom: 6,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  sectionContent: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 21,
  },
  sectionCitations: {
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  sectionCitationsLabel: { fontSize: 11, color: '#6b7280' },

  queryText: { fontSize: 14, color: '#111827', lineHeight: 21 },

  memoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 24,
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

  citationRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  citationIndex: { fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' },
  citationText: { fontSize: 12, color: '#6b7280', flex: 1 },
});
