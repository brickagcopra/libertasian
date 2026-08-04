import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomInsetPadding } from '@/lib/safe-area';
import { useTheme } from '@/providers/theme-provider';

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
const DEFAULT_ITEMS: TabBarItem[] = [
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
export function TabBar({ active, onPress, items = DEFAULT_ITEMS }: TabBarProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: bottomInsetPadding(insets, 14),
        height: 64,
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
      {items.map((it) => {
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
