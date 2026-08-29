import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFreemiumSurfaces } from '@/features/entitlements/use-freemium-surfaces';
import { bottomInsetPadding } from '@/lib/safe-area';
import { useTheme } from '@/providers/theme-provider';

/**
 * Height of the floating pill. Exported so nothing has to re-derive it.
 *
 * See `useTabBarClearance` — every caller that needs to sit above the bar must
 * go through that hook rather than hardcoding a number.
 */
export const TAB_BAR_HEIGHT = 64;

/** Design gap between the bottom of the screen and the bottom of the pill. */
export const TAB_BAR_BOTTOM_INSET = 14;

/** Breathing room between the top of the pill and whatever sits above it. */
const TAB_BAR_CLEARANCE_GAP = 12;

/**
 * Vertical space anything must leave at the bottom of the screen to sit clear
 * of the TabBar: the bar's own bottom offset, plus its height, plus a gap.
 *
 * This exists because the offsets were previously hardcoded in a dozen places
 * as 90, 96 or 110, and none of them tracked `insets.bottom`. On a notched
 * iPhone the bar's bottom offset is `max(14, 34) = 34`, so its top edge is at
 * 98 — above the FAB's old `bottom: 90`, which is why the bar painted over the
 * FAB. Anything positioned against the bottom of a screen that also renders a
 * TabBar must use this hook.
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return (
    bottomInsetPadding(insets, TAB_BAR_BOTTOM_INSET) +
    TAB_BAR_HEIGHT +
    TAB_BAR_CLEARANCE_GAP
  );
}

export type TabBarItemId =
  | 'home'
  | 'docs'
  | 'search'
  | 'digests'
  | 'study'
  | 'feed'
  | 'workspace'
  | 'me';

export interface TabBarItem {
  id: TabBarItemId;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

export interface TabBarProps {
  active: TabBarItemId;
  onPress?: (id: TabBarItemId) => void;
  items?: TabBarItem[];
}

/**
 * All eight destinations. Scan is deliberately NOT here — it keeps its FAB
 * (`components/ui/Fab.tsx`), which is the primary capture affordance.
 */
export const DEFAULT_ITEMS: TabBarItem[] = [
  { id: 'home', label: 'Read', icon: 'home' },
  { id: 'docs', label: 'Library', icon: 'library' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'digests', label: 'Digests', icon: 'document-text' },
  { id: 'study', label: 'Study', icon: 'school' },
  { id: 'feed', label: 'Feed', icon: 'newspaper' },
  { id: 'workspace', label: 'Work', icon: 'briefcase' },
  { id: 'me', label: 'Me', icon: 'person' },
];

/**
 * Floating pill-shaped bottom tab bar. Active item gets an accent background pill.
 * Position absolutely; assumes parent has `position: relative` (most screens do).
 *
 * Sizing note: eight slots have to fit a 375pt screen (~44pt each) and stay
 * legible at 360pt on small Android. Icon 18, label 9, item padding 4 and gap 2
 * are what make that work — the container height stays 64 and the layout stays
 * `space-around`. Labels are `numberOfLines={1}` with no ellipsis: "Digests" is
 * the longest and clipping a character is better than shrinking the type
 * further. "Work" rather than "Workspace" for the same reason.
 */
export function TabBar({ active, onPress, items }: TabBarProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const surfaces = useFreemiumSurfaces();

  // The entitlement filter lives HERE rather than at the call sites, and that
  // is the whole point: seventeen screens render this bar, and a call site that
  // forgot to filter would put a Study tab in front of an account that cannot
  // open it. One place to be right beats seventeen places to remember.
  //
  // An explicit `items` prop still wins — a caller passing its own list has
  // already decided what belongs in the bar.
  const resolvedItems = useMemo(
    () =>
      items ??
      DEFAULT_ITEMS.filter((item) => {
        if (item.id === 'study') return surfaces.study;
        if (item.id === 'workspace') return surfaces.workspace;
        return true;
      }),
    [items, surfaces.study, surfaces.workspace],
  );

  return (
    <View
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: bottomInsetPadding(insets, TAB_BAR_BOTTOM_INSET),
        height: TAB_BAR_HEIGHT,
        borderRadius: 24,
        backgroundColor: theme.pillBg,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-around',
        paddingHorizontal: 8,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
        elevation: 12,
      }}
    >
      {resolvedItems.map((it) => {
        const isActive = active === it.id;
        return (
          <Pressable
            key={it.id}
            onPress={() => onPress?.(it.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={it.label}
            style={{
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              paddingHorizontal: 4,
              paddingVertical: 8,
              borderRadius: 12,
              backgroundColor: isActive ? theme.accent : 'transparent',
            }}
          >
            <Ionicons
              name={isActive ? it.icon : (`${it.icon}-outline` as keyof typeof Ionicons.glyphMap)}
              size={18}
              color={isActive ? theme.accentInk : theme.pillInk}
            />
            <Text
              numberOfLines={1}
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 9,
                color: isActive ? theme.accentInk : theme.pillInk,
              }}
            >
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
