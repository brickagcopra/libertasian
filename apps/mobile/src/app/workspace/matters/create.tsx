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
import { useCreateMatter } from '../../../features/workspace/hooks/use-matters';
import type { MatterType } from '../../../features/workspace/types';

const MATTER_TYPES: { label: string; value: MatterType }[] = [
  { label: 'Civil', value: 'civil' },
  { label: 'Criminal', value: 'criminal' },
  { label: 'Labor', value: 'labor' },
  { label: 'Commercial', value: 'commercial' },
  { label: 'Administrative', value: 'administrative' },
  { label: 'Special Proceedings', value: 'special_proceedings' },
  { label: 'Other', value: 'other' },
];

export default function CreateMatterScreen() {
  const createMatter = useCreateMatter();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [matterType, setMatterType] = useState<MatterType | ''>('');
  const [court, setCourt] = useState('');

  const canSubmit = title.trim().length > 0 && !createMatter.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      await createMatter.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        matterType: matterType || undefined,
        court: court.trim() || undefined,
      });
      router.back();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to create matter';
      Alert.alert('Error', message);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'New Matter',
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
                {createMatter.isPending ? 'Saving...' : 'Save'}
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
          <View style={styles.field}>
            <Text style={styles.label}>Title *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Reyes v. Santos"
              placeholderTextColor="#9ca3af"
              value={title}
              onChangeText={setTitle}
              maxLength={500}
              autoFocus
            />
          </View>

          {/* Description */}
          <View style={styles.field}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Brief description of the matter..."
              placeholderTextColor="#9ca3af"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          </View>

          {/* Matter Type */}
          <View style={styles.field}>
            <Text style={styles.label}>Type</Text>
            <View style={styles.chipGrid}>
              {MATTER_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={[
                    styles.chip,
                    matterType === t.value && styles.chipActive,
                  ]}
                  onPress={() =>
                    setMatterType(matterType === t.value ? '' : t.value)
                  }
                >
                  <Text
                    style={[
                      styles.chipText,
                      matterType === t.value && styles.chipTextActive,
                    ]}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Court */}
          <View style={styles.field}>
            <Text style={styles.label}>Court</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. RTC Branch 123, Manila"
              placeholderTextColor="#9ca3af"
              value={court}
              onChangeText={setCourt}
              maxLength={255}
            />
          </View>

          {createMatter.error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#dc2626" />
              <Text style={styles.errorText}>
                {createMatter.error instanceof Error
                  ? createMatter.error.message
                  : 'Failed to create matter'}
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  scrollContent: { padding: 16, gap: 16 },

  saveButton: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a56db',
    marginRight: 4,
  },
  saveButtonDisabled: { color: '#9ca3af' },

  field: { gap: 6 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  textArea: {
    minHeight: 100,
    paddingTop: 10,
  },

  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  chipActive: {
    backgroundColor: '#1a56db',
    borderColor: '#1a56db',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
  },
  chipTextActive: { color: '#fff' },

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
