import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../../lib/api-client';
import type { AudioContentType, AudioRenditionReadModel } from '../types';

interface Options {
  contentType: AudioContentType;
  contentId: string;
  /** Only fetch after explicit user intent (tapping "Listen"). */
  enabled: boolean;
}

/** Stop polling a still-pending synthesis after this long and surface a notice. */
export const POLL_TIMEOUT_MS = 60_000;
export const POLL_INTERVAL_MS = 3_000;

export const audioRenditionQueryKey = (
  contentType: AudioContentType,
  contentId: string,
) => ['audio-rendition', contentType, contentId] as const;

/**
 * Fetch (and, while pending, poll) the audio rendition for a digest or bar
 * answer. Mirrors apps/web/src/features/audio/hooks/use-audio-rendition.ts.
 *
 * The endpoint enqueues paid TTS synthesis as a side effect of the FIRST
 * not-ready call, so callers MUST gate `enabled` on explicit user intent —
 * never fetch on mount. A ready rendition returns `status: 'ready'` with
 * short-lived signed URLs; a not-ready one returns `status: 'pending'` (a 202
 * success envelope, not an error). retry=false because 402 (paywall) is a
 * deterministic state the UI must render, not a transient error to paper over.
 *
 * Pending renditions are polled every 3s. After ~60s we stop polling and expose
 * `isTakingTooLong` so the UI can show a "taking longer than expected" state.
 */
export function useAudioRendition({ contentType, contentId, enabled }: Options) {
  const startRef = useRef<number | null>(null);
  const [isTakingTooLong, setIsTakingTooLong] = useState(false);

  const query = useQuery({
    queryKey: audioRenditionQueryKey(contentType, contentId),
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: () =>
      apiClient.get<AudioRenditionReadModel>(
        `/audio/${contentType}/${encodeURIComponent(contentId)}`,
        { params: { language: 'en' } },
      ),
    refetchInterval: (q) => {
      if (isTakingTooLong) return false;
      return q.state.data?.status === 'pending' ? POLL_INTERVAL_MS : false;
    },
  });

  const status = query.data?.status;
  const dataUpdatedAt = query.dataUpdatedAt;

  useEffect(() => {
    if (!enabled) {
      startRef.current = null;
      setIsTakingTooLong(false);
      return;
    }

    if (status === 'pending') {
      if (startRef.current == null) startRef.current = Date.now();
      const remaining = POLL_TIMEOUT_MS - (Date.now() - startRef.current);
      if (remaining <= 0) {
        setIsTakingTooLong(true);
        return;
      }
      const timer = setTimeout(() => setIsTakingTooLong(true), remaining);
      return () => clearTimeout(timer);
    }

    if (status === 'ready') {
      // Fresh ready result (e.g. after a manual retry) clears the timeout flag.
      startRef.current = null;
      setIsTakingTooLong(false);
    }
    return undefined;
  }, [enabled, status, dataUpdatedAt]);

  return { ...query, isTakingTooLong };
}
