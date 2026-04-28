'use client';

import { motion, useReducedMotion } from 'framer-motion';

const ACCENT = '#2563eb';
const STROKE = '#1f2937';

interface IllustrationProps {
  className?: string;
  ariaLabel?: string;
}

/**
 * Scales of justice, slightly tilted with a slow idle sway. Monochrome
 * with one accent color from the existing theme. Reduced-motion users
 * see the static art.
 */
export function ScalesEmptyIllustration({
  className,
  ariaLabel = 'Scales of justice — empty state',
}: IllustrationProps) {
  const reduce = useReducedMotion();
  const sway = reduce
    ? undefined
    : { rotate: [0, 1.5, 0, -1.5, 0] };
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      className={className}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Base + post */}
      <line
        x1="100"
        y1="170"
        x2="100"
        y2="50"
        stroke={STROKE}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <rect x="70" y="170" width="60" height="6" rx="2" fill={STROKE} />
      <rect x="92" y="40" width="16" height="14" rx="3" fill={ACCENT} />
      {/* Sway group: beam + pans */}
      <motion.g
        animate={sway}
        transition={{
          duration: 4,
          ease: 'easeInOut',
          repeat: reduce ? 0 : Infinity,
        }}
        style={{ originX: '100px', originY: '60px' }}
      >
        <line
          x1="40"
          y1="60"
          x2="160"
          y2="60"
          stroke={STROKE}
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* Left pan + chains */}
        <line x1="50" y1="60" x2="40" y2="100" stroke={STROKE} strokeWidth="1.5" />
        <line x1="50" y1="60" x2="60" y2="100" stroke={STROKE} strokeWidth="1.5" />
        <path
          d="M30 100 Q50 120 70 100 Z"
          stroke={STROKE}
          strokeWidth="2"
          fill="rgba(37, 99, 235, 0.08)"
        />
        {/* Right pan + chains */}
        <line x1="150" y1="60" x2="140" y2="100" stroke={STROKE} strokeWidth="1.5" />
        <line x1="150" y1="60" x2="160" y2="100" stroke={STROKE} strokeWidth="1.5" />
        <path
          d="M130 100 Q150 120 170 100 Z"
          stroke={STROKE}
          strokeWidth="2"
          fill="rgba(37, 99, 235, 0.08)"
        />
      </motion.g>
    </svg>
  );
}

/**
 * Open law book with a gentle floating sparkle dot above. Used when an
 * archive or list has no items yet.
 */
export function ArchiveEmptyIllustration({
  className,
  ariaLabel = 'Open book — empty archive',
}: IllustrationProps) {
  const reduce = useReducedMotion();
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      className={className}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Pages */}
      <path
        d="M30 70 L100 50 L100 160 L30 180 Z"
        stroke={STROKE}
        strokeWidth="2.5"
        fill="rgba(37, 99, 235, 0.05)"
        strokeLinejoin="round"
      />
      <path
        d="M170 70 L100 50 L100 160 L170 180 Z"
        stroke={STROKE}
        strokeWidth="2.5"
        fill="white"
        strokeLinejoin="round"
      />
      <line x1="100" y1="50" x2="100" y2="160" stroke={STROKE} strokeWidth="2" />
      {/* Lines on pages */}
      <line x1="48" y1="90" x2="90" y2="80" stroke={STROKE} strokeWidth="1" opacity="0.4" />
      <line x1="48" y1="105" x2="90" y2="95" stroke={STROKE} strokeWidth="1" opacity="0.4" />
      <line x1="48" y1="120" x2="80" y2="112" stroke={STROKE} strokeWidth="1" opacity="0.4" />
      <line x1="110" y1="80" x2="152" y2="90" stroke={STROKE} strokeWidth="1" opacity="0.4" />
      <line x1="110" y1="95" x2="152" y2="105" stroke={STROKE} strokeWidth="1" opacity="0.4" />
      <line x1="110" y1="110" x2="142" y2="120" stroke={STROKE} strokeWidth="1" opacity="0.4" />
      {/* Sparkle */}
      <motion.g
        animate={
          reduce
            ? undefined
            : { y: [0, -6, 0], opacity: [0.6, 1, 0.6] }
        }
        transition={{
          duration: 3.2,
          ease: 'easeInOut',
          repeat: reduce ? 0 : Infinity,
        }}
      >
        <circle cx="140" cy="35" r="3" fill={ACCENT} />
        <circle cx="60" cy="30" r="2" fill={ACCENT} opacity="0.6" />
        <circle cx="100" cy="22" r="2.5" fill={ACCENT} opacity="0.8" />
      </motion.g>
    </svg>
  );
}

/**
 * Clock + downloading-document motif. Used for "ingest pending" / "no
 * jobs queued yet" empty states. Clock hand rotates slowly.
 */
export function IngestPendingIllustration({
  className,
  ariaLabel = 'Clock with document — ingestion pending',
}: IllustrationProps) {
  const reduce = useReducedMotion();
  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      className={className}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Document */}
      <path
        d="M50 40 H120 L150 70 V170 H50 Z"
        stroke={STROKE}
        strokeWidth="2.5"
        fill="white"
        strokeLinejoin="round"
      />
      <path
        d="M120 40 V70 H150"
        stroke={STROKE}
        strokeWidth="2.5"
        fill="none"
      />
      <line x1="65" y1="95" x2="135" y2="95" stroke={STROKE} strokeWidth="1.5" opacity="0.4" />
      <line x1="65" y1="110" x2="135" y2="110" stroke={STROKE} strokeWidth="1.5" opacity="0.4" />
      <line x1="65" y1="125" x2="115" y2="125" stroke={STROKE} strokeWidth="1.5" opacity="0.4" />
      {/* Clock face */}
      <circle cx="140" cy="150" r="22" stroke={STROKE} strokeWidth="2.5" fill="white" />
      {/* Hour hand */}
      <line
        x1="140"
        y1="150"
        x2="140"
        y2="138"
        stroke={STROKE}
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Minute hand: rotates */}
      <motion.line
        x1="140"
        y1="150"
        x2="148"
        y2="150"
        stroke={ACCENT}
        strokeWidth="2"
        strokeLinecap="round"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{
          duration: 6,
          ease: 'linear',
          repeat: reduce ? 0 : Infinity,
        }}
        style={{ originX: '140px', originY: '150px' }}
      />
      <circle cx="140" cy="150" r="2" fill={STROKE} />
    </svg>
  );
}
