import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useBarExamAnswer } from '../hooks/use-bar-exams';
import { AudioPlayerBar } from '../../audio/components/AudioPlayerBar';
import { GatedNotice } from '../../derivatives/renderers/gated-notice';
import { ApiClientError } from '../../../lib/api-client';
import type { BarExamAnswer, BarExamAnswerStructured } from '../types';

interface Props {
  questionId: string;
}

/**
 * Per-question "Model Answer (AI)" accordion. Collapsed by default; only when
 * the user expands it does the quota-consuming GET fire — the hook is gated
 * on `enabled: isExpanded`. Mirrors the web behaviour at
 * apps/web/src/features/bar-exams/hooks/use-bar-exam-answer.ts.
 */
export function BarExamAnswerAccordion({ questionId }: Props) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data, isLoading, error } = useBarExamAnswer(questionId, {
    enabled: isExpanded,
  });

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={styles.toggle}
        onPress={() => setIsExpanded((v) => !v)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
      >
        <Ionicons name="sparkles-outline" size={16} color="#1a56db" />
        <Text style={styles.toggleLabel}>Model Answer (AI)</Text>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color="#6b7280"
        />
      </TouchableOpacity>

      {isExpanded ? (
        <View style={styles.body}>
          {isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#1a56db" />
              <Text style={styles.loadingText}>Loading model answer…</Text>
            </View>
          ) : error ? (
            <AnswerError error={error} />
          ) : data ? (
            <AnswerBody answer={data} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function AnswerBody({ answer }: { answer: BarExamAnswer }) {
  const structured = answer.structuredAnswerJson;
  const modelName = answer.modelRun?.modelName ?? null;

  return (
    <View style={styles.answerStack}>
      {structured ? (
        <StructuredAnswer alac={structured} />
      ) : (
        <Text style={styles.plainAnswer}>{answer.answerText}</Text>
      )}

      {/* Listen — bar-answer audio is Pro-gated server-side; the player renders
          the upsell itself when the audio endpoint answers 402. Mirrors
          apps/web .../bar-exams/[year]/[subjectCode]/page.tsx AnswerBody. */}
      <AudioPlayerBar contentType="bar_exam_answer" contentId={answer.id} />

      <View style={styles.disclaimer}>
        <Ionicons
          name="information-circle-outline"
          size={14}
          color="#92400e"
        />
        <Text style={styles.disclaimerText}>
          AI-generated, editorially reviewed. Verify with official sources.
        </Text>
      </View>

      {modelName ? (
        <View style={styles.modelBadge}>
          <Text style={styles.modelBadgeText}>Model: {modelName}</Text>
        </View>
      ) : null}
    </View>
  );
}

const ALAC_SECTIONS: Array<{
  key: keyof BarExamAnswerStructured;
  label: string;
}> = [
  { key: 'answer', label: 'Answer' },
  { key: 'law', label: 'Law' },
  { key: 'analysis', label: 'Analysis' },
  { key: 'conclusion', label: 'Conclusion' },
];

function StructuredAnswer({ alac }: { alac: BarExamAnswerStructured }) {
  return (
    <View style={styles.alacStack}>
      {ALAC_SECTIONS.map((section) => {
        const value = alac[section.key];
        if (!value) return null;
        return (
          <View key={section.key} style={styles.alacBlock}>
            <Text style={styles.alacLabel}>{section.label}</Text>
            <Text style={styles.alacBody}>{value}</Text>
          </View>
        );
      })}
    </View>
  );
}

function AnswerError({ error }: { error: unknown }) {
  if (!(error instanceof ApiClientError)) {
    return (
      <Text style={styles.genericError}>
        Couldn&apos;t load the model answer. Please try again.
      </Text>
    );
  }

  switch (error.statusCode) {
    case 404:
      return (
        <Text style={styles.neutral}>
          No model answer available for this question yet.
        </Text>
      );
    case 402:
      return <GatedNotice typeLabel="AI model answer" />;
    case 429:
      return (
        <Text style={styles.neutral}>
          You&apos;ve reached your AI answer limit for now. Try again later.
        </Text>
      );
    case 401:
      return (
        <TouchableOpacity
          onPress={() => router.push('/(auth)/login')}
          style={styles.signInRow}
        >
          <Text style={styles.signInText}>
            Sign in again to view the model answer.
          </Text>
        </TouchableOpacity>
      );
    default:
      return (
        <Text style={styles.genericError}>
          Couldn&apos;t load the model answer. Please try again.
        </Text>
      );
  }
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    paddingTop: 10,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  toggleLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#1a56db',
  },
  body: {
    marginTop: 8,
    paddingTop: 4,
  },
  answerStack: { gap: 10 },
  alacStack: { gap: 12 },
  alacBlock: { gap: 4 },
  alacLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#1a56db',
  },
  alacBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#111827',
  },
  plainAnswer: {
    fontSize: 14,
    lineHeight: 21,
    color: '#111827',
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 8,
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  disclaimerText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    color: '#92400e',
  },
  modelBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  modelBadgeText: {
    fontSize: 11,
    color: '#6b7280',
    fontWeight: '500',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#6b7280',
  },
  neutral: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 19,
  },
  genericError: {
    fontSize: 13,
    color: '#991b1b',
    lineHeight: 19,
  },
  signInRow: {
    paddingVertical: 4,
  },
  signInText: {
    fontSize: 13,
    color: '#1a56db',
    fontWeight: '600',
  },
});
