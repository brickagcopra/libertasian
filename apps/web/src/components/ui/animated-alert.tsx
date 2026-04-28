'use client';

import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { motionTokens } from '@/lib/motion';

interface AnimatedAlertProps {
  /** When null, the alert is not rendered. */
  message: { type: 'success' | 'error'; text: ReactNode } | null;
  className?: string;
}

const SLIDE_VARIANTS = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 24 },
} as const;

const REDUCED_VARIANTS = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
} as const;

/**
 * Inline status alert with an animated check/X SVG that draws in via
 * stroke-dasharray on mount, plus a slide-in from right. Mirrors the
 * project's existing inline-message pattern but adds tactile feedback.
 */
export function AnimatedAlert({ message, className }: AnimatedAlertProps) {
  const reduce = useReducedMotion();
  const variants = reduce ? REDUCED_VARIANTS : SLIDE_VARIANTS;

  return (
    <AnimatePresence mode="wait">
      {message && (
        <motion.div
          key={`${message.type}-${typeof message.text === 'string' ? message.text : ''}`}
          role="status"
          aria-live="polite"
          initial="hidden"
          animate="visible"
          exit="exit"
          variants={variants}
          transition={{ duration: motionTokens.duration.base }}
          className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
            message.type === 'error'
              ? 'bg-red-50 text-red-700'
              : 'bg-green-50 text-green-700'
          } ${className ?? ''}`}
        >
          <DrawnIcon
            kind={message.type}
            reduce={reduce ?? false}
          />
          <span className="flex-1">{message.text}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DrawnIcon({
  kind,
  reduce,
}: {
  kind: 'success' | 'error';
  reduce: boolean;
}) {
  const color = kind === 'success' ? '#15803d' : '#b91c1c';
  const draw = reduce
    ? { pathLength: 1 }
    : {
        pathLength: [0, 1],
      };
  const drawTransition = reduce
    ? { duration: 0 }
    : { duration: 0.3, ease: 'easeOut' as const };

  if (kind === 'success') {
    return (
      <svg
        role="img"
        aria-label="Success"
        viewBox="0 0 24 24"
        className="mt-0.5 h-4 w-4 flex-none"
        fill="none"
      >
        <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" />
        <motion.path
          d="M7 12.5L10.5 16L17 9.5"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
          animate={draw}
          transition={drawTransition}
        />
      </svg>
    );
  }
  return (
    <svg
      role="img"
      aria-label="Error"
      viewBox="0 0 24 24"
      className="mt-0.5 h-4 w-4 flex-none"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="1.5" />
      <motion.path
        d="M9 9L15 15"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
        animate={draw}
        transition={drawTransition}
      />
      <motion.path
        d="M15 9L9 15"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
        animate={draw}
        transition={{ ...drawTransition, delay: reduce ? 0 : 0.1 }}
      />
    </svg>
  );
}
