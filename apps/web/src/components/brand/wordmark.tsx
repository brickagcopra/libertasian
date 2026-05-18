'use client';

import Link from 'next/link';

interface WordmarkProps {
  /** Square pixel size of the "L" badge. Wordmark text scales proportionally. */
  size?: number;
  /** Wrap in a <Link href="/">. Set false when caller wraps in its own link. */
  asLink?: boolean;
  className?: string;
  /** Override the wordmark text. Defaults to "libertasian". */
  label?: string;
}

/**
 * Warm-editorial wordmark: cream-on-ink "L" badge + Fraunces lowercase
 * wordmark. Used in the public header, the dashboard sidebar, and the
 * auth pages so all three surfaces share the same brand identity.
 */
export function Wordmark({
  size = 36,
  asLink = true,
  className,
  label = 'libertasian',
}: WordmarkProps) {
  const badgeFontSize = Math.round(size * 0.6);
  const wordmarkFontSize = Math.round(size * 0.65);

  const inner = (
    <span className={`flex items-center gap-2.5 ${className ?? ''}`}>
      <span
        aria-hidden
        className="flex items-center justify-center rounded-[10px] leading-none"
        style={{
          width: size,
          height: size,
          background: 'var(--warm-ink)',
          color: 'var(--warm-cream)',
          fontFamily: 'var(--font-display)',
          fontWeight: 500,
          fontSize: badgeFontSize,
          letterSpacing: '-0.5px',
        }}
      >
        L
      </span>
      <span
        className="font-medium tracking-[-0.6px]"
        style={{
          fontFamily: 'var(--font-display)',
          color: 'var(--warm-ink)',
          fontSize: wordmarkFontSize,
        }}
      >
        {label}
      </span>
    </span>
  );

  if (!asLink) return inner;

  return (
    <Link href="/" aria-label="LIBERTASIAN" className="inline-flex items-center">
      {inner}
    </Link>
  );
}
