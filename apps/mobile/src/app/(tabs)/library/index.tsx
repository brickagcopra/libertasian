import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HeaderAmbient } from '@/components/ui/HeaderAmbient';
import { TabBar, useTabBarClearance } from '@/components/ui/TabBar';
import { useFreemiumSurfaces } from '@/features/entitlements/use-freemium-surfaces';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';
import { topInsetPadding } from '@/lib/safe-area';
import type { IoniconName } from '../../../features/derivatives/taxonomy';
import { DERIVATIVE_TYPES } from '../../../features/derivatives/taxonomy';

interface CorpusEntry {
  key: string;
  label: string;
  description: string;
  icon: IoniconName;
  href: '/codals/' | '/documents';
}

/**
 * The corpus every account can read, derivative artifacts aside.
 *
 * The Library tab is the only ungated hub in the app, so it is also the only
 * place a free account can be given a way IN to the two free destinations:
 * the codal reader (moved out of the guarded `/study` subtree) and the
 * document browser, whose sole entry point used to be the Study tab.
 */
const CORPUS_ENTRIES: readonly CorpusEntry[] = [
  {
    key: 'codals',
    label: 'Codals',
    description:
      'Republic Acts, the 1987 Constitution, and the Rules of Court by bar subject.',
    icon: 'library-outline',
    href: '/codals/',
  },
  {
    key: 'documents',
    label: 'Legal Documents',
    description: 'Browse and filter the document corpus by type, court, and subject.',
    icon: 'document-outline',
    href: '/documents',
  },
];

export default function LibraryHubScreen() {
  const navigate = useTabBarNav();
  const clearance = useTabBarClearance();
  const insets = useSafeAreaInsets();
  const surfaces = useFreemiumSurfaces();

  // Derivative types are generated study artifacts and sit behind the same
  // entitlement as the rest of Study. They are OMITTED rather than disabled:
  // eleven greyed tiles is a catalogue of what the account cannot open, which
  // is the shown-and-refused pattern App Store 3.1.1 rejects. The corpus
  // entries above stay, so the tab is never empty.
  const derivativeTypes = surfaces.study ? DERIVATIVE_TYPES : [];

  return (
    <View style={styles.container}>
      <HeaderAmbient />
      <ScrollView style={styles.scroll} contentContainerStyle={[
          styles.content,
          // library/_layout.tsx sets headerShown: false, so the title starts
          // at y=0 and lands under the Dynamic Island without this.
          { paddingTop: topInsetPadding(insets, 16), paddingBottom: clearance },
        ]}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Library
          </Text>
          <Text style={styles.subtitle}>
            {surfaces.study
              ? 'Browse the Philippine legal corpus and study artifacts by type and subject.'
              : 'Browse the Philippine legal corpus by type and subject.'}
          </Text>
        </View>

        <View style={styles.grid}>
          {CORPUS_ENTRIES.map((entry) => (
            <Pressable
              key={entry.key}
              style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              onPress={() => router.push(entry.href)}
              accessibilityRole="button"
              accessibilityLabel={`Browse ${entry.label}`}
            >
              <View style={styles.iconBox}>
                <Ionicons name={entry.icon} size={20} color="#1d4ed8" />
              </View>
              <Text style={styles.tileTitle} numberOfLines={2}>
                {entry.label}
              </Text>
              <Text style={styles.tileDescription} numberOfLines={3}>
                {entry.description}
              </Text>
            </Pressable>
          ))}

          {derivativeTypes.map((t) => (
            <Pressable
              key={t.enum}
              style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
              onPress={() => router.push(`/library/${t.slug}`)}
              accessibilityRole="button"
              accessibilityLabel={`Browse ${t.label}`}
            >
              <View style={styles.iconBox}>
                <Ionicons name={t.icon} size={20} color="#1d4ed8" />
              </View>
              <Text style={styles.tileTitle} numberOfLines={2}>
                {t.label}
              </Text>
              <Text style={styles.tileDescription} numberOfLines={3}>
                {t.description}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* Floating pill TabBar — same treatment as Home/Search/Digests. The
          ScrollView's paddingBottom comes from useTabBarClearance(). */}
      <TabBar active="docs" onPress={navigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  scroll: { flex: 1 },
  // 96, matching (tabs)/digests.tsx listContent — clears the floating pill.
  // paddingTop/paddingBottom are applied inline (safe-area + tab clearance).
  content: { paddingHorizontal: 16, gap: 16 },
  header: { gap: 4 },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6b7280', lineHeight: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  tilePressed: { backgroundColor: '#f9fafb' },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },
  tileDescription: { fontSize: 12, color: '#6b7280', lineHeight: 18 },
});
