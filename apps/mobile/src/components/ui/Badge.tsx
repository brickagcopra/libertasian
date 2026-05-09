import { Text, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export type BadgeTone = 'neutral' | 'accent' | 'accent-soft' | 'pill' | 'eyebrow';

export interface BadgeProps extends Omit<ViewProps, 'style'> {
  label: string;
  tone?: BadgeTone;
  /** Render as upper-case letter-spaced eyebrow text, no background. */
  eyebrow?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Compact badge — used as category tags ("Constitutional Law", "Op-ed").
 * Eyebrow tone renders accent-colored uppercase text without a pill background.
 */
export function Badge({ label, tone = 'neutral', eyebrow, style, ...rest }: BadgeProps) {
  const { theme } = useTheme();

  if (eyebrow || tone === 'eyebrow') {
    return (
      <View style={[{ alignSelf: 'flex-start' }, style]} {...rest}>
        <Text
          style={{
            fontFamily: 'Inter_700Bold',
            fontSize: 11,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: theme.accent,
          }}
        >
          {label}
        </Text>
      </View>
    );
  }

  const palette: Record<Exclude<BadgeTone, 'eyebrow'>, { bg: string; fg: string }> = {
    neutral: { bg: theme.chipBg, fg: theme.ink },
    accent: { bg: theme.accent, fg: theme.accentInk },
    'accent-soft': { bg: theme.accentSoft, fg: theme.ink },
    pill: { bg: theme.pillBg, fg: theme.pillInk },
  };
  const p = palette[tone];

  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: p.bg,
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 8,
        },
        style,
      ]}
      {...rest}
    >
      <Text
        style={{
          color: p.fg,
          fontFamily: 'Inter_700Bold',
          fontSize: 11,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
    </View>
  );
}
