import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { HomeFeed } from '../types';

/**
 * Fetches the personalised landing feed (`GET /home/feed`).
 *
 * Server caches the first page per-user in Redis for 5 minutes; we keep a
 * matching client-side staleTime so the same hook called from a remount
 * during the cache window doesn't refire the request.
 */
export function useHomeFeed() {
  return useQuery({
    queryKey: ['home', 'feed'],
    queryFn: () => apiClient.get<HomeFeed>('/home/feed'),
    // Match the server's 5-min TTL so the cache windows align.
    staleTime: 5 * 60 * 1000,
    // Network failures during the launch animation are common; keep the
    // last good payload visible while the retry runs.
    placeholderData: (prev) => prev,
  });
}
