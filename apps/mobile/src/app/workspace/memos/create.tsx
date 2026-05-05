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
import { useGenerateMemo } from '../../../features/memos/hooks/use-memos';
import { MEMO_TYPE_LABELS } from '../../../features/memos/types';
import type { MemoType } from '../../../features/memos/types';

const MEMO_TYPES: { value: MemoType; label: string; description: string }[] = [
  {
    value: 'legal_opinion',
    label: 'Legal Opinion',
    description: 'Analysis of facts, applicable laws, and recommendation',
  },
  {
    value: 'case_analysis',
    label: 'Case Analysis',
    description: 'Deep dive into a specific case or set of cases',
  },
  {
    value: 'statutory_analysis',
    label: 'Statutory Analysis',
    description: 'Interpretation and application of statutory provisions',
  },
  {
    value: 'comparative',
    label: 'Comparative',
    description: 'Compare positions across multiple authorities',
  },
  {
    value: 'research_summary',
    label: 'Research Summary',
    description: 'Overview of findings on a legal topic',
  },
];

export default function CreateMemoScreen() {
  const generateMemo = useGenerateMemo();
  const [query, setQuery] = useState('');
  const [memoType, setMemoType] = useState<MemoType>('legal_opinion');

  const canSubmit = query.trim().length >= 10 && !generateMemo.isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    try {
      const result = await generateMemo.mutateAsync({
        query: query.trim(),
        memoType,
      });
      if (result?.id) {
        router.replace(`/workspace/memos/${result.id}`);
      } else {
        router.back();
      }
    } catch (err) {
      Alert.alert(
        'Error',
        err instanceof Error ? err.message : 'Failed to generate memo',
      );
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Generate Memo',
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
                {generateMemo.isPending ? 'Generating...' : 'Generate'}
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
          {/* Query */}
          <View style={styles.field}>
            <Text style={styles.label}>Research Question</Text>
            <TextInput
              style={styles.textArea}
              value={query}
              onChangeText={setQuery}
              placeholder="e.g., What are the legal requirements for constructive dismissal under Philippine labor law?"
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              maxLength={2000}
              editable={!generateMemo.isPending}
            />
            <Text style={styles.charCount}>{query.length}/2000 (min 10)</Text>
          </View>

          {/* Memo Type */}
          <View style={styles.field}>
            <Text style={styles.label}>Memo Type</Text>
            {MEMO_TYPES.map((type) => (
              <TouchableOpacity
                key={type.value}
                style={[
                  styles.typeOption,
                  memoType === type.value && styles.typeOptionActive,
                ]}
                onPress={() => setMemoType(type.value)}
                disabled={generateMemo.isPending}
              >
                <View style={styles.typeRadio}>
                  <View
                    style={[
                      styles.typeRadioInner,
                      memoType === type.value && styles.typeRadioInnerActive,
                    ]}
                  />
                </View>
                <View style={styles.typeContent}>
                  <Text
                    style={[
                      styles.typeLabel,
                      memoType === type.value && styles.typeLabelActive,
                    ]}
                  >
                    {type.label}
                  </Text>
                  <Text style={styles.typeDescription}>{type.description}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Info */}
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              The AI will generate a structured legal memo with citations from
              the Philippine legal corpus. Generation may take up to 30 seconds.
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
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  textArea: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    lineHeight: 20,
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  charCount: { fontSize: 11, color: '#9ca3af', textAlign: 'right' },

  typeOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 10,
  },
  typeOptionActive: {
    borderColor: '#1a56db',
    backgroundColor: '#eff6ff',
  },
  typeRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  typeRadioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'transparent',
  },
  typeRadioInnerActive: { backgroundColor: '#1a56db' },
  typeContent: { flex: 1 },
  typeLabel: { fontSize: 14, fontWeight: '600', color: '#374151' },
  typeLabelActive: { color: '#1e40af' },
  typeDescription: { fontSize: 12, color: '#9ca3af', marginTop: 2, lineHeight: 16 },

  infoCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  infoText: { fontSize: 12, color: '#1e40af', lineHeight: 18 },
});
