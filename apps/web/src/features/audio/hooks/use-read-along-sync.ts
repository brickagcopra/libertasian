'use client';

import { useEffect, useState, type RefObject } from 'react';

import { activeWordIndex } from '../lib/parse-marks';
import type { WordMark } from '../types';

/**
 * Drive read-along highlighting from the audio element's playback clock.
 *
 * Runs a requestAnimationFrame loop (only while `active`) that reads
 * `audio.currentTime`, maps it to a word index, and updates state ONLY when the
 * active index changes — so a 60fps loop does not trigger 60 re-renders/sec.
 * The rAF is cancelled on unmount and whenever `active` goes false (pause), per
 * the cost/perf guard. Returns the active word index, or -1 when none.
 */
export function useReadAlongSync(
  audioRef: RefObject<HTMLAudioElement | null>,
  words: WordMark[],
  active: boolean,
): number {
  const [index, setIndex] = useState(-1);

  useEffect(() => {
    if (!active) return;
    const el = audioRef.current;
    if (!el) return;

    let raf = 0;
    const tick = () => {
      const currentMs = el.currentTime * 1000;
      const next = activeWordIndex(words, currentMs);
      setIndex((prev) => (prev === next ? prev : next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, [active, words, audioRef]);

  return index;
}
