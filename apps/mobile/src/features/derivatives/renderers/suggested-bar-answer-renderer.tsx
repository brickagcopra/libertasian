import { StyleSheet, Text, View } from 'react-native';
import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface BarAnnotation {
  quote?: string;
  commentary?: string;
}

interface SuggestedBarAnswerContent {
  barYear?: number | string;
  examSubject?: string;
  questionText?: string;
  suggestedAnswer?: string;
  annotations?: BarAnnotation[];
  sourceAttribution?: string;
}

function asBarAnswer(value: unknown): SuggestedBarAnswerContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as SuggestedBarAnswerContent;
}

export function SuggestedBarAnswerRenderer({ data }: { data: DerivativeDetail }) {
  const content = asBarAnswer(data.contentJson);
  if (!content) return <Unavailable />;

  const question = content.questionText?.trim() ?? '';
  if (!question) return <Unavailable />;

  const answer = content.suggestedAnswer?.trim() ?? '';
  const annotations = (content.annotations ?? []).filter(
    (a) => a && (a.quote?.trim() || a.commentary?.trim()),
  );
  const examSubject = content.examSubject?.trim() ?? '';
  const hasExamMeta = Boolean(content.barYear) || Boolean(examSubject);

  return (
    <View style={styles.article}>
      {hasExamMeta ? (
        <View style={styles.chipRow}>
          {content.barYear ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{`Bar ${content.barYear}`}</Text>
            </View>
          ) : null}
          {examSubject ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{examSubject}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.headingH3} accessibilityRole="header">
          Question
        </Text>
        <Text style={styles.para}>{question}</Text>
      </View>

      {data.isGated ? (
        <GatedNotice typeLabel="Suggested bar answer" upgradeTier={data.upgradeTier} />
      ) : (
        <>
          {answer ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                Suggested Answer
              </Text>
              <Text style={styles.para}>{answer}</Text>
            </View>
          ) : null}

          {annotations.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                Annotations
              </Text>
              <View style={styles.annotationList}>
                {annotations.map((a, i) => (
                  <View key={`anno-${i}`} style={styles.annotationCard}>
                    {a.quote?.trim() ? (
                      <View style={styles.quote}>
                        <Text style={styles.quoteText}>{a.quote}</Text>
                      </View>
                    ) : null}
                    {a.commentary?.trim() ? (
                      <Text style={styles.commentary}>{a.commentary}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </>
      )}

      {content.sourceAttribution?.trim() ? (
        <Text style={styles.muted}>{`Source: ${content.sourceAttribution}`}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  article: { gap: 16 },
  section: { gap: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  chipText: { fontSize: 11, fontWeight: '600', color: '#374151' },
  headingH3: { fontSize: 17, fontWeight: '700', color: '#111827' },
  para: { fontSize: 14, color: '#1f2937', lineHeight: 21 },
  annotationList: { gap: 8 },
  annotationCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fafafa',
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: '#93c5fd',
    paddingLeft: 10,
  },
  quoteText: { fontSize: 13, fontStyle: 'italic', color: '#6b7280', lineHeight: 19 },
  commentary: { fontSize: 13, color: '#1f2937', lineHeight: 20 },
  muted: { fontSize: 11, color: '#6b7280', marginTop: 4 },
});
