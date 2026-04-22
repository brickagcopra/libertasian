import { StyleSheet, Text, View } from 'react-native';
import type { DerivativeDetail } from '../types';
import { Unavailable } from './unavailable';

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function renderValue(value: unknown, depth = 0): React.ReactNode {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return <Text style={styles.para}>{trimmed}</Text>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <Text style={styles.para}>{String(value)}</Text>;
  }
  if (Array.isArray(value)) {
    const items = value.filter((x) => x !== null && x !== undefined && x !== '');
    if (items.length === 0) return null;
    const allScalar = items.every(
      (x) => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean',
    );
    if (allScalar) {
      return (
        <View style={styles.bulletList}>
          {items.map((x, i) => (
            <View key={i} style={styles.bulletRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.bulletText}>{String(x)}</Text>
            </View>
          ))}
        </View>
      );
    }
    return (
      <View style={styles.orderedList}>
        {items.map((x, i) => (
          <View key={i} style={styles.orderedRow}>
            <Text style={styles.orderedIndex}>{i + 1}.</Text>
            <View style={styles.orderedBody}>{renderValue(x, depth + 1)}</View>
          </View>
        ))}
      </View>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined && v !== '',
    );
    if (entries.length === 0) return null;
    return (
      <View style={styles.sectionList}>
        {entries.map(([key, val]) => (
          <View key={key} style={styles.section}>
            <Text
              style={depth === 0 ? styles.headingH3 : styles.headingH4}
              accessibilityRole="header"
            >
              {humanizeKey(key)}
            </Text>
            <View style={styles.sectionBody}>{renderValue(val, depth + 1)}</View>
          </View>
        ))}
      </View>
    );
  }
  return null;
}

export function GenericRenderer({ data }: { data: DerivativeDetail }) {
  if (data.contentPlainText && data.contentPlainText.trim()) {
    return (
      <View style={styles.article}>
        <Text style={styles.plainText}>{data.contentPlainText}</Text>
      </View>
    );
  }

  const body = renderValue(data.contentJson);
  if (!body) return <Unavailable />;

  return <View style={styles.article}>{body}</View>;
}

const styles = StyleSheet.create({
  article: { gap: 12 },
  plainText: { fontSize: 14, color: '#1f2937', lineHeight: 21 },
  para: { fontSize: 14, color: '#1f2937', lineHeight: 21 },
  bulletList: { gap: 4, paddingLeft: 8 },
  bulletRow: { flexDirection: 'row', gap: 8 },
  bullet: { fontSize: 14, color: '#1f2937', lineHeight: 21 },
  bulletText: { flex: 1, fontSize: 14, color: '#1f2937', lineHeight: 21 },
  orderedList: { gap: 8 },
  orderedRow: { flexDirection: 'row', gap: 8 },
  orderedIndex: { fontSize: 14, color: '#6b7280', lineHeight: 21, minWidth: 20 },
  orderedBody: { flex: 1 },
  sectionList: { gap: 16 },
  section: { gap: 6 },
  sectionBody: { gap: 6 },
  headingH3: { fontSize: 17, fontWeight: '700', color: '#111827' },
  headingH4: { fontSize: 15, fontWeight: '600', color: '#111827' },
});
