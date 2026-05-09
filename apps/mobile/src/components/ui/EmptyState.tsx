import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/providers/theme-provider';
import { Button } from './Button';

export interface EmptyStateProps {
  illustration?: ReactNode;
  heading: string;
  body?: string;
  primaryCta?: { label: string; onPress: () => void };
  secondaryCta?: { label: string; onPress: () => void };
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  illustration,
  heading,
  body,
  primaryCta,
  secondaryCta,
  style,
}: EmptyStateProps) {
  const { theme } = useTheme();
  return (
    <View
      style={[
        {
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          paddingVertical: 32,
        },
        style,
      ]}
    >
      {illustration ? <View style={{ marginBottom: 16 }}>{illustration}</View> : null}
      <Text
        style={{
          fontFamily: theme.serif,
          fontSize: 22,
          letterSpacing: -0.4,
          color: theme.ink,
          textAlign: 'center',
        }}
      >
        {heading}
      </Text>
      {body ? (
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            fontSize: 15,
            lineHeight: 23,
            color: theme.inkSoft,
            textAlign: 'center',
            marginTop: 8,
          }}
        >
          {body}
        </Text>
      ) : null}
      {primaryCta ? (
        <View style={{ marginTop: 24, width: '100%', maxWidth: 320 }}>
          <Button label={primaryCta.label} onPress={primaryCta.onPress} variant="primary" full />
        </View>
      ) : null}
      {secondaryCta ? (
        <View style={{ marginTop: 12, width: '100%', maxWidth: 320 }}>
          <Button label={secondaryCta.label} onPress={secondaryCta.onPress} variant="ghost" full />
        </View>
      ) : null}
    </View>
  );
}
