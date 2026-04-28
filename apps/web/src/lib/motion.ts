import type { Transition } from 'framer-motion';

/**
 * Shared motion tokens for the LIBERTASIAN admin/library surfaces. Use
 * these instead of inline magic numbers — keeping a small palette is
 * what differentiates a coherent motion system from random UI jiggle.
 *
 * Reduced-motion: every consumer must check `useReducedMotion()` from
 * framer-motion (or the prefers-reduced-motion media query) and either
 * skip animation entirely or fall back to opacity-only fades.
 */
export const motionTokens = {
  duration: {
    fast: 0.15,
    base: 0.25,
    slow: 0.4,
  },
  easing: {
    spring: { type: 'spring', stiffness: 380, damping: 30 } as Transition,
    smooth: [0.4, 0, 0.2, 1] as const,
  },
  stagger: {
    card: 0.06,
    list: 0.04,
  },
} as const;

export const cardRevealVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
} as const;

export const cardRevealVariantsReduced = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
} as const;
