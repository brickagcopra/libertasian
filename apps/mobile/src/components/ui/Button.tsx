import { useRef } from 'react';
import {
  Animated,
  Pressable,
  Text,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export type ButtonVariant =
  | 'primary'
  | 'accent'
  | 'secondary'
  | 'ghost'
  | 'soft'
  | 'destructive';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  /** Stretch to fill the parent's width. */
  full?: boolean;
  /** Optional override style (merged after theme styles). */
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  variant = 'primary',
  full = false,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const { theme } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const animateTo = (value: number) => {
    Animated.timing(scale, { toValue: value, duration: 150, useNativeDriver: true }).start();
  };

  const palette: Record<
    ButtonVariant,
    { bg: string; fg: string; borderColor?: string; borderWidth?: number }
  > = {
    primary: { bg: theme.pillBg, fg: theme.pillInk },
    accent: { bg: theme.accent, fg: theme.accentInk },
    secondary: {
      bg: theme.surface,
      fg: theme.ink,
      borderColor: theme.line,
      borderWidth: 1,
    },
    ghost: {
      bg: 'transparent',
      fg: theme.ink,
      borderColor: theme.line,
      borderWidth: 1,
    },
    soft: { bg: theme.surfaceMuted, fg: theme.ink },
    destructive: { bg: '#E11D48', fg: '#FFFFFF' },
  };
  const p = palette[variant];

  return (
    <Animated.View style={{ transform: [{ scale }], width: full ? '100%' : undefined }}>
      <Pressable
        onPressIn={() => animateTo(0.98)}
        onPressOut={() => animateTo(1)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        style={[
          {
            backgroundColor: p.bg,
            borderColor: p.borderColor,
            borderWidth: p.borderWidth ?? 0,
            height: 52,
            borderRadius: 14,
            paddingHorizontal: 22,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            opacity: disabled ? 0.5 : 1,
            width: full ? '100%' : undefined,
          },
          style,
        ]}
        {...rest}
      >
        <Text
          style={{
            color: p.fg,
            fontFamily: 'Inter_600SemiBold',
            fontSize: 15,
            letterSpacing: -0.1,
          }}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
