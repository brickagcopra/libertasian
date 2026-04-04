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
  useHearingPrep,
  useDeleteHearingPrep,
} from '../../../features/hearing-prep/hooks/use-hearing-prep';
import {
  HEARING_PREP_STATUS_LABELS,
  ARGUMENT_STRENGTH_LABELS,
} from '../../../features/hearing-prep/types';
import type {
  HearingPrepCase,
  HearingPrepProvision,
  HearingPrepArgument,
} from '../../../features/hearing-prep/types';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  generating: { bg: '#dbeafe', text: '#1e40af' },
  completed: { bg: '#d1fae5', text: '#065f46' },
  failed: { bg: '#fecaca', text: '#991b1b' },
};

const STRENGTH_COLORS: Record<string, { bg: string; text: string }> = {
  strong: { bg: '#d1fae5', text: '#065f46' },
  moderate: { bg: '#fef3c7', text: '#92400e' },
  weak: { bg: '#fecaca', text: '#991b1b' },
};

export default function HearingPrepDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: resp, isLoading, error } = useHearingPrep(id ?? '', !!id);
  const deletePrep = useDeleteHearingPrep();

  const prep = resp?.data;

  const handleDelete = useCallback(() => {
    if (!id) return;
    Alert.alert(
      'Delete Hearing Prep',
      'Are you sure? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deletePrep.mutate(id, { onSuccess: () => router.back() }),
        },
      ],
    );
  }, [id, deletePrep]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Hearing Prep' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (error || !prep) {
    return (
      <>
        <Stack.Screen options={{ title: 'Hearing Prep' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#dc2626" />
          <Text style={styles.errorTitle}>Failed to load hearing prep</Text>
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Not found'}
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

  const statusColor = STATUS_COLORS[prep.status] ?? {
    bg: '#f3f4f6',
    text: '#6b7280',
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Hearing Prep',
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
              {HEARING_PREP_STATUS_LABELS[prep.status] ?? prep.status}
            </Text>
          </View>
        </View>

        <Text style={styles.topicTitle}>{prep.topic}</Text>
        {prep.issue && <Text style={styles.issueText}>{prep.issue}</Text>}

        <Text style={styles.dateText}>
          {new Date(prep.createdAt).toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
        {prep.matter && (
          <TouchableOpacity
            style={styles.matterLink}
            onPress={() =>
              router.push(`/workspace/matters/${prep.matter!.id}`)
            }
          >
            <Ionicons name="folder-outline" size={14} color="#1a56db" />
            <Text style={styles.matterLinkText}>{prep.matter.title}</Text>
          </TouchableOpacity>
        )}

        {/* Generating state */}
        {(prep.status === 'pending' || prep.status === 'generating') && (
          <View style={styles.generatingCard}>
            <ActivityIndicator size="small" color="#1a56db" />
            <View style={styles.generatingTextContainer}>
              <Text style={styles.generatingTitle}>
                {prep.status === 'pending'
                  ? 'Preparation queued...'
                  : 'Preparing hearing pack...'}
              </Text>
              <Text style={styles.generatingSubtext}>
                This may take up to 90 seconds. The page will update
                automatically.
              </Text>
            </View>
          </View>
        )}

        {/* Failed state */}
        {prep.status === 'failed' && (
          <View style={styles.failedCard}>
            <Ionicons name="warning-outline" size={20} color="#991b1b" />
            <Text style={styles.failedText}>
              Preparation failed. Try again with a different topic or documents.
            </Text>
          </View>
        )}

        {/* Completed — Results */}
        {prep.status === 'completed' && prep.packJson && (
          <>
            {/* Relevant Cases */}
            {prep.packJson.cases.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  Relevant Cases ({prep.packJson.cases.length})
                </Text>
                {prep.packJson.cases.map((c, i) => (
                  <CaseCard key={i} caseItem={c} />
                ))}
              </View>
            )}

            {/* Provisions */}
            {prep.packJson.provisions.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  Relevant Provisions ({prep.packJson.provisions.length})
                </Text>
                {prep.packJson.provisions.map((p, i) => (
                  <ProvisionCard key={i} provision={p} />
                ))}
              </View>
            )}

            {/* Arguments */}
            {prep.packJson.arguments.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  Key Arguments ({prep.packJson.arguments.length})
                </Text>
                {prep.packJson.arguments.map((a, i) => (
                  <ArgumentCard key={i} argument={a} index={i} />
                ))}
              </View>
            )}

            {/* Counter-Arguments */}
            {prep.packJson.counterArguments.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  Counter-Arguments ({prep.packJson.counterArguments.length})
                </Text>
                {prep.packJson.counterArguments.map((a, i) => (
                  <ArgumentCard
                    key={i}
                    argument={a}
                    index={i}
                    isCounter
                  />
                ))}
              </View>
            )}

            {/* Suggested Questions */}
            {prep.packJson.suggestedQuestions.length > 0 && (
              <View style={[styles.section, styles.questionsSection]}>
                <Text style={styles.sectionLabel}>Suggested Questions</Text>
                {prep.packJson.suggestedQuestions.map((q, i) => (
                  <View key={i} style={styles.questionItem}>
                    <Text style={styles.questionNumber}>{i + 1}.</Text>
                    <Text style={styles.questionText}>{q}</Text>
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

function CaseCard({ caseItem }: { caseItem: HearingPrepCase }) {
  return (
    <View style={styles.itemCard}>
      <Text style={styles.itemTitle} numberOfLines={2}>
        {caseItem.title}
      </Text>
      {caseItem.citationText && (
        <Text style={styles.itemCitation}>{caseItem.citationText}</Text>
      )}
      <Text style={styles.itemRelevance}>{caseItem.relevance}</Text>
      {caseItem.keyHoldings.length > 0 && (
        <View style={styles.holdingsContainer}>
          {caseItem.keyHoldings.map((h, i) => (
            <Text key={i} style={styles.holdingText}>
              {'\u2022'} {h}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function ProvisionCard({ provision }: { provision: HearingPrepProvision }) {
  return (
    <View style={styles.itemCard}>
      <Text style={styles.itemTitle} numberOfLines={2}>
        {provision.title}
      </Text>
      {provision.sectionLabel && (
        <Text style={styles.itemCitation}>{provision.sectionLabel}</Text>
      )}
      <Text style={styles.provisionText} numberOfLines={4}>
        {provision.text}
      </Text>
      <Text style={styles.itemRelevance}>{provision.relevance}</Text>
    </View>
  );
}

function ArgumentCard({
  argument,
  index,
  isCounter,
}: {
  argument: HearingPrepArgument;
  index: number;
  isCounter?: boolean;
}) {
  const strengthColor = STRENGTH_COLORS[argument.strength] ?? {
    bg: '#f3f4f6',
    text: '#6b7280',
  };

  return (
    <View
      style={[
        styles.argumentCard,
        isCounter && styles.counterArgumentCard,
      ]}
    >
      <View style={styles.argumentHeader}>
        <Text style={styles.argumentNumber}>{index + 1}.</Text>
        <View
          style={[
            styles.strengthBadge,
            { backgroundColor: strengthColor.bg },
          ]}
        >
          <Text
            style={[styles.strengthText, { color: strengthColor.text }]}
          >
            {ARGUMENT_STRENGTH_LABELS[argument.strength] ??
              argument.strength}
          </Text>
        </View>
      </View>
      <Text style={styles.argumentPosition}>{argument.position}</Text>
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
  issueText: {
    fontSize: 14,
    color: '#6b7280',
    fontStyle: 'italic',
    lineHeight: 20,
  },
  dateText: { fontSize: 12, color: '#9ca3af' },
  matterLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  matterLinkText: { fontSize: 13, color: '#1a56db', fontWeight: '500' },

  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
  },
  questionsSection: {
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

  itemCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  itemTitle: { fontSize: 13, fontWeight: '600', color: '#111827' },
  itemCitation: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  itemRelevance: {
    fontSize: 12,
    color: '#374151',
    marginTop: 4,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  holdingsContainer: { marginTop: 6, gap: 2 },
  holdingText: { fontSize: 12, color: '#374151', lineHeight: 17 },
  provisionText: {
    fontSize: 12,
    color: '#374151',
    marginTop: 4,
    lineHeight: 17,
  },

  argumentCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#059669',
  },
  counterArgumentCard: {
    borderLeftColor: '#dc2626',
  },
  argumentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  argumentNumber: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
  },
  strengthBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  strengthText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  argumentPosition: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
  },

  questionItem: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  questionNumber: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    width: 20,
  },
  questionText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
    flex: 1,
  },
});
