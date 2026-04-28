'use client';

import { Children, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import {
  cardRevealVariants,
  cardRevealVariantsReduced,
  motionTokens,
} from '@/lib/motion';

interface StaggerGridProps {
  children: ReactNode;
  className?: string;
  /** Pulled from motionTokens.stagger by default. */
  stagger?: number;
  /** Optional hover lift on each child. Default true. */
  hoverLift?: boolean;
}

/**
 * Wraps each top-level child in a motion.div that fades+rises into view
 * with a staggered delay. Reduced-motion: opacity-only, no Y translate,
 * no hover scale.
 *
 * Server Components can render this around their existing card grids —
 * the parent stays SC, only the wrapper is client.
 */
export function StaggerGrid({
  children,
  className,
  stagger,
  hoverLift = true,
}: StaggerGridProps) {
  const reduce = useReducedMotion();
  const variants = reduce ? cardRevealVariantsReduced : cardRevealVariants;
  const staggerAmount = stagger ?? motionTokens.stagger.card;

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        visible: {
          transition: { staggerChildren: staggerAmount },
        },
      }}
    >
      {Children.map(children, (child, idx) => (
        <motion.div
          key={idx}
          variants={variants}
          transition={{ duration: motionTokens.duration.base }}
          whileHover={
            !reduce && hoverLift ? { scale: 1.02, y: -2 } : undefined
          }
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
