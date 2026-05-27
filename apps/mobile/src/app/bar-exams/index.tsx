import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBarExamYears } from '../../features/bar-exams/hooks/use-bar-exams';
import type { BarExamYearGroup } from '../../features/bar-exams/types';

function totalQuestionCount(group: BarExamYearGroup): number {
  return group.subjects.reduce((sum, s) => sum + s.questionCount, 0);
}

function YearCard({ item }: { item: BarExamYearGroup }) {
  const subjectCount = item.subjects.length;
  const questionCount = totalQuestionCount(item);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/bar-exams/${item.year}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={styles.iconBox}>
          <Ionicons name="school-outline" size={22} color="#1a56db" />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.year} Bar Examinations</Text>
          <Text style={styles.cardMeta}>
            {subjectCount} subject{subjectCount !== 1 ? 's' : ''} {'·'}{' '}
            {questionCount} question{questionCount !== 1 ? 's' : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
      </View>
    </TouchableOpacity>
  );
}

export default function BarExamsHubScreen() {
  const { data, isLoading, isFetching, refetch } = useBarExamYears();
  const years = data ?? [];

  return (
    <>
      <Stack.Screen
        options={{ title: 'Past Bar Exams', headerBackTitle: 'Study' }}
      />
      <View style={styles.container}>
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : years.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="school-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No bar exams available</Text>
            <Text style={styles.emptyText}>
              Past bar exam questions will appear here once they are imported.
            </Text>
          </View>
        ) : (
          <FlatList
            data={years}
            renderItem={({ item }) => <YearCard item={item} />}
            keyExtractor={(item) => String(item.year)}
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
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
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
});
