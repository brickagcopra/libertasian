import { StyleSheet, Text, View } from 'react-native';
import type { DerivativeDetail } from '../types';
import { Unavailable } from './unavailable';

interface DoctrineEntry {
  text?: string;
  doctrine_type?: string;
  doctrineType?: string;
  normalized_text?: string;
  normalizedText?: string;
  confidence?: number;
}

interface DoctrineContent {
  doctrines?: DoctrineEntry[];
}

function asDoctrine(value: unknown): DoctrineContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as DoctrineContent;
}

export function DoctrineRenderer({ data }: { data: DerivativeDetail }) {
  const content = asDoctrine(data.contentJson);
  const entries = content?.doctrines ?? [];
  if (entries.length === 0) return <Unavailable />;

  return (
    <View style={styles.list}>
      {entries.map((d, i) => {
        const text = d.text ?? '';
        if (!text) return null;
        const type = d.doctrineType ?? d.doctrine_type;
        const normalized = d.normalizedText ?? d.normalized_text;
        return (
          <View key={`d-${i}`} style={styles.item}>
            <View style={styles.row}>
              <Text style={styles.index}>{i + 1}.</Text>
              <View style={styles.body}>
                <Text style={styles.text}>{text}</Text>
                {normalized && normalized !== text ? (
                  <Text style={styles.normalized}>
                    <Text style={styles.normalizedLabel}>Normalized: </Text>
                    {normalized}
                  </Text>
                ) : null}
                <View style={styles.chipRow}>
                  {type ? (
                    <View style={styles.chip}>
                      <Text style={styles.chipText}>{type}</Text>
                    </View>
                  ) : null}
                  {typeof d.confidence === 'number' ? (
                    <View style={styles.chip}>
                      <Text style={styles.chipText}>
                        {Math.round(d.confidence * 100)}% confidence
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  item: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    padding: 12,
  },
  row: { flexDirection: 'row', gap: 8 },
  index: { fontSize: 14, color: '#6b7280', lineHeight: 21, minWidth: 24 },
  body: { flex: 1, gap: 8 },
  text: { fontSize: 14, fontWeight: '600', color: '#111827', lineHeight: 21 },
  normalized: { fontSize: 12, color: '#6b7280', lineHeight: 18 },
  normalizedLabel: { fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: { fontSize: 11, color: '#6b7280' },
});
