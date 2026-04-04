import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDigest } from '../../features/digests/hooks/use-digests';
import { ExportButton } from '../../features/exports/components/export-button';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  draft: { bg: '#f3f4f6', text: '#6b7280' },
  ai_generated: { bg: '#eff6ff', text: '#1d4ed8' },
  needs_human_review: { bg: '#fef3c7', text: '#92400e' },
  approved: { bg: '#ecfdf5', text: '#059669' },
  rejected: { bg: '#fef2f2', text: '#dc2626' },
};

function getConfidenceColor(score: number | null): string {
  if (score === null) return '#9ca3af';
  if (score >= 0.7) return '#059669';
  if (score >= 0.4) return '#d97706';
  return '#dc2626';
}

function DigestSection({ label, content }: { label: string; content: string | null }) {
  if (!content) return null;
  return (
    <View style={styles.digestSection}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.sectionContent}>{content}</Text>
    </View>
  );
}

export default function DigestDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const digestId = id ?? '';
  const { data: digest, isLoading, error } = useDigest(digestId);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (error || !digest) {
    return (
      <>
        <Stack.Screen options={{ title: 'Error' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
          <Text style={styles.errorTitle}>Digest not found</Text>
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

  const statusStyle =
    STATUS_COLORS[digest.reviewStatus] ?? STATUS_COLORS['draft'];

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Digest Detail',
          headerBackTitle: 'Back',
          headerRight: () => (
            <ExportButton
              contentType="digest"
              contentId={digestId}
              title={digest.title}
            />
          ),
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.badges}>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>
                {digest.digestType.replace(/_/g, ' ')}
              </Text>
            </View>
            <View
              style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}
            >
              <Text
                style={[styles.statusBadgeText, { color: statusStyle.text }]}
              >
                {digest.reviewStatus.replace(/_/g, ' ')}
              </Text>
            </View>
            <View style={styles.visibilityBadge}>
              <Ionicons
                name={
                  digest.visibility === 'private'
                    ? 'lock-closed-outline'
                    : 'globe-outline'
                }
                size={12}
                color="#6b7280"
              />
              <Text style={styles.visibilityText}>{digest.visibility}</Text>
            </View>
          </View>

          <Text style={styles.title}>{digest.title}</Text>

          <View style={styles.metaRow}>
            {digest.confidenceScore !== null ? (
              <View style={styles.confidenceContainer}>
                <Text style={styles.metaLabel}>Confidence</Text>
                <Text
                  style={[
                    styles.confidenceValue,
                    { color: getConfidenceColor(digest.confidenceScore) },
                  ]}
                >
                  {Math.round(digest.confidenceScore * 100)}%
                </Text>
              </View>
            ) : null}
            <View>
              <Text style={styles.metaLabel}>Source</Text>
              <Text style={styles.metaValue}>
                {digest.sourceOrigin.replace(/_/g, ' ')}
              </Text>
            </View>
            <View>
              <Text style={styles.metaLabel}>Created</Text>
              <Text style={styles.metaValue}>
                {new Date(digest.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </Text>
            </View>
          </View>

          {digest.legalDocumentId ? (
            <TouchableOpacity
              style={styles.sourceLink}
              onPress={() =>
                router.push(`/reader/${digest.legalDocumentId}`)
              }
            >
              <Ionicons name="document-outline" size={16} color="#1a56db" />
              <Text style={styles.sourceLinkText}>View Source Document</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.sectionsContainer}>
          <DigestSection label="Facts" content={digest.facts} />
          <DigestSection label="Issues" content={digest.issues} />
          <DigestSection label="Ruling" content={digest.ruling} />
          <DigestSection label="Doctrine" content={digest.doctrine} />
          <DigestSection label="Dispositive Portion" content={digest.dispositive} />
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 40 },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  errorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  backButton: {
    marginTop: 16,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  backButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  header: {
    backgroundColor: '#fff',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  badges: { flexDirection: 'row', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  typeBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1d4ed8',
    textTransform: 'capitalize',
  },
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  visibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f3f4f6',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  visibilityText: {
    fontSize: 12,
    color: '#6b7280',
    textTransform: 'capitalize',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 26,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 12,
  },
  metaLabel: {
    fontSize: 11,
    color: '#9ca3af',
    fontWeight: '500',
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  confidenceContainer: {},
  confidenceValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  sourceLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  sourceLinkText: { fontSize: 13, color: '#1a56db', fontWeight: '600' },
  sectionsContainer: { padding: 16, gap: 12 },
  digestSection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a56db',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  sectionContent: {
    fontSize: 14,
    color: '#374151',
    lineHeight: 22,
  },
});
