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

import { useDerivativeSubjectsByType } from '../../../../features/derivatives/hooks/use-derivatives';
import {
  SUBJECTS,
  subjectFromCode,
  typeFromSlug,
} from '../../../../features/derivatives/taxonomy';

export default function LibraryTypeScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const typeMeta = type ? typeFromSlug(type) : undefined;

  const { data: summary, isLoading } = useDerivativeSubjectsByType(
    typeMeta?.enum,
    'study_8',
  );

  if (!typeMeta) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color="#9ca3af" />
        <Text style={styles.missingText}>Unknown library type.</Text>
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

  const countByCode = new Map<string, number>();
  for (const row of summary ?? []) {
    countByCode.set(row.subjectCode, row.totalCount);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable
          style={styles.breadcrumb}
          onPress={() => router.push('/library')}
          accessibilityRole="button"
          accessibilityLabel="Back to Library"
        >
          <Ionicons name="chevron-back" size={14} color="#6b7280" />
          <Text style={styles.breadcrumbText}>Library</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          {typeMeta.label}
        </Text>
        <Text style={styles.subtitle}>{typeMeta.description}</Text>
      </View>

      <View style={styles.grid}>
        {SUBJECTS.map((s) => {
          const total = countByCode.get(s.code) ?? 0;
          const subject = subjectFromCode(s.code);
          const subjectSlug = subject?.slug ?? s.slug;
          return (
            <Pressable
              key={s.code}
              style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              onPress={() =>
                router.push(`/library/${typeMeta.slug}/${subjectSlug}`)
              }
              accessibilityRole="button"
              accessibilityLabel={`${s.name}, ${total} ${typeMeta.label.toLowerCase()}`}
            >
              <View style={styles.tileHeader}>
                <View style={styles.iconBox}>
                  <Ionicons name={s.icon} size={18} color="#1d4ed8" />
                </View>
                <Text style={styles.tileTitle} numberOfLines={2}>
                  {s.name}
                </Text>
              </View>
              <View style={styles.countRow}>
                {isLoading ? (
                  <ActivityIndicator size="small" color="#9ca3af" />
                ) : (
                  <>
                    <Text style={styles.countNumber}>{total}</Text>
                    <Text style={styles.countLabel}>
                      {typeMeta.label.toLowerCase()}
                    </Text>
                  </>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  missingText: { marginTop: 8, fontSize: 14, color: '#6b7280' },
  backButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#1a56db',
    borderRadius: 8,
  },
  backButtonText: { color: '#fff', fontWeight: '600' },
  header: { gap: 4 },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
  },
  breadcrumbText: { fontSize: 12, color: '#6b7280' },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6b7280', lineHeight: 19 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  tilePressed: { backgroundColor: '#f9fafb' },
  tileHeader: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitle: { flex: 1, fontSize: 13, fontWeight: '700', color: '#111827' },
  countRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  countNumber: { fontSize: 18, fontWeight: '700', color: '#111827' },
  countLabel: { fontSize: 12, color: '#6b7280' },
});
