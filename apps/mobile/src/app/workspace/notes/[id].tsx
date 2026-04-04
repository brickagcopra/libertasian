import { useCallback, useState } from 'react';
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
  useNote,
  useUpdateNote,
  useDeleteNote,
} from '../../../features/workspace/hooks/use-notes';
import type { NoteVisibility } from '../../../features/workspace/types';

/** Extract plain text from Tiptap JSON */
function extractPlainText(body: Record<string, unknown>): string {
  if (!body || typeof body !== 'object') return '';
  const content = body['content'] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(content)) return '';

  const lines: string[] = [];
  for (const node of content) {
    const nodeContent = node['content'] as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(nodeContent)) {
      const texts: string[] = [];
      for (const child of nodeContent) {
        if (child['type'] === 'text' && typeof child['text'] === 'string') {
          texts.push(child['text']);
        }
      }
      lines.push(texts.join(''));
    } else {
      lines.push('');
    }
  }
  return lines.join('\n');
}

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading } = useNote(id ?? null);
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editVisibility, setEditVisibility] = useState<NoteVisibility>('private');

  const note = data?.data;

  const startEditing = useCallback(() => {
    if (!note) return;
    setEditTitle(note.title ?? '');
    setEditBody(extractPlainText(note.body));
    setEditVisibility(note.visibility);
    setIsEditing(true);
  }, [note]);

  const handleSave = useCallback(async () => {
    if (!id || editBody.trim().length === 0) return;

    const tiptapBody = {
      type: 'doc',
      content: editBody
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: line }],
        })),
    };

    try {
      await updateNote.mutateAsync({
        id,
        title: editTitle.trim() || undefined,
        body: tiptapBody,
        visibility: editVisibility,
      });
      setIsEditing(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update note';
      Alert.alert('Error', message);
    }
  }, [id, editTitle, editBody, editVisibility, updateNote]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete Note', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteNote.mutateAsync(id ?? '');
            router.back();
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Failed to delete';
            Alert.alert('Error', message);
          }
        },
      },
    ]);
  }, [id, deleteNote]);

  if (isLoading || !note) {
    return (
      <>
        <Stack.Screen options={{ title: 'Note' }} />
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color="#1a56db" />
        </View>
      </>
    );
  }

  const plainText = extractPlainText(note.body);

  return (
    <>
      <Stack.Screen
        options={{
          title: '',
          headerRight: () => (
            <View style={styles.headerActions}>
              {isEditing ? (
                <>
                  <TouchableOpacity
                    onPress={() => setIsEditing(false)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.cancelButton}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleSave}
                    disabled={updateNote.isPending || editBody.trim().length === 0}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text
                      style={[
                        styles.saveButton,
                        (updateNote.isPending || editBody.trim().length === 0) &&
                          styles.saveButtonDisabled,
                      ]}
                    >
                      {updateNote.isPending ? 'Saving...' : 'Save'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    onPress={startEditing}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="create-outline" size={20} color="#1a56db" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleDelete}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={20} color="#dc2626" />
                  </TouchableOpacity>
                </>
              )}
            </View>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {isEditing ? (
            <>
              <TextInput
                style={styles.editTitle}
                placeholder="Note title"
                placeholderTextColor="#9ca3af"
                value={editTitle}
                onChangeText={setEditTitle}
                maxLength={500}
              />
              <View style={styles.visibilityRow}>
                <TouchableOpacity
                  style={[
                    styles.toggleOption,
                    editVisibility === 'private' && styles.toggleOptionActive,
                  ]}
                  onPress={() => setEditVisibility('private')}
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={12}
                    color={editVisibility === 'private' ? '#fff' : '#6b7280'}
                  />
                  <Text
                    style={[
                      styles.toggleText,
                      editVisibility === 'private' && styles.toggleTextActive,
                    ]}
                  >
                    Private
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.toggleOption,
                    editVisibility === 'org' && styles.toggleOptionActive,
                  ]}
                  onPress={() => setEditVisibility('org')}
                >
                  <Ionicons
                    name="people-outline"
                    size={12}
                    color={editVisibility === 'org' ? '#fff' : '#6b7280'}
                  />
                  <Text
                    style={[
                      styles.toggleText,
                      editVisibility === 'org' && styles.toggleTextActive,
                    ]}
                  >
                    Org
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.editBody}
                value={editBody}
                onChangeText={setEditBody}
                multiline
                textAlignVertical="top"
                autoFocus
              />
            </>
          ) : (
            <>
              {/* Metadata */}
              <View style={styles.metaRow}>
                <View
                  style={[
                    styles.visibilityBadge,
                    note.visibility === 'org' ? styles.orgBadge : styles.privateBadge,
                  ]}
                >
                  <Ionicons
                    name={note.visibility === 'org' ? 'people-outline' : 'lock-closed-outline'}
                    size={10}
                    color={note.visibility === 'org' ? '#059669' : '#6b7280'}
                  />
                  <Text
                    style={[
                      styles.visibilityText,
                      note.visibility === 'org' ? { color: '#059669' } : { color: '#6b7280' },
                    ]}
                  >
                    {note.visibility === 'org' ? 'Organization' : 'Private'}
                  </Text>
                </View>
                <Text style={styles.dateText}>
                  Updated{' '}
                  {new Date(note.updatedAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </Text>
              </View>

              {note.matter ? (
                <TouchableOpacity
                  style={styles.matterLink}
                  onPress={() => router.push(`/workspace/matters/${note.matter!.id}`)}
                >
                  <Ionicons name="folder-outline" size={14} color="#1a56db" />
                  <Text style={styles.matterLinkText}>{note.matter.title}</Text>
                </TouchableOpacity>
              ) : null}

              {/* Title */}
              <Text style={styles.title}>{note.title ?? 'Untitled Note'}</Text>

              {/* Author */}
              <Text style={styles.author}>by {note.user.fullName}</Text>

              {/* Body */}
              <Text style={styles.body}>{plainText || 'No content'}</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { padding: 16 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  headerActions: {
    flexDirection: 'row',
    gap: 16,
    marginRight: 4,
  },
  saveButton: { fontSize: 16, fontWeight: '600', color: '#1a56db' },
  saveButtonDisabled: { color: '#9ca3af' },
  cancelButton: { fontSize: 16, color: '#6b7280' },

  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  visibilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  orgBadge: { backgroundColor: '#ecfdf5' },
  privateBadge: { backgroundColor: '#f3f4f6' },
  visibilityText: { fontSize: 11, fontWeight: '600' },
  dateText: { fontSize: 12, color: '#9ca3af' },

  matterLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#eff6ff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  matterLinkText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a56db',
  },

  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
    lineHeight: 28,
  },
  author: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 16,
  },
  body: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 24,
  },

  // Edit mode
  editTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    marginBottom: 8,
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  toggleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  toggleOptionActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280',
  },
  toggleTextActive: { color: '#fff' },
  editBody: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    lineHeight: 22,
    minHeight: 300,
    paddingTop: 0,
  },
});
