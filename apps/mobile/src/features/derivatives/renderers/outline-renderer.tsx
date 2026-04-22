import { StyleSheet, Text, View } from 'react-native';
import type { DerivativeDetail } from '../types';
import { Unavailable } from './unavailable';

interface OutlineSubSection {
  heading?: string;
  paragraphs?: string[];
}

interface OutlineSection {
  heading?: string;
  subjectTopicCode?: string;
  paragraphs?: string[];
  subSections?: OutlineSubSection[];
}

interface OutlineContent {
  sections?: OutlineSection[];
  topic?: string;
}

function asOutline(value: unknown): OutlineContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as OutlineContent;
}

export function OutlineRenderer({ data }: { data: DerivativeDetail }) {
  const content = asOutline(data.contentJson);
  const sections = content?.sections ?? [];
  if (sections.length === 0) return <Unavailable />;

  return (
    <View style={styles.article}>
      {content?.topic ? <Text style={styles.topic}>{content.topic}</Text> : null}
      {sections.map((sec, i) => (
        <View key={`s-${i}`} style={styles.section}>
          <Text style={styles.headingH3} accessibilityRole="header">
            {sec.heading ?? `Section ${i + 1}`}
          </Text>
          {(sec.paragraphs ?? []).map((p, j) => (
            <Text key={`p-${i}-${j}`} style={styles.para}>
              {p}
            </Text>
          ))}
          {(sec.subSections ?? []).map((sub, k) => (
            <View key={`sub-${i}-${k}`} style={styles.subSection}>
              <Text style={styles.headingH4} accessibilityRole="header">
                {sub.heading ?? `Subsection ${k + 1}`}
              </Text>
              {(sub.paragraphs ?? []).map((p, m) => (
                <Text key={`subp-${i}-${k}-${m}`} style={styles.para}>
                  {p}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  article: { gap: 18 },
  topic: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  section: { gap: 6 },
  subSection: {
    gap: 6,
    marginTop: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#e5e7eb',
    paddingLeft: 12,
  },
  headingH3: { fontSize: 17, fontWeight: '700', color: '#111827' },
  headingH4: { fontSize: 15, fontWeight: '600', color: '#111827' },
  para: { fontSize: 14, color: '#1f2937', lineHeight: 21 },
});
