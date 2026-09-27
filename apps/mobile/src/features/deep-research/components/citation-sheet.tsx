import { useCallback, useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Theme } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

import { formatSourceDate } from '../citations';
import { readerHref } from '../navigation';
import type { DeepResearchSource } from '../types';

export interface OpenCitation {
  number: number;
  source: DeepResearchSource;
  /** The verbatim passage the claim was verified against. */
  quote: string;
}

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 18,
      paddingTop: 10,
      maxHeight: '80%',
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.line,
      marginBottom: 12,
    },
    number: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: theme.accent },
    quoteBox: {
      borderLeftWidth: 3,
      borderLeftColor: theme.accent,
      backgroundColor: theme.accentSoft,
      borderRadius: 8,
      padding: 12,
      marginTop: 8,
    },
    quote: { fontFamily: theme.serif, fontSize: 16, lineHeight: 23, color: theme.ink },
    title: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: theme.ink, marginTop: 14 },
    metaRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
    metaLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, color: theme.inkFaint, width: 64 },
    metaValue: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: theme.inkSoft },
    actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
    primary: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: theme.radius,
      backgroundColor: theme.accent,
    },
    primaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: theme.accentInk },
    secondary: {
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderRadius: theme.radius,
      borderWidth: 1,
      borderColor: theme.line,
    },
    secondaryText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: theme.ink },
  });
}

/**
 * Bottom sheet for one citation: the verbatim quote first, then where it is
 * from, then a way into the reader. Built on RN's `Modal` — no bottom-sheet
 * library, so no native module and no native rebuild.
 */
export function CitationSheet({
  citation,
  onClose,
}: {
  citation: OpenCitation | null;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  const source = citation?.source;

  const quote = citation?.quote;

  const openInReader = useCallback(() => {
    if (!source) return;
    onClose();
    // The reader scrolls to `section` and marks `highlight` (the verbatim
    // quote) with the same matcher as the web reader.
    router.push(readerHref(source.documentId, source.sectionId, quote));
  }, [source, quote, onClose]);

  const meta = useMemo(() => {
    if (!source) return [];
    const rows: { label: string; value: string }[] = [];
    const cite = source.citation ?? source.grNo;
    if (cite) rows.push({ label: 'Citation', value: cite });
    if (source.court) rows.push({ label: 'Court', value: source.court.replace(/_/g, ' ') });
    const date = formatSourceDate(source.date);
    if (date) rows.push({ label: 'Date', value: date });
    if (source.sectionLabel) rows.push({ label: 'Section', value: source.sectionLabel });
    return rows;
  }, [source]);

  return (
    <Modal visible={citation !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="citation-sheet-backdrop">
        {/* Inner Pressable swallows taps so the sheet body does not close it. */}
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} testID="citation-sheet">
          <View style={styles.handle} />
          {citation && source ? (
            <ScrollView>
              <Text style={styles.number}>{`Source ${citation.number}`}</Text>
              <View style={styles.quoteBox}>
                <Text style={styles.quote} testID="citation-quote">
                  {`“${citation.quote}”`}
                </Text>
              </View>
              <Text style={styles.title}>{source.title || 'Untitled source'}</Text>
              {meta.map((row) => (
                <View key={row.label} style={styles.metaRow}>
                  <Text style={styles.metaLabel}>{row.label}</Text>
                  <Text style={styles.metaValue}>{row.value}</Text>
                </View>
              ))}
              <View style={styles.actions}>
                <Pressable
                  style={styles.primary}
                  onPress={openInReader}
                  accessibilityRole="button"
                  testID="citation-open-reader"
                >
                  <Text style={styles.primaryText}>Open in reader</Text>
                </Pressable>
                <Pressable style={styles.secondary} onPress={onClose} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Close</Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
