'use client';

import { useEffect, useState } from 'react';

import { parseReadAlong } from '../lib/parse-readalong';
import type { ReadAlongSegment } from '../types';

/**
 * Fetch + parse the segment read-along manifest from its presigned S3 URL.
 *
 * Uses a plain `fetch` (NOT apiClient — the URL is already signed, same as the
 * old marks fetch). Returns `null` segments while loading, when `readalongUrl`
 * is null (legacy rows), or on any failure — callers fall back to plain text.
 */
export function useReadAlongSegments(
  readalongUrl: string | null,
): ReadAlongSegment[] | null {
  const [segments, setSegments] = useState<ReadAlongSegment[] | null>(null);

  useEffect(() => {
    if (!readalongUrl) {
      setSegments(null);
      return;
    }
    const controller = new AbortController();
    setSegments(null);
    fetch(readalongUrl, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`readalong fetch failed: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        const manifest = parseReadAlong(text);
        setSegments(manifest && manifest.segments.length > 0 ? manifest.segments : null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSegments(null);
      });
    return () => controller.abort();
  }, [readalongUrl]);

  return segments;
}
