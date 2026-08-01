import { StyleSheet, Text, View } from 'react-native';
import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface OutlineSection {
  heading?: string;
  paragraphs?: string[];
  citedSectionIds?: string[];
}

interface EssayModelAnswerContent {
  promptRef?: string;
  format?: string;
  answer?: { outlineSections?: OutlineSection[] };
  writingTips?: string[];
  commonPitfalls?: string[];
}

function asEssayModelAnswer(value: unknown): EssayModelAnswerContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as EssayModelAnswerContent;
}

const ALAC_HEADINGS = ['Answer', 'Law', 'Analysis', 'Conclusion'] as const;

function labelForAlacSection(index: number, heading?: string): string {
  if (heading && heading.trim()) return heading;
  return ALAC_HEADINGS[index] ?? `Section ${index + 1}`;
}

export function EssayModelAnswerRenderer({ data }: { data: DerivativeDetail }) {
  const content = asEssayModelAnswer(data.contentJson);
  if (!content) return <Unavailable />;

  const promptRef = content.promptRef?.trim() ?? '';
  const outline = content.answer?.outlineSections ?? [];
  const writingTips = (content.writingTips ?? []).filter((t) => t?.trim());
  const pitfalls = (content.commonPitfalls ?? []).filter((p) => p?.trim());
  const isAlac = content.format === 'alac';

  if (!promptRef && outline.length === 0) return <Unavailable />;

  return (
    <View style={styles.article}>
      {promptRef ? (
        <View style={styles.section}>
          <Text style={styles.headingH3} accessibilityRole="header">
            Prompt Reference
          </Text>
          <Text style={styles.muted}>{promptRef}</Text>
        </View>
      ) : null}

      {data.isGated ? (
        <GatedNotice typeLabel="Model Answer" />
      ) : (
        <>
          {outline.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                {`Model Answer${isAlac ? ' (ALAC Format)' : ''}`}
              </Text>
              {outline.map((sec, i) => (
                <View key={`alac-${i}`} style={styles.subSection}>
                  <Text style={styles.headingH4} accessibilityRole="header">
                    {isAlac
                      ? labelForAlacSection(i, sec.heading)
                      : sec.heading ?? `Section ${i + 1}`}
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

          {writingTips.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                Writing Tips
              </Text>
              <View style={styles.bulletList}>
                {writingTips.map((tip, i) => (
                  <View key={`tip-${i}`} style={styles.bulletRow}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.bulletText}>{tip}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {pitfalls.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                Common Pitfalls
              </Text>
              <View style={styles.bulletList}>
                {pitfalls.map((pit, i) => (
                  <View key={`pit-${i}`} style={styles.bulletRow}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.bulletText}>{pit}</Text>
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
  muted: { fontSize: 13, color: '#6b7280', lineHeight: 20 },
  bulletList: { gap: 4, paddingLeft: 4 },
  bulletRow: { flexDirection: 'row', gap: 8 },
  bullet: { fontSize: 14, color: '#1f2937', lineHeight: 21 },
  bulletText: { flex: 1, fontSize: 14, color: '#1f2937', lineHeight: 21 },
});
