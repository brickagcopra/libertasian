import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { HeaderAmbient } from '@/components/ui/HeaderAmbient';
import { TabBar } from '@/components/ui/TabBar';
import { useTabBarNav } from '@/features/navigation/use-tab-bar-nav';
import { DERIVATIVE_TYPES } from '../../../features/derivatives/taxonomy';

export default function LibraryHubScreen() {
  const navigate = useTabBarNav();

  return (
    <View style={styles.container}>
      <HeaderAmbient />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Library
          </Text>
          <Text style={styles.subtitle}>
            Browse Quimbee-style study artifacts organised by type and subject.
          </Text>
        </View>

        <View style={styles.grid}>
          {DERIVATIVE_TYPES.map((t) => (
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
          ScrollView's paddingBottom: 96 keeps the last tile clear of it. */}
      <TabBar active="docs" onPress={navigate} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  scroll: { flex: 1 },
  // 96, matching (tabs)/digests.tsx listContent — clears the floating pill.
  content: { padding: 16, gap: 16, paddingBottom: 96 },
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
