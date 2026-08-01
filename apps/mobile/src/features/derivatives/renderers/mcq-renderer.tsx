import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface McqOption {
  label: string;
  text: string;
  isCorrect: boolean;
  rationale?: string;
}

interface McqContent {
  questionStem?: string;
  options?: McqOption[];
  explanation?: string;
}

function isMcqContent(value: unknown): value is McqContent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (typeof v['questionStem'] === 'string' || v['questionStem'] === undefined) &&
    (Array.isArray(v['options']) || v['options'] === undefined)
  );
}

export function MCQRenderer({ data }: { data: DerivativeDetail }) {
  const [revealed, setRevealed] = useState(false);

  if (!isMcqContent(data.contentJson)) return <Unavailable />;
  const content = data.contentJson;
  const stem = content.questionStem ?? '';
  const options = content.options ?? [];
  const explanation = content.explanation ?? '';
  if (!stem || options.length === 0) return <Unavailable />;

  const showAnswer = !data.isGated && revealed;

  return (
    <View style={styles.article}>
      <Text style={styles.stem} accessibilityRole="header">
        {stem}
      </Text>

      <View style={styles.optionList}>
        {options.map((opt, idx) => (
          <View key={`${opt.label}-${idx}`} style={styles.option}>
            <View style={styles.optionRow}>
              <View style={styles.optionLabel}>
                <Text style={styles.optionLabelText}>{opt.label}</Text>
              </View>
              <View style={styles.optionBody}>
                <View style={styles.optionHeader}>
                  <Text style={styles.optionText}>{opt.text}</Text>
                  {showAnswer && opt.isCorrect ? (
                    <View style={styles.correctBadge}>
                      <Ionicons name="checkmark" size={10} color="#166534" />
                      <Text style={styles.correctBadgeText}>Correct</Text>
                    </View>
                  ) : null}
                </View>
                {showAnswer && opt.rationale ? (
                  <Text style={styles.rationale}>
                    <Text style={styles.rationaleLabel}>Rationale: </Text>
                    {opt.rationale}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        ))}
      </View>

      {data.isGated ? (
        <GatedNotice typeLabel="MCQ" />
      ) : (
        <View style={styles.controls}>
          <Pressable
            style={({ pressed }) => [
              styles.revealButton,
              pressed && styles.revealButtonPressed,
            ]}
            onPress={() => setRevealed((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide answer' : 'Reveal answer'}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={16}
              color="#1d4ed8"
            />
            <Text style={styles.revealButtonText}>
              {revealed ? 'Hide answer' : 'Reveal answer'}
            </Text>
          </Pressable>

          {revealed && explanation ? (
            <View style={styles.explanation}>
              <Text style={styles.explanationTitle} accessibilityRole="header">
                Explanation
              </Text>
              <Text style={styles.explanationText}>{explanation}</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  article: { gap: 16 },
  stem: { fontSize: 16, fontWeight: '700', color: '#111827', lineHeight: 22 },
  optionList: { gap: 8 },
  option: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
  },
  optionRow: { flexDirection: 'row', gap: 10 },
  optionLabel: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionLabelText: { fontSize: 13, fontWeight: '700', color: '#374151' },
  optionBody: { flex: 1, gap: 6 },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  optionText: { flex: 1, fontSize: 14, color: '#1f2937', lineHeight: 21 },
  correctBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#dcfce7',
    borderColor: '#16a34a',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  correctBadgeText: { fontSize: 11, fontWeight: '600', color: '#166534' },
  rationale: { fontSize: 12, color: '#6b7280', lineHeight: 18 },
  rationaleLabel: { fontWeight: '600' },
  controls: { gap: 10 },
  revealButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#1d4ed8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  revealButtonPressed: { opacity: 0.8 },
  revealButtonText: { color: '#1d4ed8', fontSize: 13, fontWeight: '600' },
  explanation: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  explanationTitle: { fontSize: 13, fontWeight: '700', color: '#111827' },
  explanationText: { fontSize: 13, color: '#4b5563', lineHeight: 19 },
});
