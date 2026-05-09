import { Text, View } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export interface LogoProps {
  /** Pixel size of the square mark. The wordmark scales relative to this. */
  size?: number;
  /** Hide the wordmark and only render the mark. */
  markOnly?: boolean;
}

export function Logo({ size = 28, markOnly = false }: LogoProps) {
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.28,
          backgroundColor: theme.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            color: theme.accentInk,
            fontFamily: theme.serif,
            fontSize: size * 0.6,
          }}
        >
          L
        </Text>
      </View>
      {!markOnly && (
        <Text
          style={{
            fontFamily: theme.serif,
            fontSize: size * 0.62,
            color: theme.ink,
            letterSpacing: -0.4,
          }}
        >
          Libertasian
        </Text>
      )}
    </View>
  );
}
