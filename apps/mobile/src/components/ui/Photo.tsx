import { LinearGradient } from 'expo-linear-gradient';
import { Text, View } from 'react-native';
import { photoTones, type PhotoTone } from '@/lib/design-tokens';
import { useTheme } from '@/providers/theme-provider';

export interface PhotoProps {
  /** Headline overlaid on the photo at the bottom-left. */
  headline?: string;
  /** Visual placeholder label drawn small in the top-left corner. */
  label?: string;
  /** Color tone for the gradient placeholder. */
  tone?: PhotoTone;
  /** Pixel height of the photo container. Width fills the parent. */
  height?: number;
  /** Border radius (px). Use 0 to disable rounding. */
  radius?: number;
}

/**
 * Photo — gradient placeholder with optional headline overlay.
 * Replace with real images later; same dimensions and overlay still apply.
 */
export function Photo({ headline, label, tone = 'warm', height = 180, radius = 16 }: PhotoProps) {
  const { theme } = useTheme();
  const palette = photoTones[tone] ?? photoTones.warm;

  return (
    <View
      style={{
        height,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: palette[1],
      }}
    >
      <LinearGradient
        colors={[palette[0], palette[1]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      {/* Highlight + shadow vignette for "photo" feel */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(255,255,255,0.12)',
          opacity: 0.5,
        }}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.18)', 'transparent', 'rgba(0,0,0,0.35)']}
        locations={[0, 0.45, 1]}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      {label ? (
        <View style={{ position: 'absolute', top: 14, left: 14 }}>
          <Text
            style={{
              fontFamily: 'Inter_500Medium',
              fontSize: 10,
              color: 'rgba(255,255,255,0.7)',
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            {label}
          </Text>
        </View>
      ) : null}
      {headline ? (
        <View style={{ position: 'absolute', left: 18, right: 18, bottom: 16 }}>
          <Text
            style={{
              fontFamily: theme.serif,
              fontSize: 22,
              lineHeight: 24.2,
              color: '#FFFFFF',
              letterSpacing: -0.4,
            }}
          >
            {headline}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
