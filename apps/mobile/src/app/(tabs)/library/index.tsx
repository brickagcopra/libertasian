import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  useDerivativeSubjects,
  useDerivatives,
} from '../../../features/derivatives/hooks/use-derivatives';
import {
  DERIVATIVE_TYPE_LABELS,
  type DerivativeListItem,
} from '../../../features/derivatives/types';

const TYPE_FILTERS: Array<{ label: string; value: string | undefined }> = [
  { label: 'All', value: undefined },
  { label: 'Digests', value: 'case_digest' },
  { label: 'Doctrines', value: 'doctrine_extract' },
  { label: 'MCQs', value: 'mcq_question' },
  { label: 'Essays', value: 'essay_prompt' },
  { label: 'Outlines', value: 'subject_outline' },
  { label: 'Flashcards', value: 'flashcard' },
];

function FilterChip({
  label,
  active,
  onPress,
  trailing,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  trailing?: string | number;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      {trailing !== undefined ? (
        <Text style={[styles.chipCount, active && styles.chipCountActive]}>{trailing}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

function Card({ item }: { item: DerivativeListItem }) {
  const typeLabel = DERIVATIVE_TYPE_LABELS[item.derivativeType] ?? item.derivativeType;
  const primarySubject = item.subjects.find((s) => s.isPrimary) ?? item.subjects[0];

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/library/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardBadgeRow}>
        <View style={styles.typeBadge}>
          <Text style={styles.typeBadgeText}>{typeLabel}</Text>
        </View>
        {primarySubject ? (
          <View style={styles.subjectBadge}>
            <Text style={styles.subjectBadgeText}>{primarySubject.name}</Text>
          </View>
        ) : null}
        {item.isGated ? (
          <View style={styles.gatedBadge}>
            <Ionicons name="lock-closed-outline" size={11} color="#92400e" />
            <Text style={styles.gatedBadgeText}>{item.upgradeTier ?? 'upgrade'}</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>

      {item.sourceDocument ? (
        <Text style={styles.source} numberOfLines={1}>
          {item.sourceDocument.citationText ??
            item.sourceDocument.shortTitle ??
            item.sourceDocument.title}
        </Text>
      ) : null}

      <View style={styles.cardFooter}>
        <Text style={styles.footerText}>AI-generated</Text>
        {item.confidenceScore !== null && item.confidenceScore >= 0.7 ? (
          <Text style={styles.confidenceText}>
            {Math.round(item.confidenceScore * 100)}%
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export default function LibraryTab() {
  const [subjectCode, setSubjectCode] = useState<string | undefined>();
  const [derivativeType, setDerivativeType] = useState<string | undefined>();

  const { data: subjects } = useDerivativeSubjects('study_8');

  const {
    data,
    isLoading,
    isFetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useDerivatives({
    subjectCode,
    derivativeType,
    taxonomyVersion: 'study_8',
  });

  const items = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  const renderItem = useCallback(
    ({ item }: { item: DerivativeListItem }) => <Card item={item} />,
    [],
  );

  const keyExtractor = useCallback((item: DerivativeListItem) => item.id, []);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#1a56db" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Subject chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        <FilterChip
          label="All"
          active={subjectCode === undefined}
          onPress={() => setSubjectCode(undefined)}
        />
        {(subjects ?? []).map((s) => (
          <FilterChip
            key={s.code}
            label={s.name}
            trailing={s.count}
            active={subjectCode === s.code}
            onPress={() => setSubjectCode(subjectCode === s.code ? undefined : s.code)}
          />
        ))}
      </ScrollView>

      {/* Type filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {TYPE_FILTERS.map((t) => (
          <FilterChip
            key={t.label}
            label={t.label}
            active={derivativeType === t.value}
            onPress={() => setDerivativeType(t.value)}
          />
        ))}
      </ScrollView>

      {items.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="library-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyTitle}>No content yet</Text>
          <Text style={styles.emptyText}>
            {subjectCode
              ? `No approved content yet for this subject. Check back soon.`
              : 'No approved library content yet.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isFetching && !isLoading}
              onRefresh={() => refetch()}
              colors={['#1a56db']}
            />
          }
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator size="small" color="#1a56db" style={{ marginVertical: 12 }} />
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chipRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    backgroundColor: '#fff',
    borderBottomColor: '#e5e7eb',
    borderBottomWidth: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
  },
  chipActive: { backgroundColor: '#1a56db' },
  chipText: { fontSize: 12, fontWeight: '500', color: '#6b7280' },
  chipTextActive: { color: '#fff' },
  chipCount: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9ca3af',
    backgroundColor: '#e5e7eb',
    paddingHorizontal: 6,
    borderRadius: 10,
  },
  chipCountActive: { backgroundColor: 'rgba(255,255,255,0.25)', color: '#fff' },
  listContent: { padding: 12, gap: 10 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardBadgeRow: { flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  typeBadge: { backgroundColor: '#eff6ff', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  typeBadgeText: { fontSize: 11, fontWeight: '600', color: '#1d4ed8' },
  subjectBadge: { backgroundColor: '#f3f4f6', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  subjectBadgeText: { fontSize: 11, fontWeight: '500', color: '#374151' },
  gatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fef3c7',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  gatedBadgeText: { fontSize: 11, fontWeight: '600', color: '#92400e', textTransform: 'capitalize' },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#111827', lineHeight: 21, marginBottom: 4 },
  source: { fontSize: 12, color: '#6b7280', marginBottom: 8 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footerText: { fontSize: 11, color: '#9ca3af' },
  confidenceText: { fontSize: 12, fontWeight: '600', color: '#059669' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151', marginTop: 12 },
  emptyText: { fontSize: 14, color: '#9ca3af', textAlign: 'center', marginTop: 6, lineHeight: 20 },
});
