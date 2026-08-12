import { View, Text, StyleSheet } from 'react-native';

import type { AiAnswerSource } from '../../search/types';

/**
 * One retrieved passage, rendered as a citation card.
 *
 * Lifted verbatim out of `features/search/components/ai-summary-results.tsx`
 * so the reader's document chat cites sources identically to the search
 * summary instead of growing a second card. Styles are unchanged from that
 * file, which is why they are literal hex rather than theme tokens — making it
 * theme-aware would change the search screen's appearance and belongs in its
 * own change.
 */
export function SourceCard({ source, index }: { source: AiAnswerSource; index: number }) {
  return (
    <View style={styles.sourceCard} key={source.section_id ?? source.document_id + index}>
      <Text style={styles.sourceTitle} numberOfLines={2}>
        {source.title}
      </Text>
      <View style={styles.sourceMeta}>
        {source.citation_text ? (
          <Text style={styles.sourceMetaText}>{source.citation_text}</Text>
        ) : null}
        {source.gr_no ? <Text style={styles.sourceMetaText}>{source.gr_no}</Text> : null}
        {source.court ? (
          <Text style={styles.sourceMetaText}>{source.court.replace(/_/g, ' ')}</Text>
        ) : null}
      </View>
      {source.passage_text ? (
        <Text style={styles.sourcePassage} numberOfLines={3}>
          {source.passage_text}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sourceCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 10,
  },
  sourceTitle: { fontSize: 13, fontWeight: '600', color: '#1a56db' },
  sourceMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  sourceMetaText: { fontSize: 11, color: '#6b7280' },
  sourcePassage: { fontSize: 12, color: '#6b7280', marginTop: 6, lineHeight: 18 },
});
