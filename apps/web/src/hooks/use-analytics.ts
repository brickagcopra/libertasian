'use client';

import { useCallback, useEffect, useRef } from 'react';

import { useAnalyticsContext } from '@/providers/analytics-provider';

/**
 * Returns a `track` callback for fire-and-forget event tracking.
 */
export function useTrack() {
  const { analytics } = useAnalyticsContext();

  const track = useCallback(
    (eventName: string, properties: Record<string, unknown> = {}, durationMs?: number) => {
      analytics.track(eventName, properties, durationMs);
    },
    [analytics],
  );

  return track;
}

/**
 * Records mount timestamp. On unmount, fires an event with elapsed `durationMs`.
 * Useful for measuring time-on-page or time-on-component.
 */
export function useTrackTiming(eventName: string, properties?: Record<string, unknown>) {
  const { analytics } = useAnalyticsContext();
  const mountTime = useRef<number>(0);

  useEffect(() => {
    mountTime.current = Date.now();

    return () => {
      const durationMs = Date.now() - mountTime.current;
      analytics.track(eventName, properties ?? {}, durationMs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Returns a ref to attach to a DOM element. Uses IntersectionObserver
 * to track when the element is visible (50% threshold) for 1+ second.
 * Fires the event once per mount.
 */
export function useTrackVisibility(eventName: string, properties?: Record<string, unknown>) {
  const { analytics } = useAnalyticsContext();
  const ref = useRef<HTMLElement | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (entry.isIntersecting && !fired.current) {
          timer = setTimeout(() => {
            if (!fired.current) {
              fired.current = true;
              analytics.track(eventName, properties ?? {});
            }
          }, 1000);
        } else if (!entry.isIntersecting && timer) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
