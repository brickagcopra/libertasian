import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import type { Theme } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

import { useSurfaceAccess } from '../../entitlements/use-freemium-surfaces';
import { researchHref } from '../navigation';

/**
 * The ways into Deep Research from other screens.
 *
 * Each one reads the persisted `/quotas/usage` answer before it renders (the
 * same `hidden` test as `resolveDeepResearchAccess`, without firing a query of
 * its own): when the surface is hidden on this account/platform it renders
 * NOTHING (the freemium rule — no lock, no explanation). Every other state
 * navigates to /research, where the composer reads the live quota and shows
 * exactly what this account can do (run, reset date, or the refusal) — so no
 * entry point is ever a dead button.
 */

function makeStyles(theme: Theme) {
  return StyleSheet.create({
    chip: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.accent,
      backgroundColor: theme.accentSoft,
    },
    chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: theme.ink },
    tile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 14,
      borderRadius: 12,
      backgroundColor: '#fff',
      marginBottom: 16,
    },
    tileIcon: {
      width: 40,
      height: 40,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.accentSoft,
    },
    tileBody: { flex: 1 },
    tileTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#111827' },
    tileText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#6b7280', marginTop: 2 },
  });
}

function useEntryStyles() {
  const { theme } = useTheme();
  return { theme, styles: useMemo(() => makeStyles(theme), [theme]) };
}

/** Whether any Deep Research entry point should render for this account. */
export function useDeepResearchEntryVisible(): boolean {
  return useSurfaceAccess().surfaces.workspace;
}

/** "Go deeper" under the search AI answer: carries the query into the composer. */
export function GoDeeperChip({ query }: { query: string }) {
  const { theme, styles } = useEntryStyles();
  const visible = useDeepResearchEntryVisible();
  const onPress = useCallback(() => router.push(researchHref(query)), [query]);
  if (!visible) return null;
  return (
    <Pressable
      style={styles.chip}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Opens Deep Research with this question"
      testID="go-deeper-chip"
    >
      <Ionicons name="layers-outline" size={14} color={theme.accent} />
      <Text style={styles.chipText}>Go deeper</Text>
    </Pressable>
  );
}

/** The Workspace hub tile. */
export function DeepResearchTile() {
  const { theme, styles } = useEntryStyles();
  const visible = useDeepResearchEntryVisible();
  const onPress = useCallback(() => router.push(researchHref()), []);
  if (!visible) return null;
  return (
    <Pressable
      style={styles.tile}
      onPress={onPress}
      accessibilityRole="button"
      testID="deep-research-tile"
    >
      <View style={styles.tileIcon}>
        <Ionicons name="layers-outline" size={22} color={theme.accent} />
      </View>
      <View style={styles.tileBody}>
        <Text style={styles.tileTitle}>Deep Research</Text>
        <Text style={styles.tileText}>Verified multi-source answers</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
    </Pressable>
  );
}
