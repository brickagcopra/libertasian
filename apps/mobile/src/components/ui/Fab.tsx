import { Ionicons } from '@expo/vector-icons';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { useTabBarClearance } from '@/components/ui/TabBar';
import { useTheme } from '@/providers/theme-provider';

export interface FabProps {
  onPress?: () => void;
  /** Ionicon name. Defaults to 'camera' (Scan FAB on Home + Library). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Accessibility label. Required for screen readers; defaults to "Scan". */
  accessibilityLabel?: string;
  /**
   * Override the bottom offset. Defaults to `useTabBarClearance()`, which
   * tracks the safe-area inset — do not pass a literal unless the screen has
   * no TabBar.
   */
  bottom?: number;
  /** Override the right offset (default 18). */
  right?: number;
  /** Pixel size of the FAB. Default 56. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Floating Action Button used on Home + Library to launch the Scan flow.
 *
 * Sits above the design TabBar. The offset comes from `useTabBarClearance()`,
 * not a literal: the old `bottom: 90` was below the bar's top edge (98) on any
 * notched iPhone, so the bar — rendered later, same elevation — painted over
 * the FAB.
 * Theme-aware: uses theme.accent + theme.accentInk.
 */
export function Fab({
  onPress,
  icon = 'camera',
  accessibilityLabel = 'Scan',
  bottom,
  right = 18,
  size = 56,
  style,
}: FabProps) {
  const { theme } = useTheme();
  const clearance = useTabBarClearance();
  const resolvedBottom = bottom ?? clearance;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          position: 'absolute',
          right,
          bottom: resolvedBottom,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.accent,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.22,
          shadowRadius: 28,
          shadowOffset: { width: 0, height: 12 },
          elevation: 12,
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={Math.round(size * 0.46)} color={theme.accentInk} />
    </Pressable>
  );
}
