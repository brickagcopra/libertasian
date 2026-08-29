import { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { TabBar, useTabBarClearance } from '@/components/ui/TabBar';
import { useFreemiumSurfaces } from '@/features/entitlements/use-freemium-surfaces';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';
import { useBarSubjects } from '../../features/study/hooks/use-bar-subjects';
import { useFlashcardSets } from '../../features/study/hooks/use-flashcard-sets';
import { useReviewerPacks } from '../../features/study/hooks/use-reviewer-packs';
import { useStudyStats } from '../../features/study/hooks/use-study-sessions';
import { useBarExamReadiness } from '../../features/study/hooks/use-syllabus';
import { SubjectGrid } from '../../features/study/components/subject-grid';
import { ReadinessRing } from '../../features/study/components/readiness-ring';

function formatStudyTime(totalSecs: number): string {
  if (totalSecs < 60) return `${totalSecs}s`;
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function StudyTab() {
  const navigate = useTabBarNav();
  const surfaces = useFreemiumSurfaces();
  const clearance = useTabBarClearance();
  const {
    data: subjects,
    isLoading: subjectsLoading,
    isFetching,
    refetch: refetchSubjects,
  } = useBarSubjects();
  const { data: setsData, refetch: refetchSets } = useFlashcardSets({
    limit: 5,
  });
  const { data: packsData, refetch: refetchPacks } = useReviewerPacks({
    limit: 5,
  });
  const { data: readiness, refetch: refetchReadiness } = useBarExamReadiness();
  const { data: studyStats, refetch: refetchStudyStats } = useStudyStats();

  const handleRefresh = useCallback(() => {
    refetchSubjects();
    refetchSets();
    refetchPacks();
    refetchReadiness();
    refetchStudyStats();
  }, [refetchSubjects, refetchSets, refetchPacks, refetchReadiness, refetchStudyStats]);

  if (subjectsLoading) {
    // The pill renders here too — a nav bar that vanishes while a tab loads is
    // the same disappearing-nav problem this screen is being fixed for.
    return (
      <View style={styles.screen}>
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
        <TabBar active="study" onPress={navigate} />
      </View>
    );
  }

  const barSubjects = subjects ?? [];
  const flashcardSets = setsData?.data ?? [];
  const reviewerPacks = packsData?.data ?? [];

  // Held in a variable rather than returned directly so the floating pill can be
  // added as a sibling without re-indenting the whole tree.
  const body = (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !subjectsLoading}
          onRefresh={handleRefresh}
          colors={['#1a56db']}
        />
      }
    >
      {/* Community Marketplace Banner */}
      <TouchableOpacity
        style={styles.communityBanner}
        onPress={() => router.push('/community')}
        activeOpacity={0.7}
      >
        <View style={styles.communityIconBox}>
          <Ionicons name="people-outline" size={20} color="#1a56db" />
        </View>
        <View style={styles.communityContent}>
          <Text style={styles.communityTitle}>Community Marketplace</Text>
          <Text style={styles.communityDesc}>
            Discover shared flashcards, reviewers & digests
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
      </TouchableOpacity>

      {/* Bar Exam Syllabus */}
      {readiness ? (
        <TouchableOpacity
          style={styles.syllabusBanner}
          onPress={() => router.push('/study/syllabus/')}
          activeOpacity={0.7}
        >
          <ReadinessRing
            pct={readiness.overallPct}
            size={52}
            strokeWidth={5}
            color="#4f46e5"
          />
          <View style={styles.syllabusContent}>
            <Text style={styles.syllabusTitle}>Bar Exam Syllabus</Text>
            <Text style={styles.syllabusScore}>
              {readiness.overallPct}% readiness · {readiness.completedTopics}/
              {readiness.totalTopics} topics
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
        </TouchableOpacity>
      ) : null}

      {/* Past Bar Exams. Gated independently of the Study tab that contains it:
          bar exam questions are their own paid corpus on the API
          (`bar_exam_questions` is outside FREE_DOCUMENT_TYPES), and this banner
          is the app's only route to them. Belt and braces — the Study tab is
          already hidden for the same accounts — but the entry point should not
          depend on its container to stay hidden. */}
      {surfaces.barExams ? (
      <TouchableOpacity
        style={styles.barExamsBanner}
        onPress={() => router.push('/bar-exams')}
        activeOpacity={0.7}
      >
        <View style={styles.barExamsIconBox}>
          <Ionicons name="school-outline" size={20} color="#1a56db" />
        </View>
        <View style={styles.barExamsContent}>
          <Text style={styles.barExamsTitle}>Past Bar Exams</Text>
          <Text style={styles.barExamsDesc}>
            Browse past questions with AI model answers
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
      </TouchableOpacity>
      ) : null}

      {/* Study Stats */}
      {studyStats ? (
        <View style={styles.studyStatsCard}>
          <View style={styles.studyStatItem}>
            <Ionicons name="flame-outline" size={20} color="#f59e0b" />
            <Text style={styles.studyStatValue}>
              {studyStats.streak.current}
            </Text>
            <Text style={styles.studyStatLabel}>Day Streak</Text>
          </View>
          <View style={styles.studyStatDivider} />
          <View style={styles.studyStatItem}>
            <Ionicons name="time-outline" size={20} color="#1a56db" />
            <Text style={styles.studyStatValue}>
              {formatStudyTime(studyStats.totalStudyTimeSecs)}
            </Text>
            <Text style={styles.studyStatLabel}>Total Time</Text>
          </View>
          <View style={styles.studyStatDivider} />
          <View style={styles.studyStatItem}>
            <Ionicons name="book-outline" size={20} color="#059669" />
            <Text style={styles.studyStatValue}>
              {studyStats.totalSessions}
            </Text>
            <Text style={styles.studyStatLabel}>Sessions</Text>
          </View>
        </View>
      ) : null}

      {/* Quick Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{barSubjects.length}</Text>
          <Text style={styles.statLabel}>Subjects</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{flashcardSets.length}</Text>
          <Text style={styles.statLabel}>Flashcard Sets</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{reviewerPacks.length}</Text>
          <Text style={styles.statLabel}>Reviewer Packs</Text>
        </View>
      </View>

      {/* Legal Documents Link */}
      <TouchableOpacity
        style={styles.documentsBanner}
        onPress={() => router.push('/documents')}
        activeOpacity={0.7}
      >
        <View style={styles.documentsIconBox}>
          <Ionicons name="library-outline" size={20} color="#1a56db" />
        </View>
        <View style={styles.documentsContent}>
          <Text style={styles.documentsTitle}>Legal Documents</Text>
          <Text style={styles.documentsDesc}>
            Browse cases, statutes & issuances
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
      </TouchableOpacity>

      {/* Bar Subjects */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Bar Subjects</Text>
          <TouchableOpacity onPress={() => router.push('/study/codals/')}>
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>
        {barSubjects.length > 0 ? (
          <SubjectGrid subjects={barSubjects} />
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No bar subjects available</Text>
          </View>
        )}
      </View>

      {/* Flashcard Sets */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Flashcard Sets</Text>
          <TouchableOpacity onPress={() => router.push('/study/flashcards/')}>
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>
        {flashcardSets.length > 0 ? (
          flashcardSets.map((set) => (
            <TouchableOpacity
              key={set.id}
              style={styles.listCard}
              onPress={() => router.push(`/study/flashcards/${set.id}`)}
              activeOpacity={0.7}
            >
              <View style={styles.listCardRow}>
                <Ionicons name="layers-outline" size={20} color="#1a56db" />
                <View style={styles.listCardContent}>
                  <Text style={styles.listCardTitle} numberOfLines={1}>
                    {set.title}
                  </Text>
                  <Text style={styles.listCardMeta}>
                    {set.cardCount} card{set.cardCount !== 1 ? 's' : ''}
                    {set.barSubject
                      ? ` · ${set.barSubject.replace(/_/g, ' ')}`
                      : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="layers-outline" size={32} color="#d1d5db" />
            <Text style={styles.emptyText}>No flashcard sets yet</Text>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => router.push('/study/flashcards/')}
            >
              <Text style={styles.createButtonText}>Create One</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Reviewer Packs */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Reviewer Packs</Text>
          <TouchableOpacity
            onPress={() => router.push('/study/reviewer-packs/')}
          >
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>
        {reviewerPacks.length > 0 ? (
          reviewerPacks.map((pack) => (
            <TouchableOpacity
              key={pack.id}
              style={styles.listCard}
              onPress={() => router.push(`/study/reviewer-packs/${pack.id}`)}
              activeOpacity={0.7}
            >
              <View style={styles.listCardRow}>
                <Ionicons name="folder-outline" size={20} color="#1a56db" />
                <View style={styles.listCardContent}>
                  <Text style={styles.listCardTitle} numberOfLines={1}>
                    {pack.title}
                  </Text>
                  <Text style={styles.listCardMeta}>
                    {pack.itemCount} item{pack.itemCount !== 1 ? 's' : ''}
                    {pack.barSubject
                      ? ` · ${pack.barSubject.replace(/_/g, ' ')}`
                      : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#9ca3af" />
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <Ionicons name="folder-outline" size={32} color="#d1d5db" />
            <Text style={styles.emptyText}>No reviewer packs yet</Text>
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => router.push('/study/reviewer-packs/')}
            >
              <Text style={styles.createButtonText}>Create One</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </ScrollView>
  );

  return (
    <View style={styles.screen}>
      {body}
      {/* Floating pill TabBar — same treatment as (tabs)/digests.tsx. The
          content's paddingBottom comes from useTabBarClearance(). */}
      <TabBar active="study" onPress={navigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f4f6' },
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  // 96, matching (tabs)/digests.tsx listContent — clears the floating pill.
  content: { padding: 12, },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  communityIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityContent: { flex: 1 },
  communityTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a56db',
  },
  communityDesc: {
    fontSize: 11,
    color: '#3b82f6',
    marginTop: 1,
  },
  syllabusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  syllabusContent: { flex: 1 },
  syllabusTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  syllabusScore: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  studyStatsCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  studyStatItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  studyStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  studyStatLabel: {
    fontSize: 10,
    color: '#6b7280',
  },
  studyStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#e5e7eb',
  },
  documentsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  documentsIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentsContent: { flex: 1 },
  documentsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  documentsDesc: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 1,
  },
  barExamsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  barExamsIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barExamsContent: { flex: 1 },
  barExamsTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  barExamsDesc: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 1,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1a56db',
  },
  statLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  section: { marginBottom: 20 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a56db',
  },
  listCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  listCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  listCardContent: { flex: 1 },
  listCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  listCardMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
    textTransform: 'capitalize',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  createButton: {
    backgroundColor: '#1a56db',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginTop: 4,
  },
  createButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
