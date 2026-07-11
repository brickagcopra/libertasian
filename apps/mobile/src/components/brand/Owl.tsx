import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

export interface OwlProps {
  /** Square edge length of the owl in px. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}

// Mascot's own warm coloring — intentionally hardcoded (mirrors
// apps/web/src/components/brand/owl.tsx), independent of the active theme.
const CREAM = '#F6F1E8';
const CREAM_2 = '#EFE7D7';
const INK = '#1C1A14';
const ACCENT = '#D87B2A';
const ACCENT_DEEP = '#B65E13';
const ACCENT_SOFT = '#FBE7CF';
const SURFACE = '#FFFFFF';

/** Design-space edge of the source artwork (600x600 viewBox). */
const ART = 600;

// Crop boxes (design-space) for the two animated pieces. Each piece renders
// its own tight Svg inside an Animated.View positioned at the matching
// fraction of `size`, so RN core Animated can move it without touching the
// SVG tree (no reanimated, no SVG-level animation).
const WING_BOX = { x: 130, y: 310, w: 100, h: 140 };
const EYE_BOX = { x: 295, y: 155, w: 130, h: 130 };

/** Full 5s wave cycle: three quick swings up front, then rest (mirrors the
    web `header-glow-owl-wave` keyframes). */
const WAVE_CYCLE_MS = 5000;

/** Everything EXCEPT the left wing and the right-eye cluster — those render
    as separate animated pieces layered on top. */
function OwlBody({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${ART} ${ART}`} fill="none">
      <Path
        d="M210 470 Q200 510 220 530 Q240 540 250 510"
        fill={CREAM}
        stroke={INK}
        strokeWidth={7}
        strokeLinejoin="round"
      />
      <Path
        d="M380 480 Q400 520 380 540 Q360 545 350 515"
        fill={CREAM}
        stroke={INK}
        strokeWidth={7}
        strokeLinejoin="round"
      />

      <Path
        d="M150 320
           C150 180, 250 110, 300 110
           C350 110, 450 180, 450 320
           C450 440, 380 500, 300 500
           C220 500, 150 440, 150 320 Z"
        fill={CREAM}
        stroke={INK}
        strokeWidth={9}
        strokeLinejoin="round"
      />

      <Path d="M218 355 Q230 343 242 355" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />
      <Path d="M250 360 Q262 348 274 360" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />
      <Path d="M326 360 Q338 348 350 360" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />
      <Path d="M358 355 Q370 343 382 355" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />
      <Path d="M228 410 Q240 398 252 410" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />
      <Path d="M260 420 Q272 408 284 420" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />
      <Path d="M316 420 Q328 408 340 420" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />
      <Path d="M348 410 Q360 398 372 410" stroke={INK} strokeWidth={4} fill="none" strokeLinecap="round" />

      <Ellipse cx={300} cy={380} rx={80} ry={80} fill={ACCENT_SOFT} opacity={0.55} />

      <Path d="M210 130 L195 80 L235 115 Z" fill={CREAM} stroke={INK} strokeWidth={8} strokeLinejoin="round" />
      <Path d="M390 130 L405 80 L365 115 Z" fill={CREAM} stroke={INK} strokeWidth={8} strokeLinejoin="round" />

      <Circle cx={240} cy={220} r={58} fill={SURFACE} stroke={INK} strokeWidth={9} />
      <Path d="M298 215 Q300 205 302 215" stroke={INK} strokeWidth={9} strokeLinecap="round" fill="none" />

      <Path d="M210 195 Q220 180 235 180" stroke={CREAM_2} strokeWidth={7} strokeLinecap="round" fill="none" />

      <Circle cx={248} cy={225} r={9} fill={INK} />
      <Circle cx={252} cy={221} r={3} fill={SURFACE} />

      <Path
        d="M300 250 L283 285 L317 285 Z"
        fill={ACCENT}
        stroke={INK}
        strokeWidth={7}
        strokeLinejoin="round"
      />
      <Path d="M291 285 Q300 295 309 285" stroke={INK} strokeWidth={5} strokeLinecap="round" fill="none" />

      <Ellipse cx={175} cy={265} rx={22} ry={14} fill={ACCENT} opacity={0.4} />
      <Ellipse cx={425} cy={265} rx={22} ry={14} fill={ACCENT} opacity={0.4} />

      <Path
        d="M440 320
           C460 320, 470 360, 450 410
           C430 440, 390 440, 380 410
           L380 350 Z"
        fill={CREAM}
        stroke={INK}
        strokeWidth={8}
        strokeLinejoin="round"
      />
      <Path d="M425 360 Q410 375 425 390" stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" />
      <Path d="M415 370 Q400 385 415 400" stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" />

      <G rotation={-22} origin="410, 430">
        <Rect x={395} y={425} width={60} height={22} rx={6} fill={ACCENT} stroke={INK} strokeWidth={6} />
        <Rect x={418} y={445} width={14} height={60} rx={4} fill={ACCENT_DEEP} stroke={INK} strokeWidth={6} />
        <Rect x={400} y={430} width={8} height={12} fill={INK} />
        <Rect x={442} y={430} width={8} height={12} fill={INK} />
      </G>

      <Path
        d="M260 495 L255 525 M275 495 L275 525 M290 495 L295 525"
        stroke={ACCENT_DEEP}
        strokeWidth={6}
        strokeLinecap="round"
      />
      <Path
        d="M310 495 L305 525 M325 495 L325 525 M340 495 L345 525"
        stroke={ACCENT_DEEP}
        strokeWidth={6}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function OwlWing({ width, height }: { width: number; height: number }) {
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`${WING_BOX.x} ${WING_BOX.y} ${WING_BOX.w} ${WING_BOX.h}`}
      fill="none"
    >
      <Path
        d="M160 320
           C140 320, 130 360, 150 410
           C170 440, 210 440, 220 410
           L220 350 Z"
        fill={CREAM}
        stroke={INK}
        strokeWidth={8}
        strokeLinejoin="round"
      />
      <Path d="M175 360 Q190 375 175 390" stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" />
      <Path d="M185 370 Q200 385 185 400" stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

function OwlEye({ width, height }: { width: number; height: number }) {
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`${EYE_BOX.x} ${EYE_BOX.y} ${EYE_BOX.w} ${EYE_BOX.h}`}
      fill="none"
    >
      <Circle cx={360} cy={220} r={58} fill={SURFACE} stroke={INK} strokeWidth={9} />
      <Path d="M330 195 Q340 180 355 180" stroke={CREAM_2} strokeWidth={7} strokeLinecap="round" fill="none" />
      <Circle cx={352} cy={225} r={9} fill={INK} />
      <Circle cx={356} cy={221} r={3} fill={SURFACE} />
    </Svg>
  );
}

/**
 * Libertasian owl mascot, ported from the web SVG
 * (apps/web/src/components/brand/owl.tsx) and structured so the left wing
 * waves and the right eye winks with RN core Animated only — transform-only,
 * `useNativeDriver: true` (same pattern as ui/Button).
 *
 * Honours the OS reduce-motion preference with the same null-until-known
 * pattern as HeaderAmbient: no loop is ever started that might immediately
 * need cancelling, and reduced motion renders the owl fully static.
 */
export function Owl({ size = 120, style }: OwlProps) {
  // null until the OS preference is known — we never start a loop we might
  // immediately have to cancel.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const wave = useRef(new Animated.Value(0)).current;
  const wink = useRef(new Animated.Value(0)).current;

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
    // Linear master clock — the keyframes live in the interpolation below.
    const waveLoop = Animated.loop(
      Animated.timing(wave, {
        toValue: 1,
        duration: WAVE_CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    // Blink shut, hold ~80ms so the wink registers, reopen — every 2s.
    const winkLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(1700),
        Animated.timing(wink, { toValue: 1, duration: 110, useNativeDriver: true }),
        Animated.delay(80),
        Animated.timing(wink, { toValue: 0, duration: 110, useNativeDriver: true }),
      ]),
    );
    waveLoop.start();
    winkLoop.start();
    return () => {
      waveLoop.stop();
      winkLoop.stop();
      wave.setValue(0);
      wink.setValue(0);
    };
  }, [reduceMotion, wave, wink]);

  const k = size / ART;
  const wingWidth = WING_BOX.w * k;
  const wingHeight = WING_BOX.h * k;
  const eyeWidth = EYE_BOX.w * k;
  const eyeHeight = EYE_BOX.h * k;

  // Hello wave: three quick swings in the first ~35% of the cycle, then rest
  // (same keyframes as the web `header-glow-owl-wave`).
  const wingRotate = wave.interpolate({
    inputRange: [0, 0.05, 0.1, 0.15, 0.2, 0.27, 0.35, 1],
    outputRange: ['0deg', '-30deg', '12deg', '-30deg', '12deg', '-30deg', '0deg', '0deg'],
  });
  const eyeScaleY = wink.interpolate({ inputRange: [0, 1], outputRange: [1, 0.08] });

  return (
    <View testID="owl" style={[{ width: size, height: size }, style]}>
      <OwlBody size={size} />
      <Animated.View
        testID="owl-wing"
        style={{
          position: 'absolute',
          left: WING_BOX.x * k,
          top: WING_BOX.y * k,
          width: wingWidth,
          height: wingHeight,
          // RN rotates around the view center; the translate pair biases the
          // pivot to the top edge — the wing shoulder — so the wave hinges
          // there instead of mid-feather.
          transform: [
            { translateY: -wingHeight / 2 },
            { rotate: wingRotate },
            { translateY: wingHeight / 2 },
          ],
        }}
      >
        <OwlWing width={wingWidth} height={wingHeight} />
      </Animated.View>
      <Animated.View
        testID="owl-eye-right"
        style={{
          position: 'absolute',
          left: EYE_BOX.x * k,
          top: EYE_BOX.y * k,
          width: eyeWidth,
          height: eyeHeight,
          // The crop is centred on the eye, so a bare scaleY squints in place.
          transform: [{ scaleY: eyeScaleY }],
        }}
      >
        <OwlEye width={eyeWidth} height={eyeHeight} />
      </Animated.View>
    </View>
  );
}
