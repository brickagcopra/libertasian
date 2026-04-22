import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useDerivative } from '../../../../../features/derivatives/hooks/use-derivatives';
import { RENDERER_BY_TYPE } from '../../../../../features/derivatives/renderers';
import {
  subjectFromSlug,
  typeFromSlug,
} from '../../../../../features/derivatives/taxonomy';
import { DERIVATIVE_TYPE_LABELS } from '../../../../../features/derivatives/types';

export default function LibraryDetailScreen() {
  const { id, type, subject } = useLocalSearchParams<{
    id: string;
    type: string;
    subject: string;
  }>();
  const { data, isLoading, error } = useDerivative(id ?? '', !!id);

  const typeMeta = type ? typeFromSlug(type) : undefined;
  const subjectMeta = subject ? subjectFromSlug(subject) : undefined;

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1a56db" />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color="#9ca3af" />
        <Text style={styles.errorText}>
          {error instanceof Error ? error.message : 'Content not found.'}
        </Text>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const typeLabel = DERIVATIVE_TYPE_LABELS[data.derivativeType] ?? data.derivativeType;
  const primarySubject = data.subjects.find((s) => s.isPrimary) ?? data.subjects[0];
  const Renderer = RENDERER_BY_TYPE[data.derivativeType] ?? RENDERER_BY_TYPE.case_digest;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {typeMeta && subjectMeta ? (
        <Pressable
          style={styles.breadcrumb}
          onPress={() =>
            router.push(`/library/${typeMeta.slug}/${subjectMeta.slug}`)
          }
          accessibilityRole="button"
          accessibilityLabel={`Back to ${typeMeta.label} — ${subjectMeta.name}`}
        >
          <Ionicons name="chevron-back" size={14} color="#6b7280" />
          <Text style={styles.breadcrumbText}>
            {typeMeta.label} — {subjectMeta.name}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.badgeRow}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{typeLabel}</Text>
        </View>
        {primarySubject ? (
          <View style={styles.subjectBadge}>
            <Text style={styles.subjectBadgeText}>{primarySubject.name}</Text>
          </View>
        ) : null}
        {data.isGated ? (
          <View style={styles.gatedBadge}>
            <Ionicons name="lock-closed-outline" size={11} color="#92400e" />
            <Text style={styles.gatedBadgeText}>
              {data.upgradeTier ?? 'upgrade'}-tier
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.title} accessibilityRole="header">
        {data.title}
      </Text>

      {data.sourceDocument ? (
        <Text style={styles.source}>
          AI-generated from{' '}
          {data.sourceDocument.citationText ??
            data.sourceDocument.shortTitle ??
            data.sourceDocument.title}
        </Text>
      ) : null}

      {data.disclaimerBody ? (
        <View style={styles.disclaimer}>
          <Ionicons name="information-circle-outline" size={14} color="#6b7280" />
          <Text style={styles.disclaimerText}>{data.disclaimerBody.bodyPlain}</Text>
        </View>
      ) : null}

      <View style={styles.rendererBox}>
        <Renderer data={data} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 14, color: '#6b7280', marginTop: 8, textAlign: 'center' },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1a56db',
    borderRadius: 8,
  },
  backButtonText: { color: '#fff', fontWeight: '600' },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
  },
  breadcrumbText: { fontSize: 12, color: '#6b7280' },
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  typeBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  typeBadgeText: { fontSize: 11, fontWeight: '700', color: '#1d4ed8' },
  subjectBadge: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  subjectBadgeText: { fontSize: 11, fontWeight: '500', color: '#374151' },
  gatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fef3c7',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  gatedBadgeText: { fontSize: 11, fontWeight: '600', color: '#92400e' },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', lineHeight: 26 },
  source: { fontSize: 13, color: '#6b7280' },
  disclaimer: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 10,
  },
  disclaimerText: { flex: 1, fontSize: 12, color: '#4b5563', lineHeight: 17 },
  rendererBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
});
