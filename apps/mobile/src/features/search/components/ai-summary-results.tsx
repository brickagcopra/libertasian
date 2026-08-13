import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { SourceCard } from '../../ai-answers/components/source-card';
import { dedupeSources, formatAnswerText } from '../../ai-answers/format-answer-text';
import { useAiAnswerStream } from '../hooks/use-ai-answer-stream';
import type { AiAnswerSource } from '../types';
import { abstentionCopy } from './abstention-copy';

interface AiSummaryResultsProps {
  query: string | null;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  if (confidence >= 0.8) {
    return (
      <View style={[styles.badge, styles.badgeGreen]}>
        <Text style={styles.badgeGreenText}>High confidence ({pct}%)</Text>
      </View>
    );
  }
  if (confidence >= 0.5) {
    return (
      <View style={[styles.badge, styles.badgeYellow]}>
        <Text style={styles.badgeYellowText}>Moderate confidence ({pct}%)</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, styles.badgeRed]}>
      <Text style={styles.badgeRedText}>Low confidence ({pct}%)</Text>
    </View>
  );
}

export function AiSummaryResults({ query }: AiSummaryResultsProps) {
  const {
    text,
    sources,
    isStreaming,
    isDone,
    error,
    confidence,
    abstained,
    abstentionReason,
  } = useAiAnswerStream(query, !!query);

  // Deduped once and shared: `formatAnswerText` numbers `[n]` against this
  // exact list, so the inline markers and the panel rows cannot drift apart.
  const citedSources = dedupeSources(sources);
  const answerText = formatAnswerText(text, sources);

  if (!query) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>
          Enter a search query to get an AI-generated answer.
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={20} color="#dc2626" />
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (isStreaming && !text) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color="#1a56db" />
        <Text style={styles.loadingText}>Generating AI answer...</Text>
      </View>
    );
  }

  if (isDone && abstained) {
    return (
      <View style={styles.abstentionContainer}>
        <Ionicons name="shield-outline" size={20} color="#d97706" />
        <Text style={styles.abstentionText}>{abstentionCopy(abstentionReason)}</Text>
      </View>
    );
  }

  if (!text && !isStreaming) {
    return null;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Answer */}
      <View style={styles.answerCard}>
        <Text style={styles.answerText}>{answerText}</Text>
        {isStreaming ? (
          <View style={styles.cursor} />
        ) : null}
        {isDone && confidence !== null ? (
          <View style={styles.confidenceRow}>
            <ConfidenceBadge confidence={confidence} />
          </View>
        ) : null}
      </View>

      {/* Sources */}
      {citedSources.length > 0 ? (
        <View style={styles.sourcesSection}>
          <View style={styles.sourcesSectionHeader}>
            <Ionicons name="document-text-outline" size={16} color="#374151" />
            <Text style={styles.sourcesSectionTitle}>
              Sources ({citedSources.length})
            </Text>
          </View>
          {citedSources.map((source, i) => (
            <SourceCard
              key={`${source.document_id}:${source.section_id ?? i}`}
              source={source}
              index={i}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentContainer: { padding: 12, gap: 12, paddingBottom: 32 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyText: { fontSize: 14, color: '#9ca3af', textAlign: 'center' },
  loadingText: { fontSize: 14, color: '#6b7280' },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    padding: 12,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: { flex: 1, fontSize: 14, color: '#dc2626' },
  abstentionContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    margin: 12,
    padding: 12,
    backgroundColor: '#fffbeb',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  abstentionText: { flex: 1, fontSize: 14, color: '#92400e', lineHeight: 20 },
  answerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  answerText: { fontSize: 15, color: '#111827', lineHeight: 22 },
  cursor: {
    width: 2,
    height: 16,
    backgroundColor: '#111827',
    marginTop: 4,
    opacity: 0.7,
  },
  confidenceRow: { marginTop: 12 },
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeGreen: { backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#bbf7d0' },
  badgeGreenText: { fontSize: 12, fontWeight: '600', color: '#15803d' },
  badgeYellow: { backgroundColor: '#fefce8', borderWidth: 1, borderColor: '#fde68a' },
  badgeYellowText: { fontSize: 12, fontWeight: '600', color: '#a16207' },
  badgeRed: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  badgeRedText: { fontSize: 12, fontWeight: '600', color: '#dc2626' },
  sourcesSection: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sourcesSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sourcesSectionTitle: { fontSize: 14, fontWeight: '600', color: '#374151' },
});
