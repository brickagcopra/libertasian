import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { DerivativeDetail } from '../types';
import { Unavailable } from './unavailable';

interface FlashcardEntry {
  front?: string;
  back?: string;
  mnemonicHint?: string | null;
  mnemonics?: string[];
  tags?: string[];
}

interface FlashcardContent {
  cards?: FlashcardEntry[];
  front?: string;
  back?: string;
  mnemonicHint?: string | null;
}

function extractCards(value: unknown): FlashcardEntry[] {
  if (!value || typeof value !== 'object') return [];
  const v = value as FlashcardContent;
  if (Array.isArray(v.cards) && v.cards.length > 0) return v.cards;
  if (typeof v.front === 'string' && typeof v.back === 'string') {
    return [{ front: v.front, back: v.back, mnemonicHint: v.mnemonicHint }];
  }
  return [];
}

function FlashCard({ card }: { card: FlashcardEntry }) {
  const [flipped, setFlipped] = useState(false);
  const front = card.front ?? '';
  const back = card.back ?? '';
  if (!front && !back) return null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardLabel}>{flipped ? 'Back' : 'Front'}</Text>
        <Pressable
          style={({ pressed }) => [styles.flipButton, pressed && styles.flipButtonPressed]}
          onPress={() => setFlipped((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={flipped ? 'Show front' : 'Flip card'}
        >
          <Ionicons name="refresh-outline" size={14} color="#374151" />
          <Text style={styles.flipButtonText}>{flipped ? 'Show front' : 'Flip'}</Text>
        </Pressable>
      </View>
      <Text style={styles.cardBody}>{flipped ? back : front}</Text>
      {flipped && card.mnemonicHint ? (
        <Text style={styles.mnemonic}>
          <Text style={styles.mnemonicLabel}>Mnemonic: </Text>
          {card.mnemonicHint}
        </Text>
      ) : null}
    </View>
  );
}

export function FlashcardRenderer({ data }: { data: DerivativeDetail }) {
  const cards = extractCards(data.contentJson);
  if (cards.length === 0) return <Unavailable />;

  return (
    <View style={styles.grid}>
      {cards.map((c, i) => (
        <FlashCard key={`card-${i}`} card={c} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 10 },
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    padding: 14,
    gap: 10,
    minHeight: 140,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#6b7280',
    textTransform: 'uppercase',
  },
  flipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  flipButtonPressed: { backgroundColor: '#f3f4f6' },
  flipButtonText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  cardBody: { flex: 1, fontSize: 14, color: '#1f2937', lineHeight: 21 },
  mnemonic: { fontSize: 12, color: '#6b7280', lineHeight: 18 },
  mnemonicLabel: { fontWeight: '600' },
});
