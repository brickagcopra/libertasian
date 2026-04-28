'use client';

import { useEffect, useRef, useState } from 'react';
import {
  animate,
  useMotionValue,
  useReducedMotion,
  motion,
} from 'framer-motion';

import { motionTokens } from '@/lib/motion';

interface AnimatedCounterProps {
  value: number;
  className?: string;
  formatter?: (n: number) => string;
  /** ms duration of count-up between increments; default 800. */
  countUpDurationMs?: number;
}

const defaultFormatter = (n: number) => Math.round(n).toLocaleString();

/**
 * Animated number counter. Initial render shows the full value (so SSR
 * and tests aren't dependent on RAF firing). On subsequent upward value
 * changes, animates display from previous to new and pulses
 * (scale 1 → 1.15 → 1) so increment events draw the eye.
 *
 * Honors prefers-reduced-motion: renders the static formatted value
 * with no animation and no pulse.
 */
export function AnimatedCounter({
  value,
  className,
  formatter = defaultFormatter,
  countUpDurationMs = 800,
}: AnimatedCounterProps) {
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(value);
  const [display, setDisplay] = useState(value);
  const [pulseKey, setPulseKey] = useState(0);
  const previousValueRef = useRef<number>(value);

  useEffect(() => {
    const previous = previousValueRef.current;
    if (reduce || previous === value) {
      previousValueRef.current = value;
      setDisplay(value);
      return;
    }

    motionValue.set(previous);
    const controls = animate(motionValue, value, {
      duration: countUpDurationMs / 1000,
      ease: motionTokens.easing.smooth as unknown as number[],
      onUpdate: (latest) => setDisplay(latest),
    });

    if (value > previous) setPulseKey((k) => k + 1);
    previousValueRef.current = value;
    return () => controls.stop();
  }, [value, reduce, motionValue, countUpDurationMs]);

  if (reduce) {
    return <span className={className}>{formatter(value)}</span>;
  }

  return (
    <motion.span
      key={pulseKey}
      className={className}
      initial={false}
      animate={
        pulseKey === 0
          ? undefined
          : { scale: [1, 1.15, 1], color: ['#1f2937', '#2563eb', '#1f2937'] }
      }
      transition={{ duration: motionTokens.duration.slow, times: [0, 0.4, 1] }}
    >
      {formatter(display)}
    </motion.span>
  );
}
