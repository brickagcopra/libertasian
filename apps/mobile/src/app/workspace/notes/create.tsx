import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCreateNote } from '../../../features/workspace/hooks/use-notes';
import type { NoteVisibility } from '../../../features/workspace/types';

export default function CreateNoteScreen() {
  const createNote = useCreateNote();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<NoteVisibility>('private');

  const canSubmit = body.trim().length > 0 && !createNote.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    // Build a simple Tiptap-compatible doc structure
    const tiptapBody = {
      type: 'doc',
      content: body
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => ({
          type: 'paragraph',
          content: [{ type: 'text', text: line }],
        })),
    };

    try {
      await createNote.mutateAsync({
        title: title.trim() || undefined,
        body: tiptapBody,
        visibility,
      });
      router.back();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create note';
      Alert.alert('Error', message);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'New Note',
          headerRight: () => (
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={!canSubmit}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text
                style={[
                  styles.saveButton,
                  !canSubmit && styles.saveButtonDisabled,
                ]}
              >
                {createNote.isPending ? 'Saving...' : 'Save'}
              </Text>
            </TouchableOpacity>
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
          {/* Title */}
          <TextInput
            style={styles.titleInput}
            placeholder="Note title (optional)"
            placeholderTextColor="#9ca3af"
            value={title}
            onChangeText={setTitle}
            maxLength={500}
          />

          {/* Visibility Toggle */}
          <View style={styles.visibilityRow}>
            <Text style={styles.label}>Visibility</Text>
            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[
                  styles.toggleOption,
                  visibility === 'private' && styles.toggleOptionActive,
                ]}
                onPress={() => setVisibility('private')}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={14}
                  color={visibility === 'private' ? '#fff' : '#6b7280'}
                />
                <Text
                  style={[
                    styles.toggleText,
                    visibility === 'private' && styles.toggleTextActive,
                  ]}
                >
                  Private
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleOption,
                  visibility === 'org' && styles.toggleOptionActive,
                ]}
                onPress={() => setVisibility('org')}
              >
                <Ionicons
                  name="people-outline"
                  size={14}
                  color={visibility === 'org' ? '#fff' : '#6b7280'}
                />
                <Text
                  style={[
                    styles.toggleText,
                    visibility === 'org' && styles.toggleTextActive,
                  ]}
                >
                  Organization
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Body */}
          <TextInput
            style={styles.bodyInput}
            placeholder="Write your note here..."
            placeholderTextColor="#9ca3af"
            value={body}
            onChangeText={setBody}
            multiline
            textAlignVertical="top"
            autoFocus
          />

          {createNote.error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#dc2626" />
              <Text style={styles.errorText}>
                {createNote.error instanceof Error
                  ? createNote.error.message
                  : 'Failed to create note'}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { padding: 16, gap: 12 },

  saveButton: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a56db',
    marginRight: 4,
  },
  saveButtonDisabled: { color: '#9ca3af' },

  titleInput: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },

  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  visibilityRow: {
    gap: 6,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  toggleOptionActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  toggleText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6b7280',
  },
  toggleTextActive: { color: '#fff' },

  bodyInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    lineHeight: 22,
    minHeight: 200,
    paddingTop: 8,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#dc2626',
  },
});
