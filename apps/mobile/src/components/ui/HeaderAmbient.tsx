import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useTheme } from '@/providers/theme-provider';

export interface HeaderAmbientProps {
  /** Height of the ambient band pinned to the top of the screen. */
  height?: number;
}

interface BlobSpec {
  key: string;
  /** Circle diameter in px. */
  size: number;
  top: number;
  left: `${number}%`;
  /** Theme token used as the fill (translucent via hex-alpha suffix). */
  base: 'accent' | 'accentSoft';
  /** Two-digit hex alpha appended to the theme token. */
  alpha: string;
  /** Drift distance in px at the far end of the cycle. */
  driftX: number;
  driftY: number;
  /** Scale at the far end of the cycle. */
  scaleTo: number;
  /** Full out-and-back cycle duration in ms (12–20s). */
  cycleMs: number;
  /** Stagger before this blob's loop starts, in ms. */
  delayMs: number;
}

const BLOBS: readonly BlobSpec[] = [
  {
    key: 'soft-large',
    size: 240,
    top: -120,
    left: '-22%',
    base: 'accentSoft',
    alpha: 'aa',
    driftX: 26,
    driftY: 16,
    scaleTo: 1.1,
    cycleMs: 16000,
    delayMs: 0,
  },
  {
    key: 'accent-faint',
    size: 170,
    top: -60,
    left: '62%',
    base: 'accent',
    alpha: '22',
    driftX: -22,
    driftY: 20,
    scaleTo: 1.14,
    cycleMs: 20000,
    delayMs: 1400,
  },
  {
    key: 'soft-small',
    size: 110,
    top: 44,
    left: '32%',
    base: 'accentSoft',
    alpha: '66',
    driftX: 18,
    driftY: -12,
    scaleTo: 1.08,
    cycleMs: 12000,
    delayMs: 2600,
  },
];

/**
 * Subtle "glass ambient" decoration for the top band of a screen.
 *
 * Renders 2–3 slowly drifting translucent circles clipped to an absolute
 * band at the top of the screen (zIndex 0, pointerEvents "none"), so it
 * always sits behind the screen's own content. Fills come from the active
 * theme's accent tokens at low hex-alpha so header text (theme.ink on
 * theme.bg) keeps clear contrast.
 *
 * Uses RN core Animated with `useNativeDriver: true` (transform-only) and
 * honours the OS reduce-motion preference: when enabled, the circles render
 * static and no loop is started.
 */
export function HeaderAmbient({ height = 180 }: HeaderAmbientProps) {
  const { theme } = useTheme();
  // null until the OS preference is known — we never start a loop we might
  // immediately have to cancel.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const blobsRef = useRef(BLOBS.map((spec) => ({ spec, progress: new Animated.Value(0) })));
  const blobs = blobsRef.current;

  // Respect reduced motion preference (same pattern as ads/ad-renderer).
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion !== false) return;
    const animations = blobs.map(({ spec, progress }) =>
      Animated.sequence([
        Animated.delay(spec.delayMs),
        Animated.loop(
          Animated.sequence([
            Animated.timing(progress, {
              toValue: 1,
              duration: spec.cycleMs / 2,
              useNativeDriver: true,
            }),
            Animated.timing(progress, {
              toValue: 0,
              duration: spec.cycleMs / 2,
              useNativeDriver: true,
            }),
          ]),
        ),
      ]),
    );
    animations.forEach((animation) => animation.start());
    return () => {
      animations.forEach((animation) => animation.stop());
      blobs.forEach(({ progress }) => progress.setValue(0));
    };
  }, [reduceMotion, blobs]);

  return (
    <View
      pointerEvents="none"
      testID="header-ambient"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height,
        overflow: 'hidden',
        zIndex: 0,
      }}
    >
      {blobs.map(({ spec, progress }) => (
        <Animated.View
          key={spec.key}
          style={{
            position: 'absolute',
            top: spec.top,
            left: spec.left,
            width: spec.size,
            height: spec.size,
            borderRadius: spec.size / 2,
            backgroundColor: `${theme[spec.base]}${spec.alpha}`,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, spec.driftX],
                }),
              },
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, spec.driftY],
                }),
              },
              {
                scale: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, spec.scaleTo],
                }),
              },
            ],
          }}
        />
      ))}
    </View>
  );
}
