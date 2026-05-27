import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBarExamYear } from '../../../features/bar-exams/hooks/use-bar-exams';
import { ApiClientError } from '../../../lib/api-client';
import type { BarExamSubjectSummary } from '../../../features/bar-exams/types';

function humanizeSubject(code: string | null): string {
  if (!code) return 'Unknown subject';
  return code
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function SubjectCard({
  year,
  item,
}: {
  year: number;
  item: BarExamSubjectSummary;
}) {
  const name = humanizeSubject(item.code);
  const onPress = () => {
    if (!item.code) return;
    router.push({
      pathname: '/bar-exams/[year]/[subjectCode]',
      params: {
        year: String(year),
        subjectCode: item.code,
        ...(item.part ? { part: item.part } : {}),
      },
    });
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!item.code}
    >
      <View style={styles.cardRow}>
        <View style={styles.iconBox}>
          <Ionicons name="document-text-outline" size={20} color="#1a56db" />
        </View>
        <View style={styles.cardContent}>
          <View style={styles.titleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {name}
            </Text>
            {item.part ? (
              <View style={styles.partBadge}>
                <Text style={styles.partBadgeText}>Part {item.part}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.cardMeta}>
            {item.questionCount} question{item.questionCount !== 1 ? 's' : ''}
            {item.chairperson ? ` · ${item.chairperson}` : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
      </View>
    </TouchableOpacity>
  );
}

export default function BarExamYearScreen() {
  const params = useLocalSearchParams<{ year: string }>();
  const year = Number(params.year ?? 0);

  const { data, isLoading, isFetching, refetch, error } = useBarExamYear(year);

  const isYearNotFound =
    error instanceof ApiClientError && error.statusCode === 404;
  const subjects = data?.subjects ?? [];

  return (
    <>
      <Stack.Screen options={{ title: year ? `${year} Bar Exam` : 'Bar Exam' }} />
      <View style={styles.container}>
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : isYearNotFound || subjects.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="school-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No subjects on record</Text>
            <Text style={styles.emptyText}>
              {year
                ? `LawPhil has no parsed bar exam papers for ${year} yet.`
                : 'This year has no bar exam papers yet.'}
            </Text>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
            >
              <Text style={styles.backButtonText}>Back to Years</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={subjects}
            renderItem={({ item }) => <SubjectCard year={year} item={item} />}
            keyExtractor={(item) => item.sittingId}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={isFetching && !isLoading}
                onRefresh={refetch}
                colors={['#1a56db']}
              />
            }
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { padding: 12, gap: 8, paddingBottom: 32 },
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
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
  },
  cardContent: { flex: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    flexShrink: 1,
  },
  partBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  partBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  cardMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginTop: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  backButton: {
    marginTop: 16,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  backButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
