'use client';

import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

import type { ReadAlongSegment } from '../types';
import { useActiveSegmentId, useReadAlongState } from './read-along-context';

/**
 * Split a section's (reading-ordered) sentence segments into consecutive
 * paragraph runs by `paragraphIndex`, restoring the original DB `\n\n` breaks
 * that the flat manifest list dropped. Missing `paragraphIndex` is paragraph 0.
 */
function splitParagraphs(
  sentences: readonly ReadAlongSegment[],
): ReadAlongSegment[][] {
  const paragraphs: ReadAlongSegment[][] = [];
  let lastIndex: number | null = null;
  for (const seg of sentences) {
    const index = seg.paragraphIndex ?? 0;
    if (index !== lastIndex || paragraphs.length === 0) {
      paragraphs.push([]);
      lastIndex = index;
    }
    paragraphs[paragraphs.length - 1]?.push(seg);
  }
  return paragraphs;
}

interface SectionReadAlongBodyProps {
  /** The `legal_document_sections` id — the manifest's `sectionKey`. */
  sectionId: string;
  /**
   * The reader's normal rendering of this section (plain text, or text with
   * annotation highlights). Shown whenever this section is not the one being
   * narrated, or before its manifest has loaded.
   */
  fallback: ReactNode;
}

/**
 * The section body, upgraded IN PLACE to a read-along highlight while this
 * section is narrating.
 *
 * There is deliberately no transcript panel: PR #243 removed one after the user
 * rejected it. The words that light up are the words already on the page, which
 * is the whole point — the reader keeps their position in the document.
 *
 * Consumes the manifest the single page `AudioPlayer` publishes through
 * `ReadAlongProvider`. When the published manifest belongs to a DIFFERENT
 * section (the chain has moved on, or the reader is looking elsewhere), this
 * renders `fallback` untouched, so only one section is ever span-wrapped.
 */
export function SectionReadAlongBody({
  sectionId,
  fallback,
}: SectionReadAlongBodyProps) {
  const state = useReadAlongState();
  const segments = state?.segments ?? null;

  // Only the segments for THIS section. A per-section rendition has exactly one
  // sectionKey, but filtering keeps the component honest if a whole-document
  // manifest is ever published here instead.
  const mine = useMemo(
    () =>
      (segments ?? []).filter(
        (seg) => seg.sectionKey === sectionId && seg.kind === 'sentence',
      ),
    [segments, sectionId],
  );

  const activeId = useActiveSegmentId(
    state?.audioRef ?? null,
    mine.length > 0 ? mine : null,
    state?.isPlaying ?? false,
  );

  // Keep the spoken sentence on screen, only when it changes.
  const activeRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (activeId == null) return;
    activeRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  if (mine.length === 0) {
    return <>{fallback}</>;
  }

  return (
    <span data-testid={`section-read-along-${sectionId}`}>
      {splitParagraphs(mine).map((paragraph, pIndex) => (
        <Fragment key={paragraph[0]?.id ?? pIndex}>
          {pIndex > 0 ? '\n\n' : ''}
          <span data-paragraph={paragraph[0]?.paragraphIndex ?? pIndex}>
            {paragraph.map((seg, i) => {
              const isActive = seg.id === activeId;
              return (
                <span
                  key={seg.id}
                  data-seg-id={seg.id}
                  data-active={isActive || undefined}
                  ref={
                    isActive
                      ? (el) => {
                          activeRef.current = el;
                        }
                      : undefined
                  }
                  className={cn(
                    'transition-colors',
                    isActive ? 'rounded bg-primary/15' : undefined,
                  )}
                >
                  {i > 0 ? ' ' : ''}
                  {seg.text}
                </span>
              );
            })}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
