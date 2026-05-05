import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { useCreateResearchWorkspace } from '../../../features/research-workspaces/hooks/use-research-workspaces';

export default function CreateResearchWorkspaceScreen() {
  const createWorkspace = useCreateResearchWorkspace();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const canSubmit = title.trim().length > 0 && !createWorkspace.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      const result = await createWorkspace.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
      });
      if (result?.id) {
        router.replace(`/workspace/research-workspaces/${result.id}`);
      } else {
        router.back();
      }
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to create workspace',
      );
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'New Research Workspace',
          headerRight: () => (
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={!canSubmit}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text
                style={[
                  styles.submitText,
                  !canSubmit && styles.submitTextDisabled,
                ]}
              >
                {createWorkspace.isPending ? 'Creating...' : 'Create'}
              </Text>
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title */}
          <View style={styles.field}>
            <Text style={styles.label}>Workspace Title *</Text>
            <TextInput
              style={styles.textInput}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Labor Law Research — Constructive Dismissal"
              placeholderTextColor="#9ca3af"
              editable={!createWorkspace.isPending}
            />
          </View>

          {/* Description */}
          <View style={styles.field}>
            <Text style={styles.label}>Description (Optional)</Text>
            <TextInput
              style={[styles.textInput, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Describe the research topic or context..."
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              editable={!createWorkspace.isPending}
            />
          </View>

          {/* Info */}
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              A research workspace maintains persistent AI context across
              multiple queries. Pin relevant documents, add notes, and ask
              follow-up questions that build on previous answers.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  scrollView: { flex: 1 },
  content: { padding: 16, gap: 20 },

  submitText: { fontSize: 16, fontWeight: '600', color: '#1a56db' },
  submitTextDisabled: { color: '#9ca3af' },

  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151' },

  textInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 12,
    fontSize: 14,
    color: '#111827',
  },
  textArea: {
    minHeight: 100,
  },

  infoCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  infoText: { fontSize: 12, color: '#1e40af', lineHeight: 18 },
});
