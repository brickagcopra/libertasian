import { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useSyllabus,
  useSyllabusProgress,
  useUpsertSyllabusTopicProgress,
} from '../../../features/study/hooks/use-syllabus';
import type { SyllabusTopic, SyllabusTopicProgress } from '../../../features/study/types';

const STATUS_CYCLE: Array<'not_started' | 'in_progress' | 'completed'> = [
  'not_started',
  'in_progress',
  'completed',
];

function getNextStatus(current: string): 'not_started' | 'in_progress' | 'completed' {
  const idx = STATUS_CYCLE.indexOf(current as typeof STATUS_CYCLE[number]);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

function getCheckboxIcon(status: string): keyof typeof Ionicons.glyphMap {
  switch (status) {
    case 'completed':
      return 'checkbox';
    case 'in_progress':
      return 'remove-circle';
    default:
      return 'square-outline';
  }
}

function getCheckboxColor(status: string): string {
  switch (status) {
    case 'completed':
      return '#059669';
    case 'in_progress':
      return '#f59e0b';
    default:
      return '#d1d5db';
  }
}

function TopicRow({
  topic,
  topicProgress,
  collapsedIds,
  onToggleCollapse,
  onToggleStatus,
  subject,
}: {
  topic: SyllabusTopic;
  topicProgress: Record<string, SyllabusTopicProgress>;
  collapsedIds: Set<string>;
  onToggleCollapse: (id: string) => void;
  onToggleStatus: (topicId: string, currentStatus: string) => void;
  subject: string;
}) {
  const progress = topicProgress[topic.id];
  const status = progress?.status ?? 'not_started';
  const hasChildren = topic.children && topic.children.length > 0;
  const isCollapsed = collapsedIds.has(topic.id);
  const resourceCount = topic._count?.resources ?? topic.resources?.length ?? 0;

  const childCompleted =
    hasChildren
      ? topic.children!.filter(
          (c) => (topicProgress[c.id]?.status ?? 'not_started') === 'completed',
        ).length
      : 0;
  const childTotal = hasChildren ? topic.children!.length : 0;

  return (
    <>
      <View style={[styles.topicRow, { paddingLeft: 12 + topic.depth * 20 }]}>
        <TouchableOpacity
          onPress={() => onToggleStatus(topic.id, status)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={getCheckboxIcon(status)}
            size={22}
            color={getCheckboxColor(status)}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.topicContent}
          onPress={() => {
            if (hasChildren) {
              onToggleCollapse(topic.id);
            } else if (resourceCount > 0) {
              router.push(`/study/syllabus/${subject}/topic/${topic.id}`);
            }
          }}
          activeOpacity={0.7}
        >
          <View style={styles.topicTitleRow}>
            <Text style={styles.topicTitle} numberOfLines={2}>
              {topic.title}
            </Text>
            {resourceCount > 0 ? (
              <View style={styles.resourceBadge}>
                <Text style={styles.resourceBadgeText}>{resourceCount}</Text>
              </View>
            ) : null}
          </View>
          {hasChildren ? (
            <Text style={styles.topicSubtext}>
              {childCompleted}/{childTotal} completed
            </Text>
          ) : null}
        </TouchableOpacity>

        {hasChildren ? (
          <TouchableOpacity
            onPress={() => onToggleCollapse(topic.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={isCollapsed ? 'chevron-forward' : 'chevron-down'}
              size={18}
              color="#9ca3af"
            />
          </TouchableOpacity>
        ) : resourceCount > 0 ? (
          <TouchableOpacity
            onPress={() =>
              router.push(`/study/syllabus/${subject}/topic/${topic.id}`)
            }
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
          </TouchableOpacity>
        ) : null}
      </View>

      {hasChildren && !isCollapsed
        ? topic.children!.map((child) => (
            <TopicRow
              key={child.id}
              topic={child}
              topicProgress={topicProgress}
              collapsedIds={collapsedIds}
              onToggleCollapse={onToggleCollapse}
              onToggleStatus={onToggleStatus}
              subject={subject}
            />
          ))
        : null}
    </>
  );
}

export default function SyllabusSubjectScreen() {
  const { subject } = useLocalSearchParams<{ subject: string }>();
  const subjectCode = subject ?? '';

  const {
    data: syllabus,
    isLoading: syllabusLoading,
    isFetching,
    refetch,
  } = useSyllabus(subjectCode);
  const {
    data: progressData,
    refetch: refetchProgress,
  } = useSyllabusProgress(syllabus?.id ?? '');
  const upsertProgress = useUpsertSyllabusTopicProgress();

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const topicProgress = progressData?.topicProgress ?? {};

  const handleToggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleToggleStatus = useCallback(
    (topicId: string, currentStatus: string) => {
      const nextStatus = getNextStatus(currentStatus);
      upsertProgress.mutate({
        topicId,
        data: {
          status: nextStatus,
          progressPct: nextStatus === 'completed' ? 100 : nextStatus === 'in_progress' ? 50 : 0,
        },
      });
    },
    [upsertProgress],
  );

  const handleRefresh = useCallback(() => {
    refetch();
    refetchProgress();
  }, [refetch, refetchProgress]);

  const rootTopics = useMemo(() => {
    if (!syllabus?.topics) return [];
    return syllabus.topics.filter((t) => !t.parentTopicId);
  }, [syllabus?.topics]);

  const completedCount = progressData?.completedCount ?? 0;
  const totalTopics = progressData?.totalTopics ?? 0;
  const overallPct = progressData?.overallPct ?? 0;

  if (syllabusLoading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Loading...' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  if (!syllabus) {
    return (
      <>
        <Stack.Screen options={{ title: 'Not Found' }} />
        <View style={styles.emptyState}>
          <Ionicons name="school-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyTitle}>Syllabus not found</Text>
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

  return (
    <>
      <Stack.Screen
        options={{
          title: syllabus.title,
          headerBackTitle: 'Syllabus',
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isFetching && !syllabusLoading}
            onRefresh={handleRefresh}
            colors={['#1a56db']}
          />
        }
      >
        {/* Progress Summary */}
        <View style={styles.progressCard}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>
              {completedCount} of {totalTopics} topics completed
            </Text>
            <Text style={styles.progressPct}>{overallPct}%</Text>
          </View>
          <View style={styles.progressBar}>
            <View
              style={[styles.progressFill, { width: `${Math.min(overallPct, 100)}%` }]}
            />
          </View>
        </View>

        {/* Topic Tree */}
        <View style={styles.topicsContainer}>
          {rootTopics.length === 0 ? (
            <View style={styles.noTopics}>
              <Text style={styles.noTopicsText}>No topics in this syllabus</Text>
            </View>
          ) : (
            rootTopics.map((topic) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                topicProgress={topicProgress}
                collapsedIds={collapsedIds}
                onToggleCollapse={handleToggleCollapse}
                onToggleStatus={handleToggleStatus}
                subject={subjectCode}
              />
            ))
          )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { paddingBottom: 32 },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  backButton: {
    marginTop: 16,
    backgroundColor: '#1a56db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  backButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  progressCard: {
    backgroundColor: '#fff',
    margin: 12,
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  progressPct: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a56db',
  },
  progressBar: {
    height: 8,
    backgroundColor: '#e5e7eb',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#1a56db',
    borderRadius: 4,
  },
  topicsContainer: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingRight: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    gap: 10,
  },
  topicContent: { flex: 1 },
  topicTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topicTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
    flex: 1,
  },
  resourceBadge: {
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  resourceBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d4ed8',
  },
  topicSubtext: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 2,
  },
  noTopics: {
    padding: 24,
    alignItems: 'center',
  },
  noTopicsText: {
    fontSize: 14,
    color: '#9ca3af',
  },
});
