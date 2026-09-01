import { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  useTask,
  useUpdateTask,
  useDeleteTask,
  useCreateTaskComment,
  useDeleteTaskComment,
} from '../../../features/workspace/hooks/use-tasks';
import { DatePickerField } from '../../../components/date-picker-field';
import type { TaskStatus, TaskPriority, TaskComment } from '../../../features/workspace/types';

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#dc2626',
  high: '#ea580c',
  medium: '#1a56db',
  low: '#6b7280',
};

const STATUS_OPTIONS: { label: string; value: TaskStatus; icon: keyof typeof Ionicons.glyphMap }[] = [
  { label: 'To Do', value: 'todo', icon: 'radio-button-off-outline' },
  { label: 'In Progress', value: 'in_progress', icon: 'time-outline' },
  { label: 'Done', value: 'done', icon: 'checkmark-circle' },
  { label: 'Cancelled', value: 'cancelled', icon: 'close-circle-outline' },
];

// ─── Inline Editable Text ──────────────────────────────────

function InlineEditableText({
  value,
  onSave,
  style,
  multiline = false,
  placeholder = 'Tap to edit',
}: {
  value: string;
  onSave: (newValue: string) => void;
  style: object;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<TextInput>(null);

  const handleStartEdit = () => {
    setDraft(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSave = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== value && trimmed.length > 0) {
      onSave(trimmed);
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setDraft(value);
  };

  if (editing) {
    return (
      <View style={styles.inlineEditContainer}>
        <TextInput
          ref={inputRef}
          style={[style, styles.inlineEditInput]}
          value={draft}
          onChangeText={setDraft}
          multiline={multiline}
          maxLength={multiline ? 5000 : 500}
          textAlignVertical={multiline ? 'top' : 'center'}
          autoFocus
        />
        <View style={styles.inlineEditActions}>
          <TouchableOpacity onPress={handleSave} style={styles.inlineEditBtn}>
            <Ionicons name="checkmark" size={18} color="#059669" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCancel} style={styles.inlineEditBtn}>
            <Ionicons name="close" size={18} color="#dc2626" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity onPress={handleStartEdit} activeOpacity={0.6}>
      <View style={styles.inlineEditRow}>
        <Text style={style}>{value || placeholder}</Text>
        <Ionicons name="pencil" size={14} color="#9ca3af" />
      </View>
    </TouchableOpacity>
  );
}

// ─── Comment Item ──────────────────────────────────────────

function CommentItem({
  comment,
  onDelete,
}: {
  comment: TaskComment;
  onDelete: () => void;
}) {
  return (
    <View style={styles.commentItem}>
      <View style={styles.commentHeader}>
        <Text style={styles.commentAuthor}>{comment.user.fullName}</Text>
        <View style={styles.commentActions}>
          <Text style={styles.commentDate}>
            {new Date(comment.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
          <TouchableOpacity
            onPress={onDelete}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={14} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.commentBody}>{comment.body}</Text>
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data, isLoading } = useTask(id ?? null);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const createComment = useCreateTaskComment();
  const deleteComment = useDeleteTaskComment();

  const [commentText, setCommentText] = useState('');

  // `GET /tasks/:id` is a bare { success, data } envelope (unlike
  // `GET /tasks`, which carries `meta`) — already unwrapped by `apiClient`.
  const task = data;

  const handleUpdate = useCallback(
    (fields: Record<string, unknown>) => {
      if (id) updateTask.mutate({ id, ...fields });
    },
    [id, updateTask],
  );

  const handleStatusChange = useCallback(
    (status: TaskStatus) => handleUpdate({ status }),
    [handleUpdate],
  );

  const handlePriorityChange = useCallback(
    (priority: TaskPriority) => handleUpdate({ priority }),
    [handleUpdate],
  );

  const handleTitleSave = useCallback(
    (title: string) => handleUpdate({ title }),
    [handleUpdate],
  );

  const handleDescriptionSave = useCallback(
    (description: string) => handleUpdate({ description }),
    [handleUpdate],
  );

  const handleDueDateChange = useCallback(
    (date: Date | null) => {
      handleUpdate({
        dueDate: date ? date.toISOString().split('T')[0] : null,
      });
    },
    [handleUpdate],
  );

  const handleDelete = useCallback(() => {
    Alert.alert('Delete Task', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteTask.mutateAsync(id ?? '');
            router.back();
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Failed to delete';
            Alert.alert('Error', message);
          }
        },
      },
    ]);
  }, [id, deleteTask]);

  const handleAddComment = useCallback(async () => {
    if (!id || commentText.trim().length === 0) return;
    try {
      await createComment.mutateAsync({ taskId: id, body: commentText.trim() });
      setCommentText('');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to add comment';
      Alert.alert('Error', message);
    }
  }, [id, commentText, createComment]);

  const handleDeleteComment = useCallback(
    (commentId: string) => {
      if (!id) return;
      Alert.alert('Delete Comment', 'Remove this comment?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteComment.mutate({ taskId: id, commentId }),
        },
      ]);
    },
    [id, deleteComment],
  );

  if (isLoading || !task) {
    return (
      <>
        <Stack.Screen options={{ title: 'Task' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  const dueDateValue = task.dueDate ? new Date(task.dueDate) : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <TouchableOpacity
              onPress={handleDelete}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="trash-outline" size={20} color="#dc2626" />
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Header — Editable Title & Description */}
          <View style={styles.section}>
            <InlineEditableText
              value={task.title}
              onSave={handleTitleSave}
              style={styles.title}
              placeholder="Add title..."
            />
            <InlineEditableText
              value={task.description ?? ''}
              onSave={handleDescriptionSave}
              style={styles.description}
              multiline
              placeholder="Add description..."
            />
          </View>

          {/* Status */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Status</Text>
            <View style={styles.chipRow}>
              {STATUS_OPTIONS.map((opt) => {
                const isSelected = task.status === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.statusChip,
                      isSelected && styles.statusChipActive,
                    ]}
                    onPress={() => handleStatusChange(opt.value)}
                  >
                    <Ionicons
                      name={opt.icon}
                      size={14}
                      color={isSelected ? '#fff' : '#6b7280'}
                    />
                    <Text
                      style={[
                        styles.statusChipText,
                        isSelected && styles.statusChipTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Priority */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Priority</Text>
            <View style={styles.chipRow}>
              {(['low', 'medium', 'high', 'urgent'] as TaskPriority[]).map(
                (p) => {
                  const isSelected = task.priority === p;
                  const color = PRIORITY_COLORS[p] ?? '#6b7280';
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.priorityChip,
                        isSelected && {
                          backgroundColor: color,
                          borderColor: color,
                        },
                      ]}
                      onPress={() => handlePriorityChange(p)}
                    >
                      <Text
                        style={[
                          styles.priorityChipText,
                          isSelected && styles.priorityChipTextActive,
                        ]}
                      >
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  );
                },
              )}
            </View>
          </View>

          {/* Due Date — Editable */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Due Date</Text>
            <DatePickerField
              value={dueDateValue}
              onChange={handleDueDateChange}
              placeholder="No due date — tap to set"
            />
          </View>

          {/* Meta */}
          <View style={styles.section}>
            <View style={styles.metaGrid}>
              <View style={styles.metaItem}>
                <Ionicons name="person-outline" size={14} color="#6b7280" />
                <Text style={styles.metaLabel}>Assigned to</Text>
                <Text style={styles.metaValue}>
                  {task.assignedTo?.fullName ?? 'Unassigned'}
                </Text>
              </View>
              <View style={styles.metaItem}>
                <Ionicons name="person-outline" size={14} color="#6b7280" />
                <Text style={styles.metaLabel}>Created by</Text>
                <Text style={styles.metaValue}>{task.createdBy.fullName}</Text>
              </View>
              {task.matter ? (
                <TouchableOpacity
                  style={styles.metaItem}
                  onPress={() => router.push(`/workspace/matters/${task.matter!.id}`)}
                >
                  <Ionicons name="folder-outline" size={14} color="#1a56db" />
                  <Text style={styles.metaLabel}>Matter</Text>
                  <Text style={[styles.metaValue, { color: '#1a56db' }]}>
                    {task.matter.title}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Comments */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              Comments ({task.comments?.length ?? 0})
            </Text>
            {task.comments && task.comments.length > 0 ? (
              <View style={styles.commentsList}>
                {task.comments.map((c) => (
                  <CommentItem
                    key={c.id}
                    comment={c}
                    onDelete={() => handleDeleteComment(c.id)}
                  />
                ))}
              </View>
            ) : (
              <Text style={styles.noComments}>No comments yet</Text>
            )}
          </View>

          <View style={{ height: 80 }} />
        </ScrollView>

        {/* Comment Input */}
        <View style={styles.commentInputContainer}>
          <TextInput
            style={styles.commentInput}
            placeholder="Add a comment..."
            placeholderTextColor="#9ca3af"
            value={commentText}
            onChangeText={setCommentText}
            multiline
            maxLength={5000}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (commentText.trim().length === 0 || createComment.isPending) &&
                styles.sendButtonDisabled,
            ]}
            onPress={handleAddComment}
            disabled={commentText.trim().length === 0 || createComment.isPending}
          >
            <Ionicons
              name="send"
              size={18}
              color={
                commentText.trim().length > 0 && !createComment.isPending
                  ? '#fff'
                  : '#9ca3af'
              }
            />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  scrollContent: { paddingBottom: 24 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  section: {
    backgroundColor: '#fff',
    padding: 16,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 26,
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
  },

  // Inline editing
  inlineEditRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  inlineEditContainer: {
    gap: 8,
  },
  inlineEditInput: {
    backgroundColor: '#f9fafb',
    borderWidth: 1,
    borderColor: '#1a56db',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  inlineEditActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  inlineEditBtn: {
    padding: 4,
  },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  statusChipActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  statusChipText: { fontSize: 12, fontWeight: '500', color: '#6b7280' },
  statusChipTextActive: { color: '#fff' },

  priorityChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  priorityChipText: { fontSize: 12, fontWeight: '500', color: '#6b7280' },
  priorityChipTextActive: { color: '#fff' },

  metaGrid: { gap: 12 },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaLabel: { fontSize: 12, color: '#6b7280', width: 80 },
  metaValue: { fontSize: 14, color: '#111827', fontWeight: '500', flex: 1 },

  commentsList: { gap: 1 },
  commentItem: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  commentAuthor: { fontSize: 13, fontWeight: '600', color: '#111827' },
  commentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commentDate: { fontSize: 11, color: '#9ca3af' },
  commentBody: { fontSize: 14, color: '#374151', lineHeight: 20 },
  noComments: { fontSize: 13, color: '#9ca3af', fontStyle: 'italic' },

  commentInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    padding: 12,
    gap: 8,
  },
  commentInput: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111827',
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#1a56db',
    borderRadius: 8,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#e5e7eb',
  },
});
