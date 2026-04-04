import { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTasks, useDeleteTask, useUpdateTask } from '../../../features/workspace/hooks/use-tasks';
import type { TaskListItem, TaskStatus, TaskPriority } from '../../../features/workspace/types';

const STATUS_OPTIONS: { label: string; value: TaskStatus | '' }[] = [
  { label: 'All', value: '' },
  { label: 'To Do', value: 'todo' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Done', value: 'done' },
  { label: 'Cancelled', value: 'cancelled' },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#dc2626',
  high: '#ea580c',
  medium: '#1a56db',
  low: '#6b7280',
};

const STATUS_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  todo: 'radio-button-off-outline',
  in_progress: 'time-outline',
  done: 'checkmark-circle',
  cancelled: 'close-circle-outline',
};

function TaskCard({
  item,
  onToggleDone,
  onDelete,
}: {
  item: TaskListItem;
  onToggleDone: (id: string, currentStatus: TaskStatus) => void;
  onDelete: (id: string) => void;
}) {
  const isDone = item.status === 'done';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/workspace/tasks/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <TouchableOpacity
          onPress={() => onToggleDone(item.id, item.status)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={STATUS_ICONS[item.status] ?? 'radio-button-off-outline'}
            size={22}
            color={isDone ? '#059669' : PRIORITY_COLORS[item.priority] ?? '#6b7280'}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text
            style={[styles.cardTitle, isDone && styles.cardTitleDone]}
            numberOfLines={2}
          >
            {item.title}
          </Text>

          <View style={styles.cardMeta}>
            <View
              style={[
                styles.priorityBadge,
                { backgroundColor: (PRIORITY_COLORS[item.priority] ?? '#6b7280') + '15' },
              ]}
            >
              <Text
                style={[
                  styles.priorityBadgeText,
                  { color: PRIORITY_COLORS[item.priority] ?? '#6b7280' },
                ]}
              >
                {item.priority}
              </Text>
            </View>

            {item.matter ? (
              <View style={styles.matterTag}>
                <Ionicons name="folder-outline" size={10} color="#1a56db" />
                <Text style={styles.matterTagText} numberOfLines={1}>
                  {item.matter.title}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.cardFooter}>
            <Text style={styles.footerText}>
              {item.assignedTo ? item.assignedTo.fullName : 'Unassigned'}
            </Text>
            {item.dueDate ? (
              <Text
                style={[
                  styles.footerText,
                  isOverdue(item.dueDate, item.status) && styles.overdueText,
                ]}
              >
                Due{' '}
                {new Date(item.dueDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </Text>
            ) : null}
            {item._count.comments > 0 ? (
              <View style={styles.commentCount}>
                <Ionicons name="chatbubble-outline" size={10} color="#9ca3af" />
                <Text style={styles.footerText}>{item._count.comments}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <TouchableOpacity
          onPress={() => onDelete(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="ellipsis-vertical" size={16} color="#9ca3af" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function isOverdue(dueDate: string, status: TaskStatus): boolean {
  if (status === 'done' || status === 'cancelled') return false;
  return new Date(dueDate) < new Date();
}

export default function TasksListScreen() {
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, isFetching, refetch } = useTasks({
    limit: 30,
    status: statusFilter || undefined,
    search: search || undefined,
  });
  const deleteTask = useDeleteTask();
  const updateTask = useUpdateTask();

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert('Delete Task', 'Are you sure you want to delete this task?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteTask.mutate(id),
        },
      ]);
    },
    [deleteTask],
  );

  const handleToggleDone = useCallback(
    (id: string, currentStatus: TaskStatus) => {
      const newStatus: TaskStatus = currentStatus === 'done' ? 'todo' : 'done';
      updateTask.mutate({ id, status: newStatus });
    },
    [updateTask],
  );

  const handleSearch = useCallback(() => {
    setSearch(searchInput.trim());
  }, [searchInput]);

  const renderItem = useCallback(
    ({ item }: { item: TaskListItem }) => (
      <TaskCard
        item={item}
        onToggleDone={handleToggleDone}
        onDelete={handleDelete}
      />
    ),
    [handleToggleDone, handleDelete],
  );

  const keyExtractor = useCallback((item: TaskListItem) => item.id, []);

  const taskList = data?.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: 'Tasks' }} />
      <View style={styles.container}>
        {/* Search Bar */}
        <View style={styles.searchRow}>
          <View style={styles.searchInputContainer}>
            <Ionicons name="search-outline" size={16} color="#9ca3af" />
            <TextInput
              style={styles.searchInput}
              placeholder="Search tasks..."
              placeholderTextColor="#9ca3af"
              value={searchInput}
              onChangeText={setSearchInput}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            {searchInput.length > 0 ? (
              <TouchableOpacity
                onPress={() => {
                  setSearchInput('');
                  setSearch('');
                }}
              >
                <Ionicons name="close-circle" size={16} color="#9ca3af" />
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push('/workspace/tasks/create')}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Status Filter */}
        <View style={styles.filterScroll}>
          {STATUS_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.filterChip,
                statusFilter === opt.value && styles.filterChipActive,
              ]}
              onPress={() => setStatusFilter(opt.value)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  statusFilter === opt.value && styles.filterChipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* List */}
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#1a56db" />
          </View>
        ) : taskList.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyTitle}>
              {search ? 'No tasks found' : 'No tasks yet'}
            </Text>
            <Text style={styles.emptyText}>
              {search
                ? 'Try a different search'
                : 'Create a task to track your work'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={taskList}
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
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  searchRow: {
    flexDirection: 'row',
    padding: 12,
    paddingBottom: 0,
    gap: 8,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    paddingVertical: 10,
  },
  addButton: {
    backgroundColor: '#1a56db',
    borderRadius: 8,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },

  filterScroll: {
    flexDirection: 'row',
    padding: 12,
    gap: 6,
    flexWrap: 'wrap',
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  filterChipActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
  },
  filterChipTextActive: { color: '#fff' },

  listContent: { padding: 12, paddingTop: 0, gap: 10 },

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
    alignItems: 'flex-start',
    gap: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
    marginBottom: 4,
  },
  cardTitleDone: {
    color: '#9ca3af',
    textDecorationLine: 'line-through',
  },
  cardMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  priorityBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  priorityBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  matterTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  matterTagText: {
    fontSize: 11,
    color: '#1a56db',
    fontWeight: '500',
    maxWidth: 120,
  },
  cardFooter: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  footerText: { fontSize: 11, color: '#9ca3af' },
  overdueText: { color: '#dc2626', fontWeight: '600' },
  commentCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
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
