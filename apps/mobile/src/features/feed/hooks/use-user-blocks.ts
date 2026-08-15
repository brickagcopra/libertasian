import { Alert } from 'react-native';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { apiClient } from '../../../lib/api-client';
import type {
  FeedBlockedUser,
  FeedPostItem,
  FeedPaginationMeta,
} from '@libertasian/types';

interface FeedResponse {
  success: boolean;
  data: FeedPostItem[];
  meta: FeedPaginationMeta;
}

interface BlockedUsersResponse {
  success: boolean;
  data: FeedBlockedUser[];
  meta: FeedPaginationMeta;
}

/**
 * Drop every cached post by `authorId` from all four feed caches.
 *
 * Deliberately NOT `optimisticUpdate()` from use-feed-interactions: that
 * helper iterates a hardcoded ['public','organization','bookmarks'] and would
 * miss ['feed','user',userId], leaving the blocked author's posts sitting in
 * the profile-feed cache. A prefix match on ['feed'] covers all four, and this
 * filters pages rather than mapping them.
 */
function removeAuthorFromFeeds(
  queryClient: ReturnType<typeof useQueryClient>,
  authorId: string,
) {
  queryClient.setQueriesData<InfiniteData<FeedResponse>>(
    { queryKey: ['feed'] },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          data: page.data.filter((post) => post.author.id !== authorId),
        })),
      };
    },
  );
}

export function useBlockUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.post(`/feed/users/${userId}/block`),
    onMutate: async (userId) => {
      removeAuthorFromFeeds(queryClient, userId);
    },
    // Error handling lives HERE, not in a per-call mutate(_, { onError }).
    // onMutate unmounts the PostCard that owns the options sheet, and
    // TanStack v5 drops per-call callbacks when their observer unsubscribes,
    // so a caller-supplied onError would never fire from the feed list — the
    // post would silently vanish and then reappear on the onSettled refetch.
    onError: () => {
      Alert.alert('Could not block', 'Something went wrong. Please try again.');
    },
    onSettled: () => {
      // The block is symmetric and also hides comments and post detail, so
      // refetch rather than trying to patch every derived cache by hand.
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['feed-post'] });
      void queryClient.invalidateQueries({ queryKey: ['feed-comments'] });
      void queryClient.invalidateQueries({ queryKey: ['feed-blocks'] });
    },
  });
}

export function useUnblockUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      apiClient.delete(`/feed/users/${userId}/block`),
    onError: () => {
      Alert.alert(
        'Could not unblock',
        'Something went wrong. Please try again.',
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
      void queryClient.invalidateQueries({ queryKey: ['feed-post'] });
      void queryClient.invalidateQueries({ queryKey: ['feed-comments'] });
      void queryClient.invalidateQueries({ queryKey: ['feed-blocks'] });
    },
  });
}

export function useBlockedUsers() {
  return useInfiniteQuery({
    queryKey: ['feed-blocks'],
    queryFn: async ({ pageParam }) => {
      const params: Record<string, string> = { limit: '20' };
      if (pageParam) params['cursor'] = pageParam;
      return apiClient.get<BlockedUsersResponse>('/feed/blocks', { params });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.meta.hasNext ? (lastPage.meta.nextCursor ?? undefined) : undefined,
  });
}
