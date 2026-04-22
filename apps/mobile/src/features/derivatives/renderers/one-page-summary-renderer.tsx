import { StyleSheet, Text, View } from 'react-native';
import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface SummaryHighlight {
  term?: string;
  definition?: string;
}

interface QuickReferenceRow {
  label?: string;
  value?: string;
}

interface OnePageSummaryContent {
  topic?: string;
  bottomLine?: string;
  keyPoints?: string[];
  highlights?: SummaryHighlight[];
  quickReference?: QuickReferenceRow[];
}

function asSummary(value: unknown): OnePageSummaryContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as OnePageSummaryContent;
}

export function OnePageSummaryRenderer({ data }: { data: DerivativeDetail }) {
  const content = asSummary(data.contentJson);
  if (!content) return <Unavailable />;

  const bottomLine = content.bottomLine?.trim() ?? '';
  if (!bottomLine) return <Unavailable />;

  const keyPoints = (content.keyPoints ?? []).filter((p) => p?.trim());
  const highlights = (content.highlights ?? []).filter(
    (h) => h && (h.term?.trim() || h.definition?.trim()),
  );
  const quickRef = (content.quickReference ?? []).filter(
    (r) => r && (r.label?.trim() || r.value?.trim()),
  );

  return (
    <View style={styles.article}>
      {content.topic?.trim() ? (
        <Text style={styles.topic}>{content.topic}</Text>
      ) : null}

      <View style={styles.bottomLineBox}>
        <Text style={styles.bottomLineLabel}>Bottom Line</Text>
        <Text style={styles.bottomLineText}>{bottomLine}</Text>
      </View>

      {data.isGated ? (
        <GatedNotice typeLabel="One-page summary" upgradeTier={data.upgradeTier} />
      ) : (
        <>
          {keyPoints.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                Key Points
              </Text>
              <View style={styles.orderedList}>
                {keyPoints.map((p, i) => (
                  <View key={`kp-${i}`} style={styles.orderedRow}>
                    <Text style={styles.orderedIndex}>{`${i + 1}.`}</Text>
                    <Text style={styles.orderedText}>{p}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {highlights.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                Highlights
              </Text>
              <View style={styles.highlightList}>
                {highlights.map((h, i) => (
                  <View key={`hl-${i}`} style={styles.highlightCard}>
                    {h.term?.trim() ? (
                      <Text style={styles.highlightTerm}>{h.term}</Text>
                    ) : null}
                    {h.definition?.trim() ? (
                      <Text style={styles.highlightDefinition}>{h.definition}</Text>
                    ) : null}
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {quickRef.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.headingH3} accessibilityRole="header">
                Quick Reference
              </Text>
              <View style={styles.refTable}>
                {quickRef.map((row, i) => (
                  <View key={`qr-${i}`} style={styles.refRow}>
                    <Text style={styles.refLabel}>{row.label ?? '—'}</Text>
                    <Text style={styles.refValue}>{row.value ?? ''}</Text>
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
  topic: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  bottomLineBox: {
    borderWidth: 2,
    borderColor: 'rgba(59, 130, 246, 0.5)',
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  bottomLineLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#2563eb',
    textTransform: 'uppercase',
  },
  bottomLineText: { fontSize: 16, fontWeight: '600', color: '#111827', lineHeight: 22 },
  headingH3: { fontSize: 17, fontWeight: '700', color: '#111827' },
  orderedList: { gap: 6 },
  orderedRow: { flexDirection: 'row', gap: 8 },
  orderedIndex: { fontSize: 14, color: '#6b7280', lineHeight: 21, minWidth: 24 },
  orderedText: { flex: 1, fontSize: 14, color: '#1f2937', lineHeight: 21 },
  highlightList: { gap: 8 },
  highlightCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  highlightTerm: { fontSize: 13, fontWeight: '700', color: '#111827' },
  highlightDefinition: { fontSize: 13, color: '#6b7280', lineHeight: 20 },
  refTable: { gap: 0 },
  refRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 8,
    gap: 12,
  },
  refLabel: { fontSize: 13, fontWeight: '700', color: '#111827', minWidth: 100 },
  refValue: { flex: 1, fontSize: 13, color: '#1f2937' },
});
