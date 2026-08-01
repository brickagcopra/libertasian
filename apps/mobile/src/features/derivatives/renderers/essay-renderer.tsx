import { StyleSheet, Text, View } from 'react-native';
import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface OutlineSection {
  heading?: string;
  paragraphs?: string[];
  citedSectionIds?: string[];
}

interface RubricCriterion {
  name?: string;
  maxPoints?: number;
  description?: string;
}

interface EssayContent {
  promptText?: string;
  suggestedTimeMinutes?: number;
  modelAnswer?: { outlineSections?: OutlineSection[] };
  rubric?: { totalPoints?: number; criteria?: RubricCriterion[] };
}

function asEssay(value: unknown): EssayContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as EssayContent;
}

export function EssayRenderer({ data }: { data: DerivativeDetail }) {
  const content = asEssay(data.contentJson);
  if (!content) return <Unavailable />;
  const prompt = content.promptText ?? '';
  if (!prompt) return <Unavailable />;

  const outline = content.modelAnswer?.outlineSections ?? [];
  const rubric = content.rubric;

  return (
    <View style={styles.article}>
      <View style={styles.section}>
        <Text style={styles.headingH3} accessibilityRole="header">
          Prompt
        </Text>
        <Text style={styles.para}>{prompt}</Text>
        {content.suggestedTimeMinutes ? (
          <Text style={styles.muted}>
            Suggested time: {content.suggestedTimeMinutes} minutes
          </Text>
        ) : null}
      </View>

      {data.isGated ? (
        <GatedNotice typeLabel="Essay prompt" />
      ) : (
        <>
          {outline.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                Model Answer
              </Text>
              {outline.map((sec, i) => (
                <View key={`${sec.heading ?? 'section'}-${i}`} style={styles.subSection}>
                  <Text style={styles.headingH4} accessibilityRole="header">
                    {sec.heading ?? `Section ${i + 1}`}
                  </Text>
                  {(sec.paragraphs ?? []).map((p, j) => (
                    <Text key={`p-${i}-${j}`} style={styles.para}>
                      {p}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          ) : null}

          {rubric && (rubric.criteria ?? []).length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                Rubric
                {rubric.totalPoints ? ` (${rubric.totalPoints} pts)` : ''}
              </Text>
              <View style={styles.criteriaList}>
                {(rubric.criteria ?? []).map((c, i) => (
                  <View key={`c-${i}`} style={styles.criterion}>
                    <View style={styles.criterionHeader}>
                      <Text style={styles.criterionName}>
                        {c.name ?? `Criterion ${i + 1}`}
                      </Text>
                      {c.maxPoints != null ? (
                        <Text style={styles.muted}>{c.maxPoints} pts</Text>
                      ) : null}
                    </View>
                    {c.description ? (
                      <Text style={styles.criterionDescription}>{c.description}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  article: { gap: 16 },
  section: { gap: 8 },
  subSection: { gap: 6, marginTop: 8 },
  headingH3: { fontSize: 17, fontWeight: '700', color: '#111827' },
  headingH4: { fontSize: 15, fontWeight: '600', color: '#111827' },
  para: { fontSize: 14, color: '#1f2937', lineHeight: 21 },
  muted: { fontSize: 12, color: '#6b7280' },
  criteriaList: { gap: 8 },
  criterion: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  criterionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  criterionName: { fontSize: 13, fontWeight: '600', color: '#111827' },
  criterionDescription: { fontSize: 12, color: '#6b7280', lineHeight: 18 },
});
