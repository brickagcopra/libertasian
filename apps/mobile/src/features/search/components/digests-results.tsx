import { View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useSearchDigests } from '../hooks/use-search-digests';
import type { SearchDigestItem } from '../types';

interface DigestsResultsProps {
  query: string | null;
}

function ReviewStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'approved':
      return (
        <View style={[styles.statusBadge, styles.statusApproved]}>
          <Text style={styles.statusApprovedText}>Approved</Text>
        </View>
      );
    case 'needs_human_review':
      return (
        <View style={[styles.statusBadge, styles.statusReview]}>
          <Text style={styles.statusReviewText}>Needs Review</Text>
        </View>
      );
    case 'draft':
      return (
        <View style={[styles.statusBadge, styles.statusDraft]}>
          <Text style={styles.statusDraftText}>Draft</Text>
        </View>
      );
    case 'rejected':
      return (
        <View style={[styles.statusBadge, styles.statusRejected]}>
          <Text style={styles.statusRejectedText}>Rejected</Text>
        </View>
      );
    default:
      return (
        <View style={styles.statusBadge}>
          <Text style={styles.statusDefaultText}>{status.replace(/_/g, ' ')}</Text>
        </View>
      );
  }
}

function ConfidenceIndicator({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    score >= 0.8 ? '#15803d' : score >= 0.5 ? '#a16207' : '#dc2626';

  return <Text style={[styles.confidence, { color }]}>{pct}% confidence</Text>;
}

function DigestCard({ digest }: { digest: SearchDigestItem }) {
  const displayType = digest.digestType?.replace(/_/g, ' ') ?? 'Digest';

  return (
    <TouchableOpacity
      style={styles.digestCard}
      onPress={() => router.push(`/digest/${digest.id}`)}
      activeOpacity={0.7}
    >
      <Text style={styles.digestTitle} numberOfLines={2}>
        {digest.title}
      </Text>
      <View style={styles.badgesRow}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{displayType}</Text>
        </View>
        <ReviewStatusBadge status={digest.reviewStatus} />
        {digest.confidenceScore != null ? (
          <ConfidenceIndicator score={digest.confidenceScore} />
        ) : null}
      </View>
      {digest.summary ? (
        <Text style={styles.summary} numberOfLines={2}>
          {digest.summary}
        </Text>
      ) : null}
      {digest.legalDocument ? (
        <View style={styles.sourceRow}>
          <Text style={styles.sourceLabel}>Source: </Text>
          <Text style={styles.sourceTitle} numberOfLines={1}>
            {digest.legalDocument.shortTitle ?? digest.legalDocument.title}
          </Text>
        </View>
      ) : null}
      {digest.legalDocument?.court || digest.legalDocument?.grNo ? (
        <View style={styles.metaRow}>
          {digest.legalDocument.court ? (
            <Text style={styles.metaText}>
              {digest.legalDocument.court.replace(/_/g, ' ')}
            </Text>
          ) : null}
          {digest.legalDocument.grNo ? (
            <Text style={styles.metaText}>{digest.legalDocument.grNo}</Text>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export function DigestsResults({ query }: DigestsResultsProps) {
  const { data, isLoading, error } = useSearchDigests(query ?? '', !!query);

  if (!query) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>
          Enter a search query to find case digests.
        </Text>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color="#1a56db" />
        <Text style={styles.loadingText}>Loading digests...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="alert-circle" size={20} color="#dc2626" />
        <Text style={styles.errorText}>
          Failed to load digests: {error instanceof Error ? error.message : 'Unknown error'}
        </Text>
      </View>
    );
  }

  const digests = data?.data ?? [];

  if (digests.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No case digests match your search.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={digests}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <DigestCard digest={item} />}
      contentContainerStyle={styles.listContent}
      ListHeaderComponent={
        <Text style={styles.countText}>
          {digests.length} digest{digests.length !== 1 ? 's' : ''} found
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
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
  listContent: { padding: 12, gap: 10, paddingBottom: 32 },
  countText: { fontSize: 13, color: '#6b7280', fontWeight: '500', marginBottom: 4 },
  digestCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  digestTitle: { fontSize: 15, fontWeight: '600', color: '#111827', lineHeight: 21, marginBottom: 8 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 6 },
  typeBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  typeBadgeText: { fontSize: 11, fontWeight: '600', color: '#1d4ed8', textTransform: 'capitalize' },
  statusBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  statusApproved: { backgroundColor: '#ecfdf5', borderColor: '#bbf7d0' },
  statusApprovedText: { fontSize: 11, fontWeight: '600', color: '#15803d' },
  statusReview: { backgroundColor: '#fefce8', borderColor: '#fde68a' },
  statusReviewText: { fontSize: 11, fontWeight: '600', color: '#a16207' },
  statusDraft: { backgroundColor: '#f9fafb', borderColor: '#d1d5db' },
  statusDraftText: { fontSize: 11, fontWeight: '600', color: '#6b7280' },
  statusRejected: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  statusRejectedText: { fontSize: 11, fontWeight: '600', color: '#dc2626' },
  statusDefaultText: { fontSize: 11, fontWeight: '600', color: '#6b7280', textTransform: 'capitalize' },
  confidence: { fontSize: 11, fontWeight: '600' },
  summary: { fontSize: 13, color: '#4b5563', lineHeight: 19, marginBottom: 6 },
  sourceRow: { flexDirection: 'row', marginBottom: 4 },
  sourceLabel: { fontSize: 12, color: '#6b7280' },
  sourceTitle: { flex: 1, fontSize: 12, color: '#1a56db' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaText: { fontSize: 11, color: '#6b7280' },
});
