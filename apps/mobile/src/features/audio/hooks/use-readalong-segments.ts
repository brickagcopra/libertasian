import { useEffect, useState } from 'react';

import { parseReadAlong } from '../lib/parse-readalong';
import type { ReadAlongSegment } from '../types';

/**
 * Fetch + parse the segment read-along manifest from its presigned S3 URL.
 * Port of apps/web/src/features/audio/hooks/use-readalong-segments.ts.
 *
 * Uses a BARE `fetch` (NOT apiClient, NO Authorization header — the presigned
 * URL is itself the credential). Returns `null` segments while loading, when
 * `readalongUrl` is null (legacy rows), or on ANY failure — callers fall back
 * to plain text and playback is never affected.
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
    let cancelled = false;
    setSegments(null);
    fetch(readalongUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`readalong fetch failed: ${res.status}`);
        return res.text();
      })
      .then((text) => {
        if (cancelled) return;
        const manifest = parseReadAlong(text);
        setSegments(
          manifest && manifest.segments.length > 0 ? manifest.segments : null,
        );
      })
      .catch(() => {
        if (!cancelled) setSegments(null);
      });
    return () => {
      cancelled = true;
    };
  }, [readalongUrl]);

  return segments;
}
