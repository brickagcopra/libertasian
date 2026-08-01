import { Ionicons } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomInsetPadding } from '@/lib/safe-area';
import { useTheme } from '@/providers/theme-provider';

export type TabBarItemId = 'home' | 'docs' | 'search' | 'me';

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

const DEFAULT_ITEMS: TabBarItem[] = [
  { id: 'home', label: 'Read', icon: 'home' },
  { id: 'docs', label: 'Library', icon: 'library' },
  { id: 'search', label: 'Search', icon: 'search' },
  { id: 'me', label: 'Me', icon: 'person' },
];

/**
 * Floating pill-shaped bottom tab bar. Active item gets an accent background pill.
 * Position absolutely; assumes parent has `position: relative` (most screens do).
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
              gap: 3,
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 14,
              backgroundColor: isActive ? theme.accent : 'transparent',
            }}
          >
            <Ionicons
              name={isActive ? it.icon : (`${it.icon}-outline` as keyof typeof Ionicons.glyphMap)}
              size={20}
              color={isActive ? theme.accentInk : theme.pillInk}
            />
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 10,
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
