import type { ReactNode } from 'react';
import { useState } from 'react';
import { Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  /** Label rendered as an eyebrow above the input. */
  label?: string;
  /** Leading icon node, drawn at the left edge inside the input. */
  leading?: ReactNode;
  /** Trailing icon node, drawn at the right edge inside the input. */
  trailing?: ReactNode;
  /** Optional error message rendered below the input. */
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

/**
 * Field-style input matching the design's `Field` primitive: 52px tall pill,
 * eyebrow label, optional leading/trailing icons.
 */
export function Input({
  label,
  leading,
  trailing,
  error,
  onFocus,
  onBlur,
  containerStyle,
  style,
  ...rest
}: InputProps) {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={[{ flexDirection: 'column', gap: 6 }, containerStyle]}>
      {label ? (
        <Text
          style={{
            fontFamily: 'Inter_500Medium',
            fontSize: 12,
            color: theme.inkSoft,
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Text>
      ) : null}
      <View
        style={[
          {
            height: 52,
            borderRadius: 14,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: focused ? theme.ink : theme.line,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            gap: 10,
          },
          style,
        ]}
      >
        {leading}
        <TextInput
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          placeholderTextColor={theme.inkFaint}
          style={{
            flex: 1,
            fontFamily: 'Inter_400Regular',
            fontSize: 15,
            color: theme.ink,
            paddingVertical: 0,
          }}
          {...rest}
        />
        {trailing}
      </View>
      {error ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: '#E11D48' }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
