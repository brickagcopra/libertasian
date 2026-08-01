import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bottomInsetPadding } from '@/lib/safe-area';
import { useTheme } from '@/providers/theme-provider';

export interface StickyCTAProps {
  /** 0..1 reading progress fraction shown as a horizontal accent bar. */
  progress?: number;
  /** Right-edge text; e.g., "4 min left". */
  meta?: string;
  /** Left-edge icon. Defaults to a speaker (audio playback affordance). */
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  /** Optional override content rendered between icon and meta. */
  children?: ReactNode;
}

/**
 * StickyCTA — pinned bottom bar used by the Article reader (and digest detail).
 * Pill-shaped dark surface with a progress track and trailing meta label.
 * Place inside a screen with `position: relative`; this absolutely-positions
 * itself with bottom: max(16, safe-area inset), left: 14, right: 14.
 */
export function StickyCTA({
  progress = 0,
  meta,
  icon = 'volume-medium',
  onPress,
  children,
}: StickyCTAProps) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <Pressable
      onPress={onPress}
      style={{
        position: 'absolute',
        left: 14,
        right: 14,
        bottom: 16,
        height: 56,
        borderRadius: 18,
        backgroundColor: theme.pillBg,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        gap: 12,
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
      }}
    >
      <Ionicons name={icon} size={18} color={theme.pillInk} />
      <View style={{ flex: 1 }}>
        {children ?? (
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: 'rgba(255,255,255,0.18)',
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${clamped * 100}%`,
                height: 4,
                borderRadius: 2,
                backgroundColor: theme.accent,
              }}
            />
          </View>
        )}
      </View>
      {meta ? (
        <Text
          style={{
            fontFamily: 'Inter_500Medium',
            fontSize: 12,
            color: theme.pillInk,
            opacity: 0.7,
          }}
        >
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}
