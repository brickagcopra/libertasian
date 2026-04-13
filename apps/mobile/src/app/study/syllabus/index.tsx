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
import { useSyllabi, useBarExamReadiness } from '../../../features/study/hooks/use-syllabus';
import { ReadinessRing } from '../../../features/study/components/readiness-ring';
import type { BarSyllabus } from '../../../features/study/types';

const SUBJECT_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  political_law: { bg: '#dbeafe', text: '#1d4ed8', ring: '#3b82f6' },
  labor_law: { bg: '#fef3c7', text: '#92400e', ring: '#f59e0b' },
  civil_law: { bg: '#d1fae5', text: '#065f46', ring: '#10b981' },
  taxation_law: { bg: '#fee2e2', text: '#991b1b', ring: '#ef4444' },
  commercial_law: { bg: '#ede9fe', text: '#5b21b6', ring: '#8b5cf6' },
  criminal_law: { bg: '#f1f5f9', text: '#334155', ring: '#64748b' },
  remedial_law: { bg: '#ccfbf1', text: '#115e59', ring: '#14b8a6' },
  legal_ethics: { bg: '#ffedd5', text: '#9a3412', ring: '#f97316' },
  public_international_law: { bg: '#cffafe', text: '#155e75', ring: '#06b6d4' },
};

const SUBJECT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  political_law: 'flag-outline',
  labor_law: 'hammer-outline',
  civil_law: 'people-outline',
  taxation_law: 'calculator-outline',
  commercial_law: 'briefcase-outline',
  criminal_law: 'shield-outline',
  remedial_law: 'document-text-outline',
  legal_ethics: 'scale-outline',
  public_international_law: 'globe-outline',
};

function getSubjectColor(code: string) {
  return SUBJECT_COLORS[code] ?? { bg: '#f3f4f6', text: '#374151', ring: '#6b7280' };
}

function SyllabusCard({ item }: { item: BarSyllabus }) {
  const color = getSubjectColor(item.barSubjectCode);
  const topicCount = item.topicCount ?? item._count?.topics ?? 0;

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/study/syllabus/${item.barSubjectCode}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={[styles.iconBox, { backgroundColor: color.bg }]}>
          <Ionicons
            name={SUBJECT_ICONS[item.barSubjectCode] ?? 'book-outline'}
            size={22}
            color={color.text}
          />
        </View>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.cardMeta}>
            {item.barSubjectCode.replace(/_/g, ' ')}
            {topicCount > 0 ? ` \u00b7 ${topicCount} topic${topicCount !== 1 ? 's' : ''}` : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
      </View>
    </TouchableOpacity>
  );
}

export default function SyllabusListScreen() {
  const {
    data: syllabi,
    isLoading,
    isFetching,
    refetch,
  } = useSyllabi();
  const { data: readiness, refetch: refetchReadiness } = useBarExamReadiness();

  const handleRefresh = () => {
    refetch();
    refetchReadiness();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Bar Exam Syllabus',
          headerBackTitle: 'Study',
        }}
      />
      <View style={styles.container}>
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : (syllabi ?? []).length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="school-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>No syllabi available</Text>
            <Text style={styles.emptyText}>
              Bar exam syllabi will appear here when configured
            </Text>
          </View>
        ) : (
          <FlatList
            data={syllabi ?? []}
            renderItem={({ item }) => <SyllabusCard item={item} />}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={isFetching && !isLoading}
                onRefresh={handleRefresh}
                colors={['#1a56db']}
              />
            }
            ListHeaderComponent={
              readiness ? (
                <View style={styles.readinessCard}>
                  <ReadinessRing
                    pct={readiness.overallPct}
                    size={72}
                    strokeWidth={7}
                    color="#4f46e5"
                    label="Overall"
                  />
                  <View style={styles.readinessInfo}>
                    <Text style={styles.readinessTitle}>Bar Exam Readiness</Text>
                    <Text style={styles.readinessSubtitle}>
                      {readiness.completedTopics} of {readiness.totalTopics} topics completed
                    </Text>
                    <Text style={styles.readinessSubjects}>
                      {readiness.subjects.length} subject{readiness.subjects.length !== 1 ? 's' : ''}
                    </Text>
                  </View>
                </View>
              ) : null
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
  readinessCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    gap: 16,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  readinessInfo: { flex: 1 },
  readinessTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  readinessSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  readinessSubjects: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
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
    textTransform: 'capitalize',
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
