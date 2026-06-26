'use client';

import { Fragment, useEffect, useMemo, useRef } from 'react';

import { cn } from '@/lib/utils';

import { useActiveSegmentId, useReadAlongState } from './read-along-context';
import type { ReadAlongSegment } from '../types';

/** One digest section as displayed on the page, in display order. */
export interface DigestSectionDef {
  /** Stable key matching the server manifest `sectionKey` (e.g. "facts"). */
  key: string;
  /** On-page heading label (e.g. "Dispositive Portion"). */
  title: string;
  /** The already-sanitized section text, or null to omit the section. */
  content: string | null;
}

/** Plain (non-read-along) section block — the graceful fallback rendering. */
function PlainSection({ title, content }: { title: string; content: string | null }) {
  if (!content) return null;
  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold uppercase text-muted-foreground">
        {title}
      </h2>
      <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
    </div>
  );
}

/** Heading + body sentence segments grouped under one section key. */
interface SectionGroup {
  heading?: ReadAlongSegment;
  sentences: ReadAlongSegment[];
}

function groupBySection(
  segments: readonly ReadAlongSegment[],
): Map<string, SectionGroup> {
  const groups = new Map<string, SectionGroup>();
  for (const seg of segments) {
    if (seg.kind === 'title') continue;
    const group = groups.get(seg.sectionKey) ?? { sentences: [] };
    if (seg.kind === 'heading') group.heading = seg;
    else group.sentences.push(seg);
    groups.set(seg.sectionKey, group);
  }
  return groups;
}

/**
 * Split a section's (reading-ordered) sentence segments into consecutive
 * paragraph runs by `paragraphIndex`, restoring the original DB `\n\n` breaks
 * that the flat manifest list dropped. Missing `paragraphIndex` is treated as 0.
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

interface ReadAlongSectionsProps {
  sections: DigestSectionDef[];
  segments: ReadAlongSegment[];
  audioRef: Parameters<typeof useActiveSegmentId>[0];
  isPlaying: boolean;
}

/**
 * Inline read-along rendering of the digest body, built FROM the manifest
 * segments (Bible.com / EPUB Media Overlays model). Each narrated section's
 * heading + sentences are span-wrapped in place; the active segment is
 * highlighted and scrolled into view as the audio plays. Sections without
 * segments (not narrated) fall back to plain rendering, so nothing is dropped.
 */
function ReadAlongSections({
  sections,
  segments,
  audioRef,
  isPlaying,
}: ReadAlongSectionsProps) {
  const groups = useMemo(() => groupBySection(segments), [segments]);
  const activeId = useActiveSegmentId(audioRef, segments, isPlaying);

  // Auto-scroll the active segment into view, only when it changes.
  const activeRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (activeId == null) return;
    activeRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  const highlight = (id: string) =>
    id === activeId ? 'rounded bg-primary/15' : undefined;

  return (
    <div className="space-y-5" data-testid="read-along-body">
      {sections.map((section) => {
        const group = groups.get(section.key);
        if (!group || group.sentences.length === 0) {
          return (
            <PlainSection
              key={section.key}
              title={section.title}
              content={section.content}
            />
          );
        }
        const headingActive = group.heading?.id === activeId;
        return (
          <div key={section.key}>
            <h2
              {...(group.heading ? { 'data-seg-id': group.heading.id } : {})}
              ref={
                headingActive
                  ? (el) => {
                      activeRef.current = el;
                    }
                  : undefined
              }
              className={cn(
                'mb-1 text-sm font-semibold uppercase text-muted-foreground',
                group.heading ? highlight(group.heading.id) : undefined,
              )}
            >
              {section.title}
            </h2>
            {/* whitespace-pre-wrap + literal "\n\n" between paragraph runs
                reproduces the exact blank-line gap of the plain render, while
                each run is a distinct [data-paragraph] block. */}
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {splitParagraphs(group.sentences).map((paragraph, pIndex) => (
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
                            'px-0.5 transition-colors',
                            highlight(seg.id),
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
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Digest body that upgrades to inline read-along when the manifest is loaded,
 * and renders plain sections otherwise (until segments load, or for legacy rows
 * without a manifest). Consumes the read-along state published by the
 * `AudioPlayer` via {@link ReadAlongProvider}.
 */
export function DigestReadAlongBody({ sections }: { sections: DigestSectionDef[] }) {
  const state = useReadAlongState();
  const segments = state?.segments ?? null;

  if (!segments || segments.length === 0) {
    return (
      <div className="space-y-5">
        {sections.map((section) => (
          <PlainSection
            key={section.key}
            title={section.title}
            content={section.content}
          />
        ))}
      </div>
    );
  }

  return (
    <ReadAlongSections
      sections={sections}
      segments={segments}
      audioRef={state?.audioRef ?? null}
      isPlaying={state?.isPlaying ?? false}
    />
  );
}
