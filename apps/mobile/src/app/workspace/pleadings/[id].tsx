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
  usePleading,
  useDeletePleading,
} from '../../../features/pleadings/hooks/use-pleadings';
import { PLEADING_CATEGORY_LABELS } from '../../../features/pleadings/types';
import type { PleadingSectionOutput } from '../../../features/pleadings/types';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#fef3c7', text: '#92400e' },
  generating: { bg: '#dbeafe', text: '#1e40af' },
  completed: { bg: '#d1fae5', text: '#065f46' },
  failed: { bg: '#fecaca', text: '#991b1b' },
};

export default function PleadingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: resp, isLoading, error } = usePleading(id ?? '', !!id);
  const deletePleading = useDeletePleading();

  const pleading = resp?.data;

  const handleDelete = useCallback(() => {
    if (!id) return;
    Alert.alert(
      'Delete Pleading',
      'Are you sure? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            deletePleading.mutate(id, { onSuccess: () => router.back() }),
        },
      ],
    );
  }, [id, deletePleading]);

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Pleading' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (error || !pleading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Pleading' }} />
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color="#dc2626" />
          <Text style={styles.errorTitle}>Failed to load pleading</Text>
          <Text style={styles.errorText}>
            {error instanceof Error ? error.message : 'Pleading not found'}
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

  const categoryLabel =
    PLEADING_CATEGORY_LABELS[pleading.template.category] ??
    pleading.template.category;
  const statusColor = STATUS_COLORS[pleading.status] ?? {
    bg: '#f3f4f6',
    text: '#6b7280',
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: pleading.template.name,
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
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        {/* Status + Meta */}
        <View style={styles.metaRow}>
          <View style={[styles.badge, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.badgeText, { color: statusColor.text }]}>
              {pleading.status}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#e0e7ff' }]}>
            <Text style={[styles.badgeText, { color: '#3730a3' }]}>
              {categoryLabel}
            </Text>
          </View>
        </View>

        {/* Date + Matter */}
        <Text style={styles.dateText}>
          {new Date(pleading.createdAt).toLocaleDateString('en-PH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </Text>
        {pleading.matter && (
          <TouchableOpacity
            style={styles.matterLink}
            onPress={() =>
              router.push(`/workspace/matters/${pleading.matter!.id}`)
            }
          >
            <Ionicons name="folder-outline" size={14} color="#1a56db" />
            <Text style={styles.matterLinkText}>
              {pleading.matter.title}
            </Text>
          </TouchableOpacity>
        )}

        {/* Generating state */}
        {(pleading.status === 'pending' ||
          pleading.status === 'generating') && (
          <View style={styles.generatingCard}>
            <ActivityIndicator size="small" color="#1a56db" />
            <View style={styles.generatingTextContainer}>
              <Text style={styles.generatingTitle}>
                {pleading.status === 'pending'
                  ? 'Pleading queued for generation...'
                  : 'Generating your pleading...'}
              </Text>
              <Text style={styles.generatingSubtext}>
                This may take up to 60 seconds. The page will update
                automatically.
              </Text>
            </View>
          </View>
        )}

        {/* Failed state */}
        {pleading.status === 'failed' && (
          <View style={styles.failedCard}>
            <Ionicons name="warning-outline" size={20} color="#991b1b" />
            <Text style={styles.failedText}>
              Generation failed. Try again with different inputs.
            </Text>
          </View>
        )}

        {/* Completed - Generated Output */}
        {pleading.status === 'completed' && pleading.generatedOutput && (
          <>
            {/* Title */}
            <Text style={styles.pleadingTitle}>
              {pleading.generatedOutput.title}
            </Text>

            {/* Sections */}
            {pleading.generatedOutput.sections.map((section, index) => (
              <PleadingSectionCard
                key={index}
                section={section}
                index={index}
              />
            ))}

            {/* Citations */}
            {pleading.citationsJson && pleading.citationsJson.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>
                  Citations ({pleading.citationsJson.length})
                </Text>
                {pleading.citationsJson.map((citation, i) => (
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

        {/* Input Data Summary */}
        {pleading.inputData &&
          Object.keys(pleading.inputData).length > 0 && (
            <View style={[styles.section, styles.inputDataSection]}>
              <Text style={styles.sectionLabel}>Input Data</Text>
              {Object.entries(pleading.inputData).map(([key, value]) => (
                <View key={key} style={styles.inputDataRow}>
                  <Text style={styles.inputDataKey}>{key}</Text>
                  <Text style={styles.inputDataValue} numberOfLines={3}>
                    {String(value)}
                  </Text>
                </View>
              ))}
            </View>
          )}
      </ScrollView>
    </>
  );
}

function PleadingSectionCard({
  section,
  index,
}: {
  section: PleadingSectionOutput;
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
          {section.citations.map((c, i) => (
            <View key={i} style={styles.sectionCitationBadge}>
              <Text style={styles.sectionCitationText} numberOfLines={1}>
                {c.text}
              </Text>
            </View>
          ))}
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

  pleadingTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 24,
  },

  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
  },
  inputDataSection: {
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
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
  },
  sectionCitationBadge: {
    backgroundColor: '#e0e7ff',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sectionCitationText: { fontSize: 10, color: '#3730a3' },

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

  inputDataRow: {
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  inputDataKey: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  inputDataValue: {
    fontSize: 13,
    color: '#374151',
    marginTop: 2,
  },
});
