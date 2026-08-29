import { useCallback, useState } from 'react';
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
import { SurfaceGuard } from '@/features/entitlements/surface-guard';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';
import { useMatters } from '../../features/workspace/hooks/use-matters';
import { useNotes } from '../../features/workspace/hooks/use-notes';
import { useTasks } from '../../features/workspace/hooks/use-tasks';
import { useActivity } from '../../features/workspace/hooks/use-activity';
import { useMemos } from '../../features/memos/hooks/use-memos';
import { useAnnotations } from '../../features/annotations/hooks/use-annotations';
import { useComparisons } from '../../features/case-comparisons/hooks/use-case-comparisons';
import { usePleadings } from '../../features/pleadings/hooks/use-pleadings';
import type { MatterListItem } from '../../features/workspace/types';
import type { TaskListItem } from '../../features/workspace/types';
import type { ActivityEntry } from '../../features/workspace/types';

// ─── Quick Stats ───────────────────────────────────────────

function StatCard({
  icon,
  label,
  count,
  color,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  count: number;
  color: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.statCard} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={styles.statCount}>{count}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Recent Matter Card ────────────────────────────────────

function RecentMatterCard({ item }: { item: MatterListItem }) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/workspace/matters/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={[styles.statusDot, item.status === 'active' ? styles.dotActive : styles.dotClosed]} />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.title}
        </Text>
      </View>
      {item.court ? (
        <Text style={styles.cardMeta} numberOfLines={1}>
          {item.court}
        </Text>
      ) : null}
      <View style={styles.cardFooter}>
        <Text style={styles.cardMetaSmall}>
          {item._count.documents} docs | {item._count.notes} notes
        </Text>
        <Text style={styles.cardMetaSmall}>
          {new Date(item.updatedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Upcoming Task Card ────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#dc2626',
  high: '#ea580c',
  medium: '#1a56db',
  low: '#6b7280',
};

function UpcomingTaskCard({ item }: { item: TaskListItem }) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/workspace/tasks/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View
          style={[
            styles.priorityDot,
            { backgroundColor: PRIORITY_COLORS[item.priority] ?? '#6b7280' },
          ]}
        />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.title}
        </Text>
      </View>
      <View style={styles.cardFooter}>
        {item.assignedTo ? (
          <Text style={styles.cardMetaSmall}>{item.assignedTo.fullName}</Text>
        ) : (
          <Text style={[styles.cardMetaSmall, { color: '#9ca3af' }]}>Unassigned</Text>
        )}
        {item.dueDate ? (
          <Text style={[styles.cardMetaSmall, { color: PRIORITY_COLORS[item.priority] ?? '#6b7280' }]}>
            Due{' '}
            {new Date(item.dueDate).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

// ─── Activity Item ─────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  'matter.create': 'created a matter',
  'matter.update': 'updated a matter',
  'matter.delete': 'deleted a matter',
  'note.create': 'created a note',
  'note.update': 'updated a note',
  'note.delete': 'deleted a note',
  'task.create': 'created a task',
  'task.update': 'updated a task',
  'task.delete': 'deleted a task',
  'task_comment.create': 'commented on a task',
  'annotation.create': 'added an annotation',
  'matter_document.create': 'attached a document',
  'matter_document.delete': 'removed a document',
};

function ActivityItem({ item }: { item: ActivityEntry }) {
  const label = ACTION_LABELS[item.action] ?? item.action.replace('.', ' ');
  const actorName = item.actor?.fullName ?? 'System';

  return (
    <View style={styles.activityItem}>
      <Ionicons name="time-outline" size={14} color="#9ca3af" style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={styles.activityText}>
          <Text style={{ fontWeight: '600' }}>{actorName}</Text> {label}
        </Text>
        <Text style={styles.activityTime}>
          {new Date(item.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </Text>
      </View>
    </View>
  );
}

// ─── Section Header ────────────────────────────────────────

function SectionHeader({
  title,
  onViewAll,
}: {
  title: string;
  onViewAll?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {onViewAll ? (
        <TouchableOpacity onPress={onViewAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.viewAll}>View All</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Main Tab ──────────────────────────────────────────────

function WorkspaceTabScreen() {
  const navigate = useTabBarNav();
  const clearance = useTabBarClearance();
  const [refreshing, setRefreshing] = useState(false);

  const matters = useMatters({ limit: 5, status: 'active' });
  const notes = useNotes({ limit: 5 });
  const tasks = useTasks({ limit: 5, status: 'todo' });
  const memos = useMemos({ limit: 5 });
  const comparisons = useComparisons({ limit: 5 });
  const pleadings = usePleadings({ limit: 5 });
  const annotations = useAnnotations();
  const activity = useActivity({ limit: 8 });

  const isLoading =
    matters.isLoading && notes.isLoading && tasks.isLoading;

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      matters.refetch(),
      notes.refetch(),
      tasks.refetch(),
      memos.refetch(),
      comparisons.refetch(),
      pleadings.refetch(),
      annotations.refetch(),
      activity.refetch(),
    ]);
    setRefreshing(false);
  }, [matters, notes, tasks, memos, comparisons, pleadings, annotations, activity]);

  if (isLoading) {
    // The pill renders here too — a nav bar that vanishes while a tab loads is
    // the same disappearing-nav problem this screen is being fixed for.
    return (
      <View style={styles.screen}>
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
        <TabBar active="workspace" onPress={navigate} />
      </View>
    );
  }

  const matterItems = matters.data?.data ?? [];
  const noteItems = notes.data?.data ?? [];
  const taskItems = tasks.data?.data ?? [];
  const memoItems = memos.data?.data ?? [];
  const comparisonItems = comparisons.data?.data ?? [];
  const pleadingItems = pleadings.data?.data ?? [];
  const activityItems = activity.data?.data ?? [];

  const totalMatters = matterItems.length;
  const totalNotes = noteItems.length;
  const totalTasks = taskItems.length;
  const totalMemos = memoItems.length;
  const totalComparisons = comparisonItems.length;
  const totalPleadings = pleadingItems.length;
  const totalAnnotations = annotations.data?.length ?? 0;

  // Held in a variable rather than returned directly so the floating pill can be
  // added as a sibling without re-indenting the whole tree.
  const body = (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: clearance }]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          colors={['#1a56db']}
        />
      }
    >
      {/* Quick Stats */}
      <View style={styles.statsRow}>
        <StatCard
          icon="folder-outline"
          label="Matters"
          count={totalMatters}
          color="#1a56db"
          onPress={() => router.push('/workspace/matters')}
        />
        <StatCard
          icon="document-text-outline"
          label="Notes"
          count={totalNotes}
          color="#059669"
          onPress={() => router.push('/workspace/notes')}
        />
        <StatCard
          icon="checkmark-circle-outline"
          label="Tasks"
          count={totalTasks}
          color="#ea580c"
          onPress={() => router.push('/workspace/tasks')}
        />
        <StatCard
          icon="reader-outline"
          label="Memos"
          count={totalMemos}
          color="#7c3aed"
          onPress={() => router.push('/workspace/memos')}
        />
      </View>

      {/* AI Tools Stats */}
      <View style={styles.statsRow}>
        <StatCard
          icon="git-compare-outline"
          label="Comparisons"
          count={totalComparisons}
          color="#0891b2"
          onPress={() => router.push('/workspace/comparisons')}
        />
        <StatCard
          icon="create-outline"
          label="Pleadings"
          count={totalPleadings}
          color="#c2410c"
          onPress={() => router.push('/workspace/pleadings')}
        />
        <StatCard
          icon="color-wand-outline"
          label="Annotations"
          count={totalAnnotations}
          color="#ca8a04"
          onPress={() => router.push('/workspace/annotations')}
        />
      </View>

      {/* Recent Matters */}
      <SectionHeader
        title="Recent Matters"
        onViewAll={() => router.push('/workspace/matters')}
      />
      {matterItems.length === 0 ? (
        <View style={styles.emptySection}>
          <Text style={styles.emptyText}>No active matters</Text>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => router.push('/workspace/matters/create')}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.createButtonText}>New Matter</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.cardList}>
          {matterItems.map((m) => (
            <RecentMatterCard key={m.id} item={m} />
          ))}
        </View>
      )}

      {/* Upcoming Tasks */}
      <SectionHeader
        title="Open Tasks"
        onViewAll={() => router.push('/workspace/tasks')}
      />
      {taskItems.length === 0 ? (
        <View style={styles.emptySection}>
          <Text style={styles.emptyText}>No open tasks</Text>
        </View>
      ) : (
        <View style={styles.cardList}>
          {taskItems.map((t) => (
            <UpcomingTaskCard key={t.id} item={t} />
          ))}
        </View>
      )}

      {/* Recent Activity */}
      <SectionHeader title="Recent Activity" />
      {activityItems.length === 0 ? (
        <View style={styles.emptySection}>
          <Text style={styles.emptyText}>No recent activity</Text>
        </View>
      ) : (
        <View style={styles.activityList}>
          {activityItems.map((a) => (
            <ActivityItem key={a.id} item={a} />
          ))}
        </View>
      )}

      <View style={{ height: 24 }} />
    </ScrollView>
  );

  return (
    <View style={styles.screen}>
      {body}
      {/* Floating pill TabBar — same treatment as (tabs)/digests.tsx. The
          scrollContent's paddingBottom comes from useTabBarClearance(). */}
      <TabBar active="workspace" onPress={navigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f3f4f6' },
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  // 96, matching (tabs)/digests.tsx listContent — clears the floating pill.
  scrollContent: { padding: 12, },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 8,
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
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  statCount: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
  },
  statLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },

  // Section
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  viewAll: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a56db',
  },

  // Cards
  cardList: { gap: 8, marginBottom: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  cardMeta: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 4,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  cardMetaSmall: {
    fontSize: 11,
    color: '#6b7280',
  },

  // Status dots
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: { backgroundColor: '#059669' },
  dotClosed: { backgroundColor: '#9ca3af' },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  // Activity
  activityList: {
    backgroundColor: '#fff',
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  activityItem: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  activityText: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
  activityTime: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },

  // Empty states
  emptySection: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1a56db',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
  },
  createButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});

/**
 * `/(tabs)/workspace` is a different route from the `/workspace` subtree, and
 * its own deep link. `href: null` in `(tabs)/_layout.tsx` drops the tab button
 * but leaves the route registered, so a push notification, a restored
 * navigation state or a stale back stack still renders this dashboard — and
 * every tile and the New Matter button below it 402 on the free tier. Guarded
 * here as well as in `app/workspace/_layout.tsx`: tab screen AND stack layout,
 * the same pairing `/(tabs)/scan` and `/(tabs)/study` already use.
 */
export default function WorkspaceTab() {
  return (
    <SurfaceGuard surface="workspace">
      <WorkspaceTabScreen />
    </SurfaceGuard>
  );
}
