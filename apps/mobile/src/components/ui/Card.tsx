import { View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export type CardTone = 'surface' | 'muted' | 'pill' | 'accent-soft';

export interface CardProps extends Omit<ViewProps, 'style'> {
  /** Visual surface. 'surface' = default white card; 'pill' = ink/dark; 'accent-soft' = accent tint. */
  tone?: CardTone;
  /** Apply default 16px padding inside the card. */
  padded?: boolean;
  /** Show 1px theme.line border. Defaults to true for 'surface', false otherwise. */
  bordered?: boolean;
  /** Border radius override. Defaults to 18. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  tone = 'surface',
  padded = true,
  bordered,
  radius = 18,
  style,
  children,
  ...rest
}: CardProps) {
  const { theme } = useTheme();
  const palette: Record<CardTone, { bg: string; defaultBorder: boolean }> = {
    surface: { bg: theme.surface, defaultBorder: true },
    muted: { bg: theme.surfaceMuted, defaultBorder: false },
    pill: { bg: theme.pillBg, defaultBorder: false },
    'accent-soft': { bg: theme.accentSoft, defaultBorder: false },
  };
  const p = palette[tone];
  const showBorder = bordered ?? p.defaultBorder;

  return (
    <View
      style={[
        {
          backgroundColor: p.bg,
          borderRadius: radius,
          padding: padded ? 16 : 0,
          borderWidth: showBorder ? 1 : 0,
          borderColor: showBorder ? theme.line : 'transparent',
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
