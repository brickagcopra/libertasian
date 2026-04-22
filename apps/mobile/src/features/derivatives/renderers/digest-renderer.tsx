import { StyleSheet, Text, View } from 'react-native';
import type { DerivativeDetail } from '../types';
import { Unavailable } from './unavailable';

interface DigestContent {
  summary?: string;
  facts?: string;
  petitionerArguments?: string;
  respondentArguments?: string;
  issues?: string | string[];
  ruling?: string;
  doctrine?: string;
  dispositive?: string;
}

function asDigest(value: unknown): DigestContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as DigestContent;
}

function formatIssues(issues: string | string[] | undefined): string[] {
  if (!issues) return [];
  if (Array.isArray(issues)) return issues.filter((x) => typeof x === 'string' && x.trim());
  return [issues];
}

export function DigestRenderer({ data }: { data: DerivativeDetail }) {
  const content = asDigest(data.contentJson);
  if (!content) return <Unavailable />;

  const sections: Array<{ title: string; body: string | string[] | undefined }> = [
    { title: 'Summary', body: content.summary },
    { title: 'Facts', body: content.facts },
    { title: "Petitioner's Arguments", body: content.petitionerArguments },
    { title: "Respondent's Arguments", body: content.respondentArguments },
    { title: 'Issues', body: formatIssues(content.issues) },
    { title: 'Ruling', body: content.ruling },
    { title: 'Doctrine', body: content.doctrine },
    { title: 'Dispositive', body: content.dispositive },
  ];

  const anyContent = sections.some((s) =>
    Array.isArray(s.body) ? s.body.length > 0 : typeof s.body === 'string' && s.body.trim(),
  );
  if (!anyContent) return <Unavailable />;

  return (
    <View style={styles.article}>
      {sections.map((s) => {
        if (Array.isArray(s.body)) {
          if (s.body.length === 0) return null;
          return (
            <View key={s.title} style={styles.section}>
              <Text style={styles.heading} accessibilityRole="header">
                {s.title}
              </Text>
              <View style={styles.orderedList}>
                {s.body.map((p, i) => (
                  <View key={`${s.title}-${i}`} style={styles.orderedRow}>
                    <Text style={styles.orderedIndex}>{i + 1}.</Text>
                    <Text style={styles.para}>{p}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        }
        const text = (s.body ?? '').trim();
        if (!text) return null;
        return (
          <View key={s.title} style={styles.section}>
            <Text style={styles.heading} accessibilityRole="header">
              {s.title}
            </Text>
            <Text style={styles.para}>{text}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  article: { gap: 18 },
  section: { gap: 6 },
  heading: { fontSize: 17, fontWeight: '700', color: '#111827' },
  para: { fontSize: 14, color: '#1f2937', lineHeight: 21, flex: 1 },
  orderedList: { gap: 6, paddingLeft: 4 },
  orderedRow: { flexDirection: 'row', gap: 8 },
  orderedIndex: { fontSize: 14, color: '#6b7280', lineHeight: 21, minWidth: 20 },
});
