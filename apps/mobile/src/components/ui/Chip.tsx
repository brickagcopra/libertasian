import { Pressable, Text, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export type ChipTone = 'neutral' | 'accent';

export interface ChipProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  /** When true, the chip is rendered in the active/pressed-in style. */
  selected?: boolean;
  /**
   * Visual tone. 'neutral' uses chipBg ↔ pillBg; 'accent' uses accentSoft ↔ accent.
   * Default 'neutral' matches the design's filter chips.
   */
  tone?: ChipTone;
  style?: StyleProp<ViewStyle>;
}

export function Chip({
  label,
  selected = false,
  tone = 'neutral',
  style,
  ...rest
}: ChipProps) {
  const { theme } = useTheme();

  const palette =
    tone === 'accent'
      ? selected
        ? { bg: theme.accent, fg: theme.accentInk }
        : { bg: theme.accentSoft, fg: theme.ink }
      : selected
      ? { bg: theme.pillBg, fg: theme.pillInk }
      : { bg: theme.chipBg, fg: theme.ink };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        {
          height: 32,
          paddingHorizontal: 14,
          borderRadius: 999,
          backgroundColor: palette.bg,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: 'flex-start',
          flexShrink: 0,
        },
        style,
      ]}
      {...rest}
    >
      <Text
        style={{
          color: palette.fg,
          fontFamily: selected ? 'Inter_600SemiBold' : 'Inter_500Medium',
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
