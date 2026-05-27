import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBarExamSitting } from '../../../../features/bar-exams/hooks/use-bar-exams';
import { BarExamAnswerAccordion } from '../../../../features/bar-exams/components/bar-exam-answer-accordion';
import { ApiClientError } from '../../../../lib/api-client';
import type { BarExamQuestion } from '../../../../features/bar-exams/types';

function humanizeSubject(code: string): string {
  return code
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function QuestionCard({ question }: { question: BarExamQuestion }) {
  return (
    <View style={styles.questionCard}>
      <View style={styles.questionHeader}>
        <View style={styles.numberBubble}>
          <Text style={styles.numberBubbleText}>{question.number}</Text>
        </View>
        <Text style={styles.subPartsLabel}>
          {question.subPartsCount > 0
            ? `${question.subPartsCount} sub-part${question.subPartsCount !== 1 ? 's' : ''}`
            : 'Single question'}
        </Text>
      </View>
      <Text style={styles.questionText}>{question.text}</Text>
      <BarExamAnswerAccordion questionId={question.id} />
    </View>
  );
}

export default function BarExamSittingScreen() {
  const params = useLocalSearchParams<{
    year: string;
    subjectCode: string;
    part?: string;
  }>();
  const year = Number(params.year ?? 0);
  const subjectCode = params.subjectCode ?? '';
  const part = params.part;

  const { data, isLoading, isFetching, refetch, error } = useBarExamSitting(
    year,
    subjectCode,
    part,
  );

  const isNotFound =
    error instanceof ApiClientError && error.statusCode === 404;
  const subjectName = subjectCode ? humanizeSubject(subjectCode) : 'Bar Exam';

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: subjectName }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (isNotFound || !data) {
    return (
      <>
        <Stack.Screen options={{ title: subjectName }} />
        <View style={styles.emptyState}>
          <Ionicons name="document-text-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyTitle}>Paper not found</Text>
          <Text style={styles.emptyText}>
            We couldn&apos;t find {subjectName.toLowerCase()} for {year || 'this year'}.
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

  const { sitting, questions } = data;
  const headerPart = sitting.part ?? part ?? null;

  return (
    <>
      <Stack.Screen options={{ title: subjectName, headerBackTitle: 'Back' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !isLoading}
            onRefresh={refetch}
            colors={['#1a56db']}
          />
        }
      >
        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <Text style={styles.headerSubject}>{subjectName}</Text>
            {headerPart ? (
              <View style={styles.partBadge}>
                <Text style={styles.partBadgeText}>Part {headerPart}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.headerYear}>{sitting.year} Bar Examinations</Text>
          {sitting.chairperson ? (
            <Text style={styles.headerMeta}>
              Chairperson: {sitting.chairperson}
            </Text>
          ) : null}
          <Text style={styles.headerMeta}>
            {sitting.questionCount} question
            {sitting.questionCount !== 1 ? 's' : ''}
          </Text>
        </View>

        {questions.length === 0 ? (
          <View style={styles.emptyInline}>
            <Text style={styles.emptyInlineText}>
              No questions have been parsed for this paper yet.
            </Text>
          </View>
        ) : (
          questions.map((q) => <QuestionCard key={q.id} question={q} />)
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 12, paddingBottom: 32, gap: 10 },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#f3f4f6',
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
  headerCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
    gap: 4,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerSubject: {
    fontSize: 18,
    fontWeight: '700',
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
  headerYear: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  headerMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  questionCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  numberBubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberBubbleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1a56db',
  },
  subPartsLabel: {
    fontSize: 12,
    color: '#6b7280',
  },
  questionText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#111827',
  },
  emptyInline: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyInlineText: {
    fontSize: 13,
    color: '#9ca3af',
  },
});
