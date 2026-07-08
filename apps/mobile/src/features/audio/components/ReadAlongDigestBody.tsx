import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Text, View, type ScrollView } from 'react-native';

import {
  DigestPlainSections,
  type DigestSection,
} from '@/components/screens/DigestDetailScreen';
import { useTheme } from '@/providers/theme-provider';
import { useReadAlongSegments } from '../hooks/use-readalong-segments';
import { activeSegmentIndex } from '../lib/parse-readalong';
import {
  isAutoFollowSuspended,
  useReadAlongSelector,
} from '../stores/read-along-store';
import type { ReadAlongSegment } from '../types';

/**
 * Keep the active block this far below the top edge when auto-following —
 * clears the absolutely-positioned top action row (54 + 38) with breathing room.
 */
const FOLLOW_TOP_OFFSET = 130;

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
  contentKey: string;
  sections: DigestSection[];
  segments: ReadAlongSegment[];
  scrollRef: RefObject<ScrollView | null>;
}

/**
 * Inline read-along rendering of the digest body, built FROM the manifest
 * segments (port of apps/web/src/features/audio/components/
 * digest-read-along-body.tsx). Each narrated section's sentences become nested
 * `<Text>` spans; the active one is highlighted as the audio plays. Sections
 * without segments render their plain paragraphs, so nothing is dropped.
 *
 * Auto-follow: RN cannot measure nested Text spans, so we follow at
 * PARAGRAPH granularity — each paragraph run is a `<View>` we can
 * `measureLayout` against the screen's ScrollView and `scrollTo`. Follow runs
 * only while playing and is suspended for 5s after a manual drag.
 */
function ReadAlongSections({
  contentKey,
  sections,
  segments,
  scrollRef,
}: ReadAlongSectionsProps) {
  const { theme } = useTheme();
  const groups = useMemo(() => groupBySection(segments), [segments]);

  // Derived subscriptions: re-render ONLY when the id / flag changes, never on
  // every 250ms position tick (the store notifies; the selector dedupes).
  const activeId = useReadAlongSelector((s) => {
    if (s.contentKey !== contentKey) return null;
    const idx = activeSegmentIndex(segments, s.positionMillis);
    return idx >= 0 ? (segments[idx]?.id ?? null) : null;
  });
  const isPlaying = useReadAlongSelector(
    (s) => s.contentKey === contentKey && s.isPlaying,
  );

  // Scrollable block per section (`sectionKey`) and paragraph run
  // (`sectionKey:paragraphIndex`); headings map to their section block.
  const blockRefs = useRef(new Map<string, View | null>());
  const blockKeyBySegId = useMemo(() => {
    const map = new Map<string, string>();
    for (const [sectionKey, group] of groups) {
      if (group.heading) map.set(group.heading.id, sectionKey);
      splitParagraphs(group.sentences).forEach((paragraph, pIndex) => {
        for (const seg of paragraph) map.set(seg.id, `${sectionKey}:${pIndex}`);
      });
    }
    return map;
  }, [groups]);

  const activeBlockKey = activeId ? (blockKeyBySegId.get(activeId) ?? null) : null;

  // Gently follow the narration when the active segment crosses into a new
  // paragraph/section block. Programmatic scrollTo does not fire
  // onScrollBeginDrag, so it never re-suspends itself.
  useEffect(() => {
    if (!activeBlockKey || !isPlaying || isAutoFollowSuspended()) return;
    const block = blockRefs.current.get(activeBlockKey);
    const scroll = scrollRef.current;
    if (!block || !scroll) return;
    const container = scroll.getInnerViewNode?.() as number | null;
    if (container == null) return;
    block.measureLayout(
      container,
      (_x, y) => {
        scrollRef.current?.scrollTo({
          y: Math.max(0, y - FOLLOW_TOP_OFFSET),
          animated: true,
        });
      },
      () => {
        /* measurement failed (unmounted mid-flight) — skip this follow */
      },
    );
  }, [activeBlockKey, isPlaying, scrollRef]);

  const highlight = { backgroundColor: theme.accentSoft };

  return (
    <View testID="read-along-body">
      {sections.map((section) => {
        const group = groups.get(section.id);
        if (!group || group.sentences.length === 0) {
          return <DigestPlainSections key={section.id} sections={[section]} />;
        }
        const headingActive = group.heading?.id === activeId;
        return (
          <View
            key={section.id}
            style={{ marginTop: 22 }}
            ref={(el) => {
              blockRefs.current.set(section.id, el);
            }}
          >
            <Text
              style={[
                {
                  marginBottom: 8,
                  fontFamily: theme.serif,
                  fontSize: 22,
                  letterSpacing: -0.4,
                  color: theme.ink,
                },
                headingActive ? highlight : null,
              ]}
            >
              {section.heading}
            </Text>
            {splitParagraphs(group.sentences).map((paragraph, pIndex) => (
              <View
                key={paragraph[0]?.id ?? pIndex}
                style={{ marginTop: pIndex === 0 ? 0 : 14 }}
                ref={(el) => {
                  blockRefs.current.set(`${section.id}:${pIndex}`, el);
                }}
              >
                <Text
                  style={{
                    fontFamily: theme.serif,
                    fontSize: 17,
                    lineHeight: 26.35,
                    color: theme.ink,
                  }}
                >
                  {paragraph.map((seg, i) => {
                    const isActive = seg.id === activeId;
                    return (
                      <Text
                        key={seg.id}
                        testID={isActive ? 'active-segment' : undefined}
                        style={isActive ? highlight : undefined}
                      >
                        {i > 0 ? ' ' : ''}
                        {seg.text}
                      </Text>
                    );
                  })}
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

interface ReadAlongDigestBodyProps {
  /** Digest id — must match the `AudioPlayerBar` contentId on the same screen. */
  contentId: string;
  /** The screen's sections, keyed to match the server manifest sectionKeys. */
  sections: DigestSection[];
  /** Ref to the DigestDetailScreen ScrollView, for auto-follow. */
  scrollRef: RefObject<ScrollView | null>;
}

/**
 * Digest body that upgrades to inline read-along once the manifest is loaded
 * AND playback has started, and renders the plain sections otherwise — before
 * the user taps Listen the output is byte-identical to the default
 * `DigestPlainSections` body. A manifest fetch failure (or legacy rendition
 * without one) permanently stays on the plain body; playback is unaffected.
 */
export function ReadAlongDigestBody({
  contentId,
  sections,
  scrollRef,
}: ReadAlongDigestBodyProps) {
  const contentKey = `digest:${contentId}`;
  const readalongUrl = useReadAlongSelector((s) =>
    s.contentKey === contentKey ? s.readalongUrl : null,
  );
  const hasStarted = useReadAlongSelector(
    (s) => s.contentKey === contentKey && s.hasStarted,
  );
  const segments = useReadAlongSegments(readalongUrl);

  if (!hasStarted || !segments || segments.length === 0) {
    return <DigestPlainSections sections={sections} />;
  }

  return (
    <ReadAlongSections
      contentKey={contentKey}
      sections={sections}
      segments={segments}
      scrollRef={scrollRef}
    />
  );
}
