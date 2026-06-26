'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

import { useReadAlongSync } from '../hooks/use-read-along-sync';
import { parseMarks } from '../lib/parse-marks';
import type { ParsedMarks, WordMark } from '../types';

interface ReadAlongPanelProps {
  /** Presigned NDJSON speech-marks URL (already known to be non-null by parent). */
  marksUrl: string;
  /** The player's <audio> element — read for the playback clock. */
  audioRef: RefObject<HTMLAudioElement | null>;
  /** Whether the audio is currently playing (gates the rAF sync loop). */
  isPlaying: boolean;
}

interface SentenceGroup {
  key: number;
  /** Word entries carrying their GLOBAL index into the flat `words` array. */
  words: Array<{ globalIndex: number; word: WordMark }>;
}

/**
 * Group flat word marks under their containing sentence using char offsets, so
 * the transcript renders sentence-by-sentence while highlight indexing stays
 * against the flat word array that `useReadAlongSync` returns.
 */
function groupWordsBySentence({ words, sentences }: ParsedMarks): SentenceGroup[] {
  if (sentences.length === 0) {
    // No sentence marks — fall back to a single group of all words.
    return [
      {
        key: 0,
        words: words.map((word, globalIndex) => ({ globalIndex, word })),
      },
    ];
  }

  const groups: SentenceGroup[] = sentences.map((s, key) => ({ key, words: [] }));
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    // Last sentence whose range starts at or before this word.
    let target = 0;
    for (let s = 0; s < sentences.length; s++) {
      const sentence = sentences[s];
      if (sentence && word.start >= sentence.start) target = s;
      else break;
    }
    groups[target]?.words.push({ globalIndex: i, word });
  }
  return groups.filter((g) => g.words.length > 0);
}

/**
 * Read-along transcript that follows the narration audio. Fetches + parses the
 * presigned NDJSON marks with plain `fetch` (NOT apiClient — the URL is already
 * signed), highlights the spoken word, and auto-scrolls it into view.
 *
 * This is the spoken/normalized text, not the canonical digest — labelled as
 * such so users don't mistake it for the source document.
 */
export function ReadAlongPanel({ marksUrl, audioRef, isPlaying }: ReadAlongPanelProps) {
  const [marks, setMarks] = useState<ParsedMarks | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setMarks(null);
    setFailed(false);
    fetch(marksUrl, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`marks fetch failed: ${res.status}`);
        return res.text();
      })
      .then((text) => setMarks(parseMarks(text)))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [marksUrl]);

  const groups = useMemo(
    () => (marks ? groupWordsBySentence(marks) : []),
    [marks],
  );

  const activeIndex = useReadAlongSync(audioRef, marks?.words ?? [], isPlaying);

  const activeWordRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (activeIndex < 0) return;
    activeWordRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <div className="mt-3 rounded-lg border bg-muted/30 p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Narration transcript — follows the audio
      </p>

      {failed ? (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load the transcript. Audio still plays above.
        </p>
      ) : !marks ? (
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground"
          data-testid="read-along-loading"
        >
          <Loader2 className="size-4 animate-spin" />
          Loading transcript…
        </div>
      ) : (
        <div
          className="max-h-72 space-y-2 overflow-y-auto text-sm leading-relaxed"
          data-testid="read-along-transcript"
        >
          {groups.map((group) => (
            <p key={group.key}>
              {group.words.map(({ globalIndex, word }) => {
                const isActive = globalIndex === activeIndex;
                return (
                  <span
                    key={globalIndex}
                    ref={isActive ? activeWordRef : undefined}
                    data-active={isActive || undefined}
                    className={cn(
                      'rounded px-0.5 transition-colors',
                      isActive
                        ? 'bg-primary/20 text-foreground'
                        : 'text-muted-foreground',
                    )}
                  >
                    {word.value}{' '}
                  </span>
                );
              })}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
