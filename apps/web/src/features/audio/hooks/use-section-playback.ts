'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/lib/api-client';

import { buildSectionQueue, type PlayableSection } from '../lib/section-audio';
import type { AudioRenditionResponse } from '../types';

export interface SectionPlayback {
  /** The section currently loaded into the single page player; null = none. */
  activeSectionId: string | null;
  /** Start (or switch to) a section. The ONLY thing that triggers a fetch. */
  playSection: (sectionId: string) => void;
  /** True when playback should auto-start — i.e. the reader asked for it. */
  autoStart: boolean;
  /** "Play whole document" — chains sections in `ordering` order. */
  continueEnabled: boolean;
  setContinueEnabled: (enabled: boolean) => void;
  /** Start at the first section with chaining on. */
  playWholeDocument: () => void;
  /** Call when narration ends naturally — advances the chain if enabled. */
  handleEnded: () => void;
  /** True once the chain runs off the end of the document. */
  atEndOfDocument: boolean;
}

/**
 * Drives per-section playback for the document reader.
 *
 * Deliberately NOT `useContinuousDigestPlayback`: that hook advances by
 * `router.push('/digests/<next>?autoplay=1')` and extends its queue from a
 * cursor-paginated list endpoint. A document reader has neither — every section
 * is already in memory from `useDocumentSections`, and advancing is a state
 * change inside one page, not a navigation. What IS carried over is the part
 * that was hard to get right: the de-duplicated queue, the
 * `nextId !== currentId` advance guard, and re-reading the continue flag AFTER
 * the await so a reader who changes their mind mid-fetch is not yanked forward.
 *
 * `continueEnabled` is page-local and defaults OFF, matching the digest
 * autoplay default. It is deliberately not the persisted digest preference:
 * turning on "play the whole Civil Code" should not silently turn on
 * digest-to-digest autoplay everywhere else.
 */
export function useSectionPlayback(
  sections: readonly PlayableSection[] | null | undefined,
): SectionPlayback {
  const queryClient = useQueryClient();

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [continueEnabled, setContinueEnabledState] = useState(false);
  const [atEndOfDocument, setAtEndOfDocument] = useState(false);

  // Ref mirrors read INSIDE async work. React state captured in a closure is
  // the state at the time `handleEnded` was created, which is exactly the stale
  // value the guards must not trust.
  const continueRef = useRef(false);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeSectionId;

  const setContinueEnabled = useCallback((enabled: boolean) => {
    continueRef.current = enabled;
    setContinueEnabledState(enabled);
  }, []);

  const playSection = useCallback((sectionId: string) => {
    setAtEndOfDocument(false);
    setAutoStart(true);
    setActiveSectionId(sectionId);
  }, []);

  const playWholeDocument = useCallback(() => {
    const queue = buildSectionQueue(sections);
    const first = queue[0];
    if (!first) return;
    setContinueEnabled(true);
    playSection(first);
  }, [playSection, sections, setContinueEnabled]);

  /**
   * Warm the next section's rendition before swapping the player to it.
   *
   * The backfill is still running, so a section may well be un-synthesized: the
   * first not-ready GET is what ENQUEUES it. Doing that here means the swap
   * lands on a player that is already loading rather than one that starts from
   * nothing, and it gives the guards below a real await to be checked across.
   */
  const prefetchRendition = useCallback(
    (sectionId: string) =>
      queryClient.fetchQuery({
        queryKey: ['audio-rendition', 'legal_document_section', sectionId],
        queryFn: async () => {
          const res = await apiClient.get<{
            success: true;
            data: AudioRenditionResponse;
          }>(`/audio/legal_document_section/${encodeURIComponent(sectionId)}`, {
            params: { language: 'en' },
          });
          return res.data;
        },
      }),
    [queryClient],
  );

  const handleEnded = useCallback(() => {
    if (!continueRef.current) return;

    const currentId = activeRef.current;
    if (!currentId) return;

    const queue = buildSectionQueue(sections);
    const index = queue.indexOf(currentId);
    const nextId = index >= 0 ? queue[index + 1] : undefined;

    // `nextId !== currentId` alongside the queue dedupe: with unique ids and a
    // strictly-forward index walk the chain always terminates.
    if (!nextId || nextId === currentId) {
      setAtEndOfDocument(true);
      return;
    }

    void (async () => {
      try {
        await prefetchRendition(nextId);
      } catch {
        // 402 past the free document cap, or a network blip. Either way the
        // chain stops rather than marching through the rest of the document
        // swapping in players that cannot play.
        setAtEndOfDocument(true);
        return;
      }
      // Re-read AFTER the await. The reader may have toggled "play whole
      // document" off, or clicked a different section, while it was in flight —
      // neither should be overridden by a resolved closure.
      if (!continueRef.current || activeRef.current !== currentId) return;
      setAutoStart(true);
      setActiveSectionId(nextId);
    })();
  }, [prefetchRendition, sections]);

  return {
    activeSectionId,
    playSection,
    autoStart,
    continueEnabled,
    setContinueEnabled,
    playWholeDocument,
    handleEnded,
    atEndOfDocument,
  };
}
